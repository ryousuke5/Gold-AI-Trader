#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import lzma
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
USER_AGENT = "Gold-AI-Trader/1.0 historical-research"

def bi5_url(day: date) -> str:
    return f"{BASE_URL}/{SYMBOL}/{day.year:04d}/{day.month-1:02d}/{day.day:02d}/BID_candles_min_1.bi5"

def fetch_bytes(url: str, retries: int = 8, timeout: int = 30) -> tuple[str, bytes]:
    delay = 3.0
    for attempt in range(1, retries + 1):
        req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        try:
            with urlopen(req, timeout=timeout) as response:
                data = response.read()
                return "ok", data
        except HTTPError as exc:
            if exc.code == 404:
                return "missing", b""
            if exc.code == 429 or exc.code >= 500:
                if attempt < retries:
                    print(json.dumps({"event": "retry", "status": exc.code, "attempt": attempt, "url": url}), flush=True)
                    time.sleep(delay)
                    delay = min(delay * 2.0, 120.0)
                    continue
            raise
        except (URLError, TimeoutError, OSError) as exc:
            if attempt < retries:
                print(json.dumps({"event": "retry", "error": str(exc), "attempt": attempt, "url": url}), flush=True)
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
        bars.append({"time": ts, "open": o, "high": hi, "low": lo, "close": c, "volume": float(volume)})
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
        m5.append({
            "time": bucket,
            "open": rs[0]["open"],
            "high": max(r["high"] for r in rs),
            "low": min(r["low"] for r in rs),
            "close": rs[-1]["close"],
            "volume": sum(r["volume"] for r in rs),
        })
    return m5, incomplete

def self_test() -> None:
    day = date(2026, 1, 2)
    raw = b"".join([
        RECORD.pack(i * 60, 400000 + i, 400001 + i, 399999 + i, 400002 + i, 10.0 + i)
        for i in range(5)
    ])
    payload = lzma.compress(raw, format=lzma.FORMAT_ALONE)
    bars = parse_day(payload, day)
    assert len(bars) == 5
    assert bars[0]["time"] == int(datetime(2026, 1, 2, tzinfo=timezone.utc).timestamp())
    assert bars[0]["open"] == 400.0
    assert bars[-1]["close"] == 400.006
    m5, incomplete = resample_m1_to_m5(bars)
    assert len(m5) == 1 and incomplete == 0
    assert m5[0]["time"] == bars[0]["time"]
    print(json.dumps({"self_test": "PASS"}))

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback-days", type=int, default=1825)
    parser.add_argument("--cache-dir", default="gold-xauusd-data/raw")
    parser.add_argument("--output-file", default="gold-xauusd-data/xauusd-m5.json.gz")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--retries", type=int, default=8)
    parser.add_argument("--request-delay", type=float, default=1.5)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return

    lookback_days = max(365, args.lookback_days)
    end_day = datetime.now(timezone.utc).date()
    start_day = end_day - timedelta(days=lookback_days)

    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    output_file = Path(args.output_file)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    all_m1 = []
    missing_days = []
    requested = 0
    reused = 0
    downloaded = 0

    day = start_day
    while day < end_day:
        requested += 1
        cache_file = cache_dir / f"{day:%Y%m%d}.bi5"
        if cache_file.exists() and cache_file.stat().st_size > 0:
            raw = cache_file.read_bytes()
            reused += 1
            status = "cached"
        else:
            status, raw = fetch_bytes(bi5_url(day), retries=args.retries, timeout=args.timeout)
            if status == "missing" or not raw:
                missing_days.append(day.isoformat())
                day += timedelta(days=1)
                continue
            cache_file.write_bytes(raw)
            downloaded += 1
            time.sleep(max(0.0, args.request_delay))

        bars = parse_day(raw, day)
        all_m1.extend(bars)
        if requested % 20 == 0 or status != "cached":
            print(json.dumps({
                "event": "day",
                "date": day.isoformat(),
                "status": status,
                "m1_rows": len(bars),
                "requested_days": requested,
                "downloaded_days": downloaded,
                "cached_days": reused,
                "missing_days": len(missing_days)
            }), flush=True)
        day += timedelta(days=1)

    all_m1.sort(key=lambda x: x["time"])
    dedup_m1 = []
    last = None
    for bar in all_m1:
        if bar["time"] == last:
            continue
        dedup_m1.append(bar)
        last = bar["time"]

    m5, incomplete_m5 = resample_m1_to_m5(dedup_m1)
    if len(m5) < 200000:
        raise RuntimeError(f"Insufficient XAUUSD M5 data: {len(m5)}")

    non_weekend_gaps = 0
    max_gap = 0
    for prev, cur in zip(m5, m5[1:]):
        gap = cur["time"] - prev["time"]
        if gap > max_gap:
            max_gap = gap
        if gap > 900:
            prev_day = datetime.fromtimestamp(prev["time"], timezone.utc).weekday()
            if prev_day < 5:
                non_weekend_gaps += 1

    payload = json.dumps(m5, separators=(",", ":"), ensure_ascii=False).encode()
    with gzip.open(output_file, "wb", compresslevel=9) as fh:
        fh.write(payload)

    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()
    manifest = {
        "instrument": SYMBOL,
        "provider": "Dukascopy Historical Data Feed",
        "base_resolution": "M1 BID",
        "derived_resolution": "M5",
        "price_scale": PRICE_SCALE,
        "start_date_utc": start_day.isoformat(),
        "end_date_exclusive_utc": end_day.isoformat(),
        "requested_days": requested,
        "cached_days_reused": reused,
        "downloaded_days": downloaded,
        "missing_days_404_or_empty": len(missing_days),
        "missing_day_samples": missing_days[:20],
        "m1_rows": len(dedup_m1),
        "m5_rows": len(m5),
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
