#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import lzma
import struct
from datetime import date, datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://datafeed.dukascopy.com/datafeed"
SYMBOL = "XAUUSD"
RECORD = struct.Struct(">IIIIIf")
PRICE_SCALE = 1000.0
USER_AGENT = "Gold-AI-Trader/1.0 m5-probe"


def url_for(day: date) -> str:
    return (
        f"{BASE_URL}/{SYMBOL}/{day.year:04d}/{day.month-1:02d}/"
        f"{day.day:02d}/BID_candles_min_5.bi5"
    )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--date", default="2026-09-30")
    args = p.parse_args()

    day = date.fromisoformat(args.date)
    url = url_for(day)
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})

    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read()
            status = resp.status
    except HTTPError as exc:
        print(json.dumps({
            "ok": False, "date": args.date, "url": url,
            "http_status": exc.code, "reason": "http_error"
        }, indent=2))
        raise SystemExit(2)
    except (URLError, TimeoutError, OSError) as exc:
        print(json.dumps({
            "ok": False, "date": args.date, "url": url,
            "reason": "network_error", "error": str(exc)
        }, indent=2))
        raise SystemExit(3)

    if status != 200 or not raw:
        print(json.dumps({
            "ok": False, "date": args.date, "url": url,
            "http_status": status, "compressed_bytes": len(raw),
            "reason": "empty_or_non_200"
        }, indent=2))
        raise SystemExit(4)

    data = lzma.decompress(raw)
    if len(data) % RECORD.size != 0:
        raise RuntimeError(f"Invalid record alignment: {len(data)}")

    rows = []
    base_ts = int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp())
    for offset in range(0, len(data), RECORD.size):
        sec, o_raw, c_raw, lo_raw, hi_raw, vol = RECORD.unpack_from(data, offset)
        if sec >= 86400 or sec % 300 != 0:
            raise RuntimeError(f"Invalid 5m offset: {sec}")
        o, c, lo, hi = (
            o_raw / PRICE_SCALE,
            c_raw / PRICE_SCALE,
            lo_raw / PRICE_SCALE,
            hi_raw / PRICE_SCALE,
        )
        if not (o > 0 and c > 0 and lo > 0 and hi >= max(o, c) and lo <= min(o, c)):
            raise RuntimeError("Invalid OHLC")
        rows.append((base_ts + sec, o, c, lo, hi, float(vol)))

    if not rows:
        raise RuntimeError("No M5 bars")

    times = [r[0] for r in rows]
    if len(set(times)) != len(times):
        raise RuntimeError("Duplicate M5 timestamps")
    if any(b - a != 300 for a, b in zip(times, times[1:])):
        raise RuntimeError("Non-contiguous 5m timestamps inside native file")

    print(json.dumps({
        "ok": True,
        "date": args.date,
        "url": url,
        "http_status": status,
        "compressed_bytes": len(raw),
        "decompressed_bytes": len(data),
        "m5_rows": len(rows),
        "first_bar": {
            "time": times[0],
            "open": rows[0][1],
            "close": rows[0][2],
            "low": rows[0][3],
            "high": rows[0][4],
            "volume": rows[0][5],
        },
        "last_bar_time": times[-1],
    }, indent=2))


if __name__ == "__main__":
    main()
