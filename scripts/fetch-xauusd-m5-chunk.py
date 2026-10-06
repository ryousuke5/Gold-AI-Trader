#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import lzma
import signal
import struct
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SYMBOL = "XAUUSD"
PRICE_SCALE = 1000.0
RECORD = struct.Struct(">IIIIIf")
BASE_URL = "https://datafeed.dukascopy.com/datafeed"
USER_AGENT = "Gold-AI-Trader/1.1 resumable-historical-research"
CHECKPOINT_VERSION = 1


def bi5_url(day: date) -> str:
    return (
        f"{BASE_URL}/{SYMBOL}/{day.year:04d}/{day.month - 1:02d}/"
        f"{day.day:02d}/BID_candles_min_1.bi5"
    )


def fetch_bytes(url: str, retries: int = 8, timeout: int = 30) -> tuple[str, bytes]:
    delay = 5.0
    for attempt in range(1, retries + 1):
        req = Request(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
        )
        try:
            with urlopen(req, timeout=timeout) as response:
                data = response.read()
                if data:
                    return "ok", data
                if attempt < retries:
                    sleep_for = delay
                    print(
                        json.dumps(
                            {
                                "event": "retry",
                                "status": "empty_response",
                                "attempt": attempt,
                                "sleep_seconds": sleep_for,
                                "url": url,
                            }
                        ),
                        flush=True,
                    )
                    time.sleep(sleep_for)
                    delay = min(delay * 2.0, 180.0)
                    continue
                raise RuntimeError(f"Empty response from Dukascopy feed after {retries} attempts: {url}")
        except HTTPError as exc:
            if exc.code == 404:
                return "missing", b""
            if exc.code == 429 or exc.code >= 500:
                if attempt < retries:
                    if exc.code == 429:
                        delay = max(delay, 10.0)
                    retry_after = exc.headers.get("Retry-After")
                    try:
                        server_delay = (
                            max(0.0, float(retry_after)) if retry_after else 0.0
                        )
                    except (TypeError, ValueError):
                        server_delay = 0.0
                    sleep_for = max(delay, server_delay)
                    print(
                        json.dumps(
                            {
                                "event": "retry",
                                "status": exc.code,
                                "attempt": attempt,
                                "sleep_seconds": sleep_for,
                                "url": url,
                            }
                        ),
                        flush=True,
                    )
                    time.sleep(sleep_for)
                    delay = min(delay * 2.0, 180.0)
                    continue
            raise
        except (URLError, TimeoutError, OSError) as exc:
            if attempt < retries:
                print(
                    json.dumps(
                        {
                            "event": "retry",
                            "error": str(exc),
                            "attempt": attempt,
                            "url": url,
                        }
                    ),
                    flush=True,
                )
                time.sleep(delay)
                delay = min(delay * 2.0, 120.0)
                continue
            raise


def parse_day(raw: bytes, day: date) -> list[dict]:
    if not raw:
        return []
    try:
        data = lzma.decompress(raw, format=lzma.FORMAT_AUTO)
    except lzma.LZMAError as exc:
        raise RuntimeError(f"LZMA decompression failed for {day}: {exc}") from exc
    if len(data) % RECORD.size:
        raise RuntimeError(f"Invalid BI5 payload size for {day}: {len(data)}")

    base_ts = int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())
    bars: list[dict] = []
    for offset in range(0, len(data), RECORD.size):
        sec, open_raw, close_raw, low_raw, high_raw, volume = RECORD.unpack_from(data, offset)
        ts = base_ts + int(sec)
        o = open_raw / PRICE_SCALE
        c = close_raw / PRICE_SCALE
        lo = low_raw / PRICE_SCALE
        hi = high_raw / PRICE_SCALE
        if not (o > 0 and hi >= max(o, c) and lo <= min(o, c)):
            raise RuntimeError(f"Invalid OHLC in BI5 payload for {day} at {sec}")
        bars.append(
            {
                "time": ts,
                "open": o,
                "high": hi,
                "low": lo,
                "close": c,
                "volume": float(volume),
            }
        )
    return bars


