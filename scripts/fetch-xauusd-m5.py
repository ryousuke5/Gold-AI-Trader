#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import lzma
import struct
import threading
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
NATIVE_M5_DISABLED = threading.Event()


def bi5_url(day: date, resolution: int = 5) -> str:
    return (
        f"{BASE_URL}/{SYMBOL}/{day.year:04d}/{day.month-1:02d}/{day.day:02d}/"
        f"BID_candles_min_{resolution}.bi5"
    )


def fetch_bytes(
    url: str,
    retries: int = 4,
    timeout: int = 20,
    initial_backoff: float = 2.0,
    max_backoff: float = 20.0,
) -> tuple[str, bytes]:
    delay = initial_backoff
    last_error = ""
    for attempt in range(1, retries + 1):
        req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        try:
            with urlopen(req, timeout=timeout) as response:
                data = response.read()
                if data:
                    return "ok", data
                last_error = "empty response"
        except HTTPError as exc:
            if exc.code == 404:
                return "missing", b""
            if exc.code == 429 or exc.code >= 500:
                last_error = f"http {exc.code}"
                if attempt < retries:
                    retry_after = exc.headers.get("Retry-After")
                    try:
                        server_delay = max(0.0, float(retry_after)) if retry_after else 0.0
                    except (TypeError, ValueError):
                        server_delay = 0.0
                    sleep_for = min(max(delay, server_delay), max_backoff)
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
                    delay = min(delay * 2.0, max_backoff)
                    continue
            return "transient_failed", b""
        except (URLError, TimeoutError, OSError) as exc:
            last_error = str(exc)
            if attempt < retries:
                sleep_for = min(delay, max_backoff)
                print(
                    json.dumps(
                        {
                            "event": "retry",
                            "error": last_error,
                            "attempt": attempt,
                            "sleep_seconds": sleep_for,
                            "url": url,
                        }
                    ),
                    flush=True,
                )
                time.sleep(sleep_for)
                delay = min(delay * 2.0, max_backoff)
                continue
            return "transient_failed", b""
    print(json.dumps({"event": "download_failed", "error": last_error, "url": url}), flush=True)
    return "transient_failed", b""


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


def download_day(
    day: date,
    native_m5_dir: Path,
    m1_dir: Path,
    retries: int,
    timeout: int,
    request_delay: float,
) -> dict:
    native_file = native_m5_dir / f"{day:%Y%m%d}.bi5"
    m1_file = m1_dir / f"{day:%Y%m%d}.bi5"
    missing_file = m1_dir / f"{day:%Y%m%d}.missing"

    if native_file.exists() and native_file.stat().st_size > 0:
        return {"day": day, "status": "cached_m5", "source": "M5"}
    if m1_file.exists() and m1_file.stat().st_size > 0:
        return {"day": day, "status": "cached_m1", "source": "M1"}
    if missing_file.exists():
        return {"day": day, "status": "cached_missing", "source": "NONE"}

    if not NATIVE_M5_DISABLED.is_set():
        status, raw = fetch_bytes(
            bi5_url(day, 5),
            retries=retries,
            timeout=timeout,
        )
        if status == "ok":
            try:
                bars = parse_day(raw, day)
                if not bars:
                    raise RuntimeError("native M5 payload parsed to zero bars")
            except Exception as exc:
                print(json.dumps({"event":"native_m5_invalid","date":day.isoformat(),"error":str(exc)}), flush=True)
                NATIVE_M5_DISABLED.set()
            else:
                native_file.write_bytes(raw)
                if request_delay > 0:
                    time.sleep(request_delay)
                return {"day":day,"status":"ok_m5","source":"M5","rows":len(bars)}
        elif status in {"missing","transient_failed"}:
            NATIVE_M5_DISABLED.set()
            print(json.dumps({"event":"native_m5_circuit_open","date":day.isoformat(),"status":status}), flush=True)

    status, raw = fetch_bytes(bi5_url(day, 1), retries=retries, timeout=timeout)
    if status == "ok":
        m1_file.write_bytes(raw)
        if request_delay > 0:
            time.sleep(request_delay)
        return {"day":day,"status":"ok_m1_fallback","source":"M1"}
    if status == "missing":
        missing_file.touch()
        return {"day":day,"status":"missing","source":"NONE"}
    return {"day":day,"status":"transient_failed","source":"NONE"}


