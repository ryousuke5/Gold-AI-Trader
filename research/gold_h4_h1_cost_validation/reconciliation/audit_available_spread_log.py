#!/usr/bin/env python3
"""Reconcile a currently available XM MT4 quote CSV against an optional legacy summary."""
from __future__ import annotations
import argparse, csv, hashlib, json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

FMT = "%Y.%m.%d %H:%M:%S"

def quantile(values, p):
    return float(np.quantile(np.asarray(values, dtype=float), p, method="linear")) if values else None

def stats(values):
    return {
        "rows": len(values),
        "mean": float(np.mean(values)) if values else None,
        "median": quantile(values, .50),
        "p90": quantile(values, .90),
        "p95": quantile(values, .95),
        "p99": quantile(values, .99),
        "p995": quantile(values, .995),
        "max": float(np.max(values)) if values else None,
        "gt_0_50": sum(v > .50 for v in values),
        "gt_0_75": sum(v > .75 for v in values),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw_csv", type=Path)
    ap.add_argument("--outdir", type=Path, required=True)
    ap.add_argument("--legacy-summary", type=Path)
    args = ap.parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)
    hasher = hashlib.sha256()
    with args.raw_csv.open("rb") as bf:
        for block in iter(lambda: bf.read(1024 * 1024), b""):
            hasher.update(block)
    digest = hasher.hexdigest()

    rows = 0
    first = last = None
    symbols = Counter()
    labels = Counter()
    servers = Counter()
    connected = Counter()
    exact = Counter()
    all_spreads = []
    hours = defaultdict(list)
    days = defaultdict(list)
    bad_quotes = spread_mismatch = 0

    with args.raw_csv.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        required = {"gmt_time", "server_time", "symbol", "log_label", "account_server", "bid", "ask", "spread_price", "connected"}
        missing = required - set(fields)
        if missing:
            raise SystemExit(f"Missing required columns: {sorted(missing)}")
        for row in reader:
            rows += 1
            # Count exact whole-row repeats; do not remove them from metrics.
            key = tuple(row.get(k, "") for k in fields)
            exact[key] += 1
            dt = datetime.strptime(row["gmt_time"], FMT).replace(tzinfo=timezone.utc)
            if first is None:
                first = dt
            last = dt
            bid, ask, spread = float(row["bid"]), float(row["ask"]), float(row["spread_price"])
            if bid <= 0 or ask <= 0 or ask < bid:
                bad_quotes += 1
            if abs((ask - bid) - spread) > .011:
                spread_mismatch += 1
            symbols[row["symbol"]] += 1
            labels[row["log_label"]] += 1
            servers[row["account_server"]] += 1
            connected[row["connected"]] += 1
            all_spreads.append(spread)
            hours[dt.hour].append(spread)
            days[dt.date().isoformat()].append(spread)

    duplicate_rows = sum(n - 1 for n in exact.values() if n > 1)
    active = [v for h, xs in hours.items() if 7 <= h <= 20 for v in xs]
    rollover = hours.get(22, [])
    result = {
        "audit_status": "CURRENT_RAW_CSV_RECONCILED; LEGACY_LONG_SUMMARY_NOT_REPRODUCIBLE_FROM_THIS_FILE",
        "source_file": args.raw_csv.name,
        "sha256": digest,
        "rows": rows,
        "first_gmt_utc": first.isoformat() if first else None,
        "last_gmt_utc": last.isoformat() if last else None,
        "duration_hours": (last - first).total_seconds() / 3600 if first and last else None,
        "symbols": dict(symbols),
        "log_labels": dict(labels),
        "account_servers_in_source_metadata": dict(servers),
        "connection_flags": dict(connected),
        "invalid_bid_ask_rows": bad_quotes,
        "spread_arithmetic_mismatch_rows": spread_mismatch,
        "exact_duplicate_rows_beyond_first": duplicate_rows,
        "duplicate_policy": "Keep all logged rows in metrics; duplicate count is disclosed separately.",
        "all_rows": stats(all_spreads),
        "utc_hours_07_to_20_inclusive": stats(active),
        "utc_hour_22": stats(rollover),
        "daily": {d: stats(xs) for d, xs in sorted(days.items())},
    }
    if args.legacy_summary and args.legacy_summary.exists():
        with args.legacy_summary.open("r", encoding="utf-8-sig", newline="") as f:
            legacy = list(csv.DictReader(f))
        legacy_counts = [int(float(x["rows"])) for x in legacy if x.get("rows")]
        result["legacy_summary_path"] = args.legacy_summary.name
        result["legacy_summary_expected_rows_by_rows_column"] = legacy_counts
        result["legacy_summary_matches_raw_row_count"] = all(n == rows for n in legacy_counts)
        if any(n != rows for n in legacy_counts):
            result["missing_rows_to_first_legacy_count"] = (legacy_counts[0] - rows) if legacy_counts else None
            result["reconciliation_note"] = (
                "Legacy summary describes a different/later source snapshot. This raw file cannot reproduce the legacy row count/time range. "
                "Do not infer or fabricate missing ticks; keep the older summary marked unreconciled until its matching raw CSV is available."
            )
    (args.outdir / "spread_log_reconciliation.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    with (args.outdir / "spread_log_reconciled_summary.csv").open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["sample", "rows", "mean", "median", "p90", "p95", "p99", "p995", "max", "gt_0_50", "gt_0_75", "source_sha256", "source_start_utc", "source_end_utc"]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for label, xs in (("All rows currently available", all_spreads), ("UTC hours 07-20 inclusive", active), ("UTC hour 22", rollover)):
            writer.writerow({"sample": label, **stats(xs), "source_sha256": digest,
                             "source_start_utc": first.isoformat() if first else "",
                             "source_end_utc": last.isoformat() if last else ""})
    with (args.outdir / "spread_by_utc_hour_reconciled.csv").open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["utc_hour", "rows", "mean", "median", "p90", "p95", "p99", "p995", "max", "gt_0_50", "gt_0_75"]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for h, xs in sorted(hours.items()):
            writer.writerow({"utc_hour": h, **stats(xs)})
    with (args.outdir / "spread_by_utc_date_reconciled.csv").open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["utc_date", "rows", "mean", "median", "p90", "p95", "p99", "p995", "max", "gt_0_50", "gt_0_75"]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for d, xs in sorted(days.items()):
            writer.writerow({"utc_date": d, **stats(xs)})
    print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