def resample_m1_to_m5(m1: list[dict]) -> tuple[list[dict], int]:
    grouped: dict[int, list[dict]] = defaultdict(list)
    for bar in m1:
        bucket = (bar["time"] // 300) * 300
        grouped[bucket].append(bar)

    m5: list[dict] = []
    incomplete = 0
    for bucket in sorted(grouped):
        rows = sorted(grouped[bucket], key=lambda x: x["time"])
        expected = list(range(bucket, bucket + 300, 60))
        by_ts = {row["time"]: row for row in rows}
        if any(ts not in by_ts for ts in expected):
            incomplete += 1
            continue
        rs = [by_ts[ts] for ts in expected]
        m5.append(
            {
                "time": bucket,
                "open": rs[0]["open"],
                "high": max(row["high"] for row in rs),
                "low": min(row["low"] for row in rs),
                "close": rs[-1]["close"],
                "volume": sum(row["volume"] for row in rs),
            }
        )
    return m5, incomplete


def atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_bytes(payload)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def atomic_write_gzip_json(path: Path, payload: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
        with gzip.open(tmp, "wb", compresslevel=9) as fh:
            fh.write(raw)
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def self_test() -> None:
    day = date(2026, 1, 2)
    raw = b"".join(
        [
            RECORD.pack(
                i * 60,
                400000 + i,
                400001 + i,
                399999 + i,
                400002 + i,
                10.0 + i,
            )
            for i in range(5)
        ]
    )
    payload = lzma.compress(raw, format=lzma.FORMAT_ALONE)
    bars = parse_day(payload, day)
    assert len(bars) == 5
    assert bars[0]["time"] == int(datetime(2026, 1, 2, tzinfo=timezone.utc).timestamp())
    assert bars[0]["open"] == 400.0
    assert bars[-1]["close"] == 400.005
    m5, incomplete = resample_m1_to_m5(bars)
    assert len(m5) == 1 and incomplete == 0
    assert m5[0]["time"] == bars[0]["time"]
    print(json.dumps({"self_test": "PASS"}))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Resumable XAUUSD M1->M5 downloader for one independent date chunk."
    )
    parser.add_argument("--start-date", default=None)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--cache-dir", default="gold-xauusd-data/raw")
    parser.add_argument("--output-file", default=None)
    parser.add_argument("--manifest-file", default="")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--retries", type=int, default=8)
    parser.add_argument("--request-delay", type=float, default=2.0)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not (args.start_date and args.end_date and args.output_file):
        raise ValueError("--start-date, --end-date, and --output-file are required unless --self-test is used")

    start_day = date.fromisoformat(args.start_date)
    end_day = date.fromisoformat(args.end_date)
    if start_day >= end_day:
        raise ValueError("start-date must be earlier than end-date")
    if (end_day - start_day).days > 31:
        raise ValueError("Chunk size must not exceed 31 days")

    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    output_file = Path(args.output_file)
    manifest_file = (
        Path(args.manifest_file)
        if args.manifest_file
        else output_file.with_suffix(".manifest.json")
    )
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_file = cache_dir / "checkpoint.json"

    all_m1: list[dict] = []
    missing_days: list[str] = []
    transient_failed_days: list[str] = []
    requested = reused = downloaded = 0
    progress: dict[str, dict] = {}

    if checkpoint_file.exists():
        try:
            saved = json.loads(checkpoint_file.read_text(encoding="utf-8"))
            if (
                saved.get("version") == CHECKPOINT_VERSION
                and saved.get("chunk_start_date_utc") == start_day.isoformat()
                and saved.get("chunk_end_date_exclusive_utc") == end_day.isoformat()
                and isinstance(saved.get("days"), dict)
            ):
                progress = {str(k): v for k, v in saved["days"].items() if isinstance(v, dict)}
                print(json.dumps({
                    "event": "resume_checkpoint_loaded",
                    "state": saved.get("state"),
                    "completed_days": sum(1 for v in progress.values() if v.get("status") == "complete"),
                    "tracked_days": len(progress),
                    "checkpoint_file": str(checkpoint_file),
                }), flush=True)
        except (OSError, ValueError, TypeError):
            print(json.dumps({"event": "checkpoint_invalid_ignored", "checkpoint_file": str(checkpoint_file)}), flush=True)

    def persist_checkpoint(state: str, error: str | None = None) -> None:
        atomic_write_json(checkpoint_file, {
            "version": CHECKPOINT_VERSION,
            "instrument": SYMBOL,
            "chunk_start_date_utc": start_day.isoformat(),
            "chunk_end_date_exclusive_utc": end_day.isoformat(),
            "state": state,
            "completed_days": sum(1 for v in progress.values() if v.get("status") == "complete"),
            "missing_days": sum(1 for v in progress.values() if v.get("status") == "missing"),
            "transient_failed_days": sum(1 for v in progress.values() if v.get("status") == "transient_failed"),
            "days": progress,
            "error": error,
            "updated_at_utc": datetime.now(timezone.utc).isoformat(),
        })

    def handle_signal(signum, _frame) -> None:
        message = f"received signal {signum}"
        persist_checkpoint("interrupted", error=message)
        print(json.dumps({"event": "checkpoint_saved_on_signal", "signal": signum}), flush=True)
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    persist_checkpoint("running")

    day = start_day
    while day < end_day:
        requested += 1
        cache_file = cache_dir / f"{day:%Y%m%d}.bi5"
        missing_marker = cache_dir / f"{day:%Y%m%d}.missing"

        if missing_marker.exists():
            missing_days.append(day.isoformat())
            progress[day.isoformat()] = {"status": "missing", "source": "NONE"}
            persist_checkpoint("running")
            day += timedelta(days=1)
            continue

        bars: list[dict] | None = None
        status = "cached"

        if cache_file.exists() and cache_file.stat().st_size > 0:
            raw = cache_file.read_bytes()
            try:
                bars = parse_day(raw, day)
                reused += 1
            except RuntimeError as exc:
                print(
                    json.dumps(
                        {
                            "event": "corrupt_cache",
                            "date": day.isoformat(),
                            "cache_file": str(cache_file),
                            "error": str(exc),
                        }
                    ),
                    flush=True,
                )
                cache_file.unlink(missing_ok=True)

        if bars is None:
            status, raw = fetch_bytes(
                bi5_url(day),
                retries=args.retries,
                timeout=args.timeout,
            )
            if status == "missing":
                missing_days.append(day.isoformat())
                missing_marker.touch()
                day += timedelta(days=1)
                continue
            if status != "ok" or not raw:
                transient_failed_days.append(day.isoformat())
                progress[day.isoformat()] = {"status": "transient_failed", "source": "NONE"}
                persist_checkpoint("running")
                day += timedelta(days=1)
                continue

            bars = parse_day(raw, day)
            atomic_write_bytes(cache_file, raw)
            downloaded += 1
            time.sleep(max(0.0, args.request_delay))

        all_m1.extend(bars)
        progress[day.isoformat()] = {
            "status": "complete",
            "source": "M1",
            "m1_rows": len(bars),
            "cache_file": str(cache_file),
        }
        persist_checkpoint("running")

        print(
            json.dumps(
                {
                    "event": "day",
                    "date": day.isoformat(),
                    "status": status,
                    "m1_rows": len(bars),
                    "requested_days": requested,
                    "downloaded_days": downloaded,
                    "cached_days": reused,
                    "missing_days": len(missing_days),
                }
            ),
            flush=True,
        )
        day += timedelta(days=1)

    persist_checkpoint("building")

    if transient_failed_days:
        sample = ", ".join(transient_failed_days[:20])
        raise RuntimeError(
            f"Transient download failures remain for {len(transient_failed_days)} day(s): "
            f"{sample}"
        )

    all_m1.sort(key=lambda x: x["time"])
    dedup_m1: list[dict] = []
    last_ts: int | None = None
    for bar in all_m1:
        if bar["time"] == last_ts:
            continue
        dedup_m1.append(bar)
        last_ts = bar["time"]

    m5, incomplete_m5 = resample_m1_to_m5(dedup_m1)
    if not m5:
        raise RuntimeError(
            f"No XAUUSD M5 data for chunk {start_day.isoformat()}..{end_day.isoformat()}"
        )

    m5.sort(key=lambda x: x["time"])
    for prev, cur in zip(m5, m5[1:]):
        if cur["time"] <= prev["time"]:
            raise RuntimeError("M5 timestamps are not strictly increasing")

    non_weekend_gaps = 0
    max_gap = 0
    for prev, cur in zip(m5, m5[1:]):
        gap = cur["time"] - prev["time"]
        max_gap = max(max_gap, gap)
        if gap > 900:
            prev_day_weekday = datetime.fromtimestamp(prev["time"], timezone.utc).weekday()
            if prev_day_weekday < 5:
                non_weekend_gaps += 1

    atomic_write_gzip_json(output_file, m5)
    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()

    manifest = {
        "instrument": SYMBOL,
        "provider": "Dukascopy Historical Data Feed",
        "base_resolution": "M1 BID",
        "derived_resolution": "M5",
        "price_scale": PRICE_SCALE,
        "chunk_start_date_utc": start_day.isoformat(),
        "chunk_end_date_exclusive_utc": end_day.isoformat(),
        "requested_days": requested,
        "cached_days_reused": reused,
        "downloaded_days": downloaded,
        "missing_days_404": len(missing_days),
        "missing_day_samples": missing_days[:20],
        "transient_failed_days": transient_failed_days,
        "m1_rows": len(dedup_m1),
        "m5_rows": len(m5),
        "incomplete_m5_groups_dropped": incomplete_m5,
        "non_weekend_gaps_gt_15m": non_weekend_gaps,
        "max_m5_gap_seconds": max_gap,
        "output_sha256": digest,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    manifest_file.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    persist_checkpoint("complete")

    print(json.dumps({"event": "complete", **manifest}, indent=2), flush=True)


if __name__ == "__main__":
    main()