def resolve_date_range(args) -> tuple[date, date]:
    if args.start_date or args.end_date:
        if not (args.start_date and args.end_date):
            raise ValueError("--start-date and --end-date must be supplied together")
        start_day = date.fromisoformat(args.start_date)
        end_day = date.fromisoformat(args.end_date)
        if end_day <= start_day:
            raise ValueError("--end-date must be after --start-date")
        return start_day, end_day
    lookback_days = max(365, args.lookback_days)
    end_day = datetime.now(timezone.utc).date()
    return end_day - timedelta(days=lookback_days), end_day


def build_from_cache(start_day: date, end_day: date, native_m5_dir: Path, m1_dir: Path, output_file: Path) -> dict:
    days = []
    day = start_day
    while day < end_day:
        days.append(day)
        day += timedelta(days=1)

    all_m1 = []
    all_m5 = []
    missing_days = []
    unresolved_days = []
    native_m5_days = 0
    m1_fallback_days = 0
    cached_days = 0

    for d in days:
        cached = load_cached_source(d, native_m5_dir, m1_dir)
        if cached is None:
            marker = m1_dir / f"{d:%Y%m%d}.missing"
            if marker.exists():
                missing_days.append(d.isoformat())
            else:
                unresolved_days.append(d.isoformat())
            continue
        source, raw = cached
        bars = parse_day(raw, d)
        cached_days += 1
        if source == "M5":
            native_m5_days += 1
            all_m5.extend(bars)
        else:
            m1_fallback_days += 1
            all_m1.extend(bars)

    if unresolved_days:
        sample = ",".join(unresolved_days[:50])
        raise RuntimeError(
            "Unresolved cache gaps remain; refusing to build a partial dataset: "
            + sample + ("..." if len(unresolved_days) > 50 else "")
        )

    fallback_m5, incomplete_m5 = resample_m1_to_m5(all_m1)
    m5 = all_m5 + fallback_m5
    m5.sort(key=lambda x:x["time"])

    dedup_m5 = []
    last = None
    for bar in m5:
        if bar["time"] == last:
            continue
        dedup_m5.append(bar)
        last = bar

    if len(dedup_m5) < 200000:
        raise RuntimeError(f"Insufficient XAUUSD M5 data: {len(dedup_m5)}")

    non_weekend_gaps = 0
    max_gap = 0
    for prev, cur in zip(dedup_m5, dedup_m5[1:]):
        gap = cur["time"] - prev["time"]
        max_gap = max(max_gap, gap)
        if gap > 900 and datetime.fromtimestamp(prev["time"], timezone.utc).weekday() < 5:
            non_weekend_gaps += 1

    output_file.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(output_file, "wb", compresslevel=9) as fh:
        fh.write(json.dumps(dedup_m5, separators=(",", ":"), ensure_ascii=False).encode())

    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()
    weekday_missing = sum(1 for iso in missing_days if date.fromisoformat(iso).weekday() < 5)
    manifest = {
        "instrument": SYMBOL,
        "provider": "Dukascopy Historical Data Feed",
        "base_resolution": "Native M5 BID when available, otherwise official M1 BID resampled to M5",
        "derived_resolution": "M5",
        "price_scale": PRICE_SCALE,
        "start_date_utc": start_day.isoformat(),
        "end_date_exclusive_utc": end_day.isoformat(),
        "requested_days": len(days),
        "native_m5_days": native_m5_days,
        "m1_fallback_days": m1_fallback_days,
        "cached_source_days": cached_days,
        "missing_days_404_or_empty": len(missing_days),
        "missing_weekday_days": weekday_missing,
        "missing_day_samples": missing_days[:20],
        "m5_rows": len(dedup_m5),
        "m1_rows_fallback": len(all_m1),
        "incomplete_m5_groups_dropped_from_fallback": incomplete_m5,
        "non_weekend_gaps_gt_15m": non_weekend_gaps,
        "max_m5_gap_seconds": max_gap,
        "output_sha256": digest,
        "native_m5_circuit_open": NATIVE_M5_DISABLED.is_set(),
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    output_file.with_name("xauusd_m5_manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    print(json.dumps({"event":"complete",**manifest}, indent=2), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-days", type=int, default=1825)
    parser.add_argument("--start-date", default=None)
    parser.add_argument("--end-date", default=None)
    parser.add_argument("--cache-dir","--m1-cache-dir",dest="cache_dir",default="gold-xauusd-data/raw")
    parser.add_argument("--native-m5-cache-dir","--native-cache-dir",dest="native_m5_cache_dir",default="gold-xauusd-data/raw-m5")
    parser.add_argument("--output-file",default="gold-xauusd-data/xauusd-m5.json.gz")
    parser.add_argument("--timeout",type=int,default=20)
    parser.add_argument("--retries",type=int,default=4)
    parser.add_argument("--workers",type=int,default=4)
    parser.add_argument("--rounds",type=int,default=3)
    parser.add_argument("--request-delay",type=float,default=0.2)
    parser.add_argument("--download-only",action="store_true")
    parser.add_argument("--build-only",action="store_true")
    parser.add_argument("--self-test",action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if args.download_only and args.build_only:
        raise ValueError("--download-only and --build-only are mutually exclusive")

    start_day, end_day = resolve_date_range(args)
    m1_dir = Path(args.cache_dir)
    native_m5_dir = Path(args.native_m5_cache_dir)
    m1_dir.mkdir(parents=True, exist_ok=True)
    native_m5_dir.mkdir(parents=True, exist_ok=True)
    output_file = Path(args.output_file)

    days = []
    day = start_day
    while day < end_day:
        days.append(day)
        day += timedelta(days=1)

    if not args.build_only:
        pending = days[:]
        results_by_day = {}
        for round_no in range(1, max(1,args.rounds)+1):
            if not pending:
                break
            next_pending = []
            print(json.dumps({
                "event":"download_round","round":round_no,"pending_days":len(pending),
                "workers":max(1,args.workers),
                "start_date":start_day.isoformat(),
                "end_date_exclusive":end_day.isoformat(),
            }), flush=True)
            with ThreadPoolExecutor(max_workers=max(1,args.workers)) as executor:
                futures = {
                    executor.submit(download_day,d,native_m5_dir,m1_dir,args.retries,args.timeout,args.request_delay): d
                    for d in pending
                }
                for future in as_completed(futures):
                    d = futures[future]
                    result = future.result()
                    results_by_day[d] = result
                    if result["status"] == "transient_failed":
                        next_pending.append(d)
                    if len(results_by_day) % 25 == 0 or result["status"] in {"ok_m5","ok_m1_fallback","missing"}:
                        print(json.dumps({
                            "event":"day","date":d.isoformat(),"status":result["status"],
                            "source":result["source"],"completed_days":len(results_by_day),
                            "pending_after_round":len(next_pending)
                        }), flush=True)
            pending = sorted(next_pending)
        if pending:
            raise RuntimeError(
                f"Unresolved transient download failures after {args.rounds} rounds: "
                + ",".join(d.isoformat() for d in pending[:50])
                + ("..." if len(pending)>50 else "")
            )

    if args.download_only:
        cached = sum(1 for d in days if load_cached_source(d,native_m5_dir,m1_dir) is not None)
        missing = sum(1 for d in days if (m1_dir/f"{d:%Y%m%d}.missing").exists())
        print(json.dumps({
            "event":"download_only_complete",
            "start_date":start_day.isoformat(),
            "end_date_exclusive":end_day.isoformat(),
            "requested_days":len(days),
            "cached_source_days":cached,
            "missing_404_days":missing,
        }, indent=2), flush=True)
        return

    build_from_cache(start_day,end_day,native_m5_dir,m1_dir,output_file)


if __name__ == "__main__":
    main()
