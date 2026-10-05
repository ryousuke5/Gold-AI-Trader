#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Assemble independently cached XAUUSD M5 chunks into one dataset."
    )
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--manifest-file", required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--min-bars", type=int, default=200000)
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_file = Path(args.output_file)
    manifest_file = Path(args.manifest_file)

    files = sorted(input_dir.glob("xauusd-m5-*.json.gz"))
    if not files:
        raise RuntimeError(f"No chunk files found in {input_dir}")

    all_bars: list[dict] = []
    chunk_manifests: list[dict] = []

    for path in files:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            rows = json.load(fh)
        if not isinstance(rows, list):
            raise RuntimeError(f"Chunk is not a JSON array: {path}")
        if rows:
            times = [int(row["time"]) for row in rows]
            if times != sorted(times) or len(times) != len(set(times)):
                raise RuntimeError(f"Chunk timestamps invalid: {path}")
        all_bars.extend(rows)

        manifest_path = path.with_name(path.name.removesuffix(".json.gz") + ".manifest.json")
        if manifest_path.exists():
            chunk_manifests.append(json.loads(manifest_path.read_text(encoding="utf-8")))

    all_bars.sort(key=lambda x: int(x["time"]))
    dedup: list[dict] = []
    last_ts: int | None = None
    duplicates = 0
    for bar in all_bars:
        ts = int(bar["time"])
        if ts == last_ts:
            duplicates += 1
            continue
        dedup.append(bar)
        last_ts = ts

    if len(dedup) < args.min_bars:
        raise RuntimeError(
            f"Insufficient assembled XAUUSD M5 data: {len(dedup)} < {args.min_bars}"
        )

    start_ts = int(
        datetime.fromisoformat(args.start_date).replace(tzinfo=timezone.utc).timestamp()
    )
    end_ts = int(
        datetime.fromisoformat(args.end_date).replace(tzinfo=timezone.utc).timestamp()
    )
    if not dedup:
        raise RuntimeError("Assembled dataset is empty")
    if int(dedup[0]["time"]) < start_ts:
        raise RuntimeError("Dataset starts before requested range")
    if int(dedup[-1]["time"]) >= end_ts:
        raise RuntimeError("Dataset extends beyond requested end date")

    max_gap = 0
    non_weekend_gaps = 0
    gaps = []
    for prev, cur in zip(dedup, dedup[1:]):
        gap = int(cur["time"]) - int(prev["time"])
        max_gap = max(max_gap, gap)
        if gap > 900:
            prev_weekday = datetime.fromtimestamp(
                int(prev["time"]), timezone.utc
            ).weekday()
            if prev_weekday < 5:
                non_weekend_gaps += 1
                gaps.append(
                    {
                        "from": int(prev["time"]),
                        "to": int(cur["time"]),
                        "seconds": gap,
                    }
                )

    atomic_write_gzip_json(output_file, dedup)
    digest = hashlib.sha256(output_file.read_bytes()).hexdigest()

    manifest = {
        "instrument": "XAUUSD",
        "provider": "Dukascopy Historical Data Feed",
        "base_resolution": "M1 BID",
        "derived_resolution": "M5",
        "requested_start_date_utc": args.start_date,
        "requested_end_date_exclusive_utc": args.end_date,
        "chunk_files": [path.name for path in files],
        "chunk_count": len(files),
        "chunk_manifests_read": len(chunk_manifests),
        "m5_rows": len(dedup),
        "duplicate_timestamps_removed": duplicates,
        "non_weekend_gaps_gt_15m": non_weekend_gaps,
        "max_m5_gap_seconds": max_gap,
        "non_weekend_gap_samples": gaps[:20],
        "output_sha256": digest,
        "assembled_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    manifest_file.parent.mkdir(parents=True, exist_ok=True)
    manifest_file.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(json.dumps({"event": "assembled", **manifest}, indent=2), flush=True)


if __name__ == "__main__":
    main()
