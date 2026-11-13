#!/usr/bin/env python3
"""Build the compact XM GOLD# server-hour spread profile from a quote-log ZIP/CSV.

Requires pandas. Example:
  python scripts/build-gold-xm-spread-profile.py GOLD_KIWAMI_SpreadLog.zip \
    --output data/gold_xm_empirical_spread_profile_20261113.json

This analysis step removes exact duplicate quote rows and uses account_server,
not the manually entered log_label, to separate accounts.
"""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

import pandas as pd

USECOLS = [
    "server_time", "gmt_time", "account_server", "symbol",
    "bid", "ask", "spread_price", "point", "digits", "connected"
]
DEDUP = ["gmt_time", "account_server", "symbol", "bid", "ask", "spread_price"]
QUANTILES = {"p50": 0.50, "p75": 0.75, "p90": 0.90, "p95": 0.95, "p99": 0.99}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    digest = hashlib.sha256(args.source.read_bytes()).hexdigest()
    if args.source.suffix.lower() == ".zip":
        with zipfile.ZipFile(args.source) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if len(names) != 1:
                raise SystemExit(f"Expected exactly one CSV member, found {names}")
            member = names[0]
            with archive.open(member) as handle:
                frame = pd.read_csv(handle, usecols=USECOLS)
    else:
        member = args.source.name
        frame = pd.read_csv(args.source, usecols=USECOLS)
    raw_rows = len(frame)
    invalid = (
        frame[["bid", "ask", "spread_price"]].isna().any(axis=1)
        | (frame["bid"] <= 0) | (frame["ask"] < frame["bid"])
        | (frame["connected"] != 1)
    )
    mismatch = ((frame["ask"] - frame["bid"] - frame["spread_price"]).abs() > 0.011)
    symbols = frame["symbol"].value_counts().to_dict()
    raw_by_server = frame["account_server"].value_counts().to_dict()
    frame = frame.drop_duplicates(subset=DEDUP, keep="first").copy()
    frame["server_hour"] = pd.to_datetime(
        frame["server_time"], format="%Y.%m.%d %H:%M:%S", errors="coerce"
    ).dt.hour

    profiles = {}
    for server, group in frame.groupby("account_server", sort=True):
        spread = group["spread_price"].astype(float)
        global_stats = {name: round(float(spread.quantile(q)), 4) for name, q in QUANTILES.items()}
        global_stats["max"] = round(float(spread.max()), 4)
        hours = {}
        for hour, hourly in group.groupby("server_hour", sort=True):
            values = hourly["spread_price"].astype(float)
            stats = {name: round(float(values.quantile(q)), 4) for name, q in QUANTILES.items()}
            stats["observations"] = int(len(values))
            stats["max"] = round(float(values.max()), 4)
            hours[str(int(hour))] = stats
        utc = pd.to_datetime(group["gmt_time"], format="%Y.%m.%d %H:%M:%S", utc=True)
        profiles[str(server)] = {
            "account_server": str(server),
            "raw_observations": int(raw_by_server[str(server)]),
            "unique_observations": int(len(group)),
            "sample_start_utc": utc.min().isoformat().replace("+00:00", "Z"),
            "sample_end_utc": utc.max().isoformat().replace("+00:00", "Z"),
            "global": global_stats,
            "hours": hours,
        }

    result = {
        "schema_version": 1,
        "profile_id": "xm-gold-kiwami-spread-rebuilt",
        "instrument": "GOLD#",
        "server_timezone": "Europe/Nicosia",
        "source": {
            "file": args.source.name, "archive_member": member, "sha256": digest,
            "raw_rows": raw_rows, "duplicate_rows_removed": raw_rows - len(frame),
            "unique_rows": len(frame), "invalid_quote_rows": int(invalid.sum()),
            "ask_bid_spread_mismatch_rows_gt_0_011": int(mismatch.sum()),
            "symbols": {str(k): int(v) for k, v in symbols.items()},
            "account_server_raw_rows": {str(k): int(v) for k, v in raw_by_server.items()},
        },
        "deduplication": "Exact duplicates by gmt_time, account_server, symbol, bid, ask, spread_price; first row retained.",
        "profiles": profiles,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "raw_rows": raw_rows, "unique_rows": len(frame),
        "duplicate_rows_removed": raw_rows - len(frame),
        "invalid_quote_rows": int(invalid.sum()),
        "spread_mismatch_rows": int(mismatch.sum()),
        "accounts": list(profiles),
        "output": str(args.output),
    }, indent=2))


if __name__ == "__main__":
    main()
