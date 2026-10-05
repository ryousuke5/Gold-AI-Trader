#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import lzma
import struct
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SYMBOL = "XAUUSD"
PRICE_SCALE = 1000.0
RECORD = struct.Struct(">IIIIIf")
BASE_URL = "https://datafeed.dukascopy.com/datafeed"
USER_AGENT = "Gold-AI-Trader/1.0 historical-research"


def bi5_url(day: date, resolution: str) -> str:
    suffix = "5" if resolution == "m5" else "1"
    return (
        f"{BASE_URL}/{SYMBOL}/{day.year:04d}/{day.month-1:02d}/"
        f"{day.day:02d}/BID_candles_min_{suffix}.bi5"
    )


def fetch_bytes(url: str, retries: int = 6, timeout: int = 20) -> tuple[str, bytes]:
    delay = 2.0
    for attempt in range(1, retries + 1):
        req = Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
                "Connection": "close",
            },
        )
        try:
            with urlopen(req, timeout=timeout) as response:
                data = response.read()
                if not data:
                    raise URLError("empty response body")
                return "ok", data
        except HTTPError as exc:
            if exc.code == 404:
                return "missing", b""
            retryable = exc.code == 429 or exc.code >= 500
            if not retryable or attempt >= retries:
                raise
            retry_after = exc.headers.get("Retry-After")
            try:
                server_delay = max(0.0, float(retry_after)) if retry_after else 0.0
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
            delay = min(delay * 2.0, 30.0)
        except (URLError, TimeoutError, OSError) as exc:
            if attempt >= retries:
                raise
            print(
                json.dumps(
                    {
                        "event": "retry",
                        "error": str(exc),
                        "attempt": attempt,
                        "sleep_seconds": delay,
                        "url": url,
                    }
                ),
                flush=True,
            )
            time.sleep(delay)
            delay = min(delay * 2.0, 30.0)


def load_or_fetch(
    day: date,
    cache_dir: Path,
    resolution: str,
    retries: int,
    timeout: int,
    request_delay: float,
) -> tuple[str, bytes]:
    cache_file = cache_dir / f"{day:%Y%m%d}.bi5"
    missing_marker = cache_dir / f"{day:%Y%m%d}.missing"

    if missing_marker.exists():
        return "missing-cached", b""

    if cache_file.exists() and cache_file.stat().st_size > 0:
        return "cached", cache_file.read_bytes()

    status, raw = fetch_bytes(
        bi5_url(day, resolution),
        retries=retries,
        timeout=timeout,
    )
    if status == "missing":
        return "missing", b""

    cache_file.write_bytes(raw)
    if request_delay > 0:
        time.sleep(request_delay)
    return "downloaded", raw


def parse_day(raw: bytes, day: date) -> list[dict]:
    if not raw:
        return []
    try:
        data = lzma.decompress(raw, format=lzma.FORMAT_AUTO)
    except lzma.LZMAError as exc:
        raise RuntimeError(f"LZMA decompression failed for {day}: {exc}") from exc

    if len(data) % RECORD.size:
        raise RuntimeError(f"Invalid BI5 payload size for {day}: {len(data)}")

    day_start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    base_ts = int(day_start.timestamp())
    bars = []

    for offset in range(0, len(data), RECORD.size):
        sec, open_raw, close_raw, low_raw, high_raw, volume = RECORD.unpack_from(
            data, offset
        )
        if sec >= 86400:
            raise RuntimeError(f"Invalid seconds offset for {day}: {sec}")

        ts = base_ts + int(sec)
        o = open_raw / PRICE_SCALE
        c = close_raw / PRICE_SCALE
        lo = low_raw / PRICE_SCALE
        hi = high_raw / PRICE_SCALE

        if not (
            o > 0
            and c > 0
            and lo > 0
            and hi >= max(o, c)
            and lo <= min(o, c)
        ):
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


def validate_native_m5(bars: list[dict], day: date) -> None:
    if not bars:
        raise RuntimeError(f"Empty native M5 dataset for {day}")

    seen = set()
    for bar in bars:
        ts = bar["time"]
        sec = ts - int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())
        if sec < 0 or sec >= 86400 or sec % 300 != 0:
            raise RuntimeError(f"Native M5 timestamp alignment failed for {day}: {ts}")
        if ts in seen:
            raise RuntimeError(f"Duplicate native M5 timestamp for {day}: {ts}")
        seen.add(ts)


def resample_m1_to_m5(m1: list[dict]) -> tuple[list[dict], int]:
    grouped: dict[int, list[dict]] = defaultdict(list)
    for bar in m1:
        bucket = (bar["time"] // 300) * 300
        grouped[bucket].append(bar)

    m5 = []
    incomplete = 0

    for bucket in sorted(grouped):
        rows = sorted(grouped[bucket], key=lambda x: x["time"])
        expected = list(range(bucket, bucket + 300, 60))
        by_ts = {r["time"]: r for r in rows}

        if any(ts not in by_ts for ts in expected):
            incomplete += 1
            continue

        rs = [by_ts[ts] for ts in expected]
        m5.append(
            {
                "time": bucket,
                "open": rs[0]["open"],
                "high": max(r["high"] for r in rs),
                "low": min(r["low"] for r in rs),
                "close": rs[-1]["close"],
                "volume": sum(r["volume"] for r in rs),
            }
        )

    return m5, incomplete


def process_day(
    day: date,
    native_cache_dir: Path,
    m1_cache_dir: Path,
    retries: int,
    timeout: int,
    request_delay: float,
) -> dict:
    native_status, native_raw = load_or_fetch(
        day,
        native_cache_dir,
        "m5",
        retries,
        timeout,
        request_delay,
    )

    if native_status not in {"missing", "missing-cached"}:
        try:
            native_bars = parse_day(native_raw, day)
            validate_native_m5(native_bars, day)
            return {
                "date": day.isoformat(),
                "status": f"native-{native_status}",
                "source": "m5_native",
                "m1_rows": 0,
                "m5": native_bars,
                "incomplete_m5": 0,
            }
        except Exception as exc:
            print(
                json.dumps(
                    {
                        "event": "native_m5_fallback",
                        "date": day.isoformat(),
                        "error": str(exc),
                    }
                ),
                flush=True,
            )

    m1_status, m1_raw = load_or_fetch(
        day,
        m1_cache_dir,
        "m1",
        retries,
        timeout,
        request_delay,
    )

    if m1_status in {"missing", "missing-cached"}:
        return {
            "date": day.isoformat(),
            "status": "missing",
            "source": "none",
            "m1_rows": 0,
            "m5": [],
            "incomplete_m5": 0,
        }

    m1_bars = parse_day(m1_raw, day)
    m5, incomplete = resample_m1_to_m5(m1_bars)
    return {
        "date": day.isoformat(),
        "status": f"m1-fallback-{m1_status}",
        "source": "m1_fallback",
        "m1_rows": len(m1_bars),
        "m5": m5,
        "incomplete_m5": incomplete,
    }


def self_test() -> None:
    day = date(2026, 1, 2)
    native_raw = b"".join(
        [
            RECORD.pack(
                i * 300,
                400000 + i,
                400001 + i,
                399999 + i,
                400002 + i,
                10.0 + i,
            )
            for i in range(2)
        ]
    )
    payload = lzma.compress(native_raw, format=lzma.FORMAT_ALONE)
    native = parse_day(payload, day)
    validate_native_m5(native, day)
    assert len(native) == 2
    assert native[1]["time"] - native[0]["time"] == 300

    m1_raw = b"".join(
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
    m1_payload = lzma.compress(m1_raw, format=lzma.FORMAT_ALONE)
    m1 = parse_day(m1_payload, day)
    m5, incomplete = resample_m1_to_m5(m1)
    assert len(m5) == 1 and incomplete == 0
    assert m5[0]["time"] == m1[0]["time"]
    print(json.dumps({"self_test": "PASS"}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-days", type=int, default=1825)
    parser.add_argument("--native-cache-dir", default="gold-xauusd-data/raw_m5")
    parser.add_argument("--m1-cache-dir", default="gold-xauusd-data/raw")
    parser.add_argument("--output-file", default="gold-xauusd-data/xauusd-m5.json.gz")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--retries", type=int, default=6)
    parser.add_argument("--request-delay", type=float, default=0.2)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return

    lookback_days = max(365, args.lookback_days)
    end_day = datetime.now(timezone.utc).date()
    start_day = end_day - timedelta(days=lookback_days)

    native_cache_dir = Path(args.native_cache_dir)
    m1_cache_dir = Path(args.m1_cache_dir)
    output_file = Path(args.output_file)
    native_cache_dir.mkdir(parents=True, exist_ok=True)
    m1_cache_dir.mkdir(parents=True, exist_ok=True)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    days = []
    day = start_day
    while day < end_day:
        days.append(day)
        day += timedelta(days=1)

    all_m5 = []
    missing_days = []
    failures = []
    requested = len(days)
    completed = 0
    incomplete_m5 = 0
    m1_rows = 0
    native_downloaded = native_cached = 0
    fallback_downloaded = fallback_cached = 0
    native_days = fallback_days = 0

    max_workers = max(1, min(8, args.workers))
    print(
        json.dumps(
            {
                "event": "start",
                "requested_days": requested,
                "workers": max_workers,
                "source_priority": "native_m5_then_m1_fallback",
                "start_date": start_day.isoformat(),
                "end_date_exclusive": end_day.isoformat(),
            }
        ),
        flush=True,
    )

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                process_day,
                current_day,
                native_cache_dir,
                m1_cache_dir,
                args.retries,
                args.timeout,
                args.request_delay,
            ): current_day
            for current_day in days
        }

        for future in as_completed(futures):
            current_day = futures[future]
            completed += 1
            try:
                result = future.result()
                status = result["status"]
                source = result["source"]
                m1_rows += result["m1_rows"]
                incomplete_m5 += result["incomplete_m5"]
                all_m5.extend(result["m5"])

                if source == "m5_native":
                    native_days += 1
                    if status == "native-downloaded":
                        native_downloaded += 1
                    elif status == "native-cached":
                        native_cached += 1
                elif source == "m1_fallback":
                    fallback_days += 1
                    if status == "m1-fallback-downloaded":
                        fallback_downloaded += 1
                    elif status == "m1-fallback-cached":
                        fallback_cached += 1
                elif status == "missing":
                    missing_days.append(result["date"])

                if completed % 25 == 0 or source != "m5_native":
                    print(
                        json.dumps(
                            {
                                "event": "day",
                                "date": result["date"],
                                "status": status,
                                "source": source,
                                "m1_rows": result["m1_rows"],
                                "completed_days": completed,
                                "requested_days": requested,
                                "native_days": native_days,
                                "fallback_days": fallback_days,
                                "missing_days": len(missing_days),
                                "failed_days": len(failures),
                            }
                        ),
                        flush=True,
                    )
            except Exception as exc:
                failures.append(
                    {"date": current_day.isoformat(), "error": str(exc)}
                )
                print(
                    json.dumps(
                        {
                            "event": "failed_day",
                            "date": current_day.isoformat(),
                            "error": str(exc),
                            "completed_days": completed,
                            "requested_days": requested,
                            "failed_days": len(failures),
                        }
                    ),
                    flush=True,
                )

    if failures:
        sample = failures[:10]
        raise RuntimeError(
            f"Failed to fetch {len(failures)} XAUUSD days; sample={json.dumps(sample)}"
        )

    all_m5.sort(key=lambda x: x["time"])
    dedup_m5 = []
    last_ts = None
    for bar in all_m5:
        if bar["time"] == last_ts:
            continue
        dedup_m5.append(bar)
        last_ts = bar["time"]

    if len(dedup_m5) < 200000:
        raise RuntimeError(f"Insufficient XAUUSD M5 data: {len(dedup_m5)}")

    non_weekend_gaps = 0
    max_gap = 0
    for prev, cur in zip(dedup_m5, dedup_m5[1:]):
        gap = cur["time"] - prev["time"]
        max_gap = max(max_gap, gap)
        if gap > 900:
            prev_day = datetime.fromtimestamp(prev["time"], timezone.utc).weekday()
            if prev_day < 5:
                non_weekend_gaps += 1

    payload = json.dumps(
        dedup_m5,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode()

    with gzip.open(output_file, "wb", compresslevel=9) as fh:
        fh.write(payload)

    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()
    manifest = {
        "instrument": SYMBOL,
        "provider": "Dukascopy Historical Data Feed",
        "base_resolution": "M5 native BID with M1 BID fallback",
        "derived_resolution": "M5",
        "price_scale": PRICE_SCALE,
        "start_date_utc": start_day.isoformat(),
        "end_date_exclusive_utc": end_day.isoformat(),
        "requested_days": requested,
        "workers": max_workers,
        "native_m5_days": native_days,
        "native_m5_downloaded_days": native_downloaded,
        "native_m5_cached_days": native_cached,
        "m1_fallback_days": fallback_days,
        "m1_fallback_downloaded_days": fallback_downloaded,
        "m1_fallback_cached_days": fallback_cached,
        "missing_days_404_or_empty": len(missing_days),
        "missing_day_samples": missing_days[:20],
        "m1_rows_fetched_for_fallback": m1_rows,
        "m5_rows": len(dedup_m5),
        "incomplete_m5_groups_dropped": incomplete_m5,
        "non_weekend_gaps_gt_15m": non_weekend_gaps,
        "max_m5_gap_seconds": max_gap,
        "output_sha256": digest,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    manifest_path = output_file.with_name("xauusd_m5_manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"event": "complete", **manifest}, indent=2), flush=True)


if __name__ == "__main__":
    main()
