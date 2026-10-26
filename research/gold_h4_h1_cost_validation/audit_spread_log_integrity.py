#!/usr/bin/env python3
"""Privacy-conscious integrity audit for a GOLD MT4 Bid/Ask spread-log CSV."""
from __future__ import annotations
import argparse, csv, hashlib, json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

FMT = "%Y.%m.%d %H:%M:%S"

def q(a,p):
    return float(np.quantile(a,p,method="linear")) if len(a) else None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("csv_path",type=Path); ap.add_argument("--outdir",type=Path,required=True)
    args=ap.parse_args(); args.outdir.mkdir(parents=True,exist_ok=True)
    digest=hashlib.sha256(args.csv_path.read_bytes()).hexdigest()
    n=dupes=bad=spread_mismatch=0; seen=set(); times=[]; spreads=[]
    symbols=Counter(); connection=Counter(); hours=defaultdict(list)
    with args.csv_path.open("r",newline="",encoding="utf-8-sig") as f:
        rd=csv.DictReader(f)
        required={"gmt_time","symbol","bid","ask","spread_price","connected"}
        missing=required-set(rd.fieldnames or [])
        if missing: raise SystemExit(f"Missing columns: {sorted(missing)}")
        for row in rd:
            n+=1
            key=tuple(row.get(k,"") for k in (rd.fieldnames or []))
            if key in seen: dupes+=1
            else: seen.add(key)
            symbols[row["symbol"]]+=1; connection[row["connected"]]+=1
            dt=datetime.strptime(row["gmt_time"],FMT).replace(tzinfo=timezone.utc)
            times.append(dt.timestamp()); bid=float(row["bid"]); ask=float(row["ask"]); sp=float(row["spread_price"])
            if bid<=0 or ask<=0 or ask<bid: bad+=1
            if abs((ask-bid)-sp)>0.011: spread_mismatch+=1
            spreads.append(sp); hours[dt.hour].append(sp)
    a=np.asarray(spreads,dtype=float)
    result={"file_name":args.csv_path.name,"sha256":digest,"rows":n,
            "timestamp_start_utc":datetime.fromtimestamp(min(times),timezone.utc).isoformat() if times else None,
            "timestamp_end_utc":datetime.fromtimestamp(max(times),timezone.utc).isoformat() if times else None,
            "duration_hours":(max(times)-min(times))/3600 if times else None,
            "symbols":dict(symbols),"connection_flag_counts":dict(connection),
            "exact_duplicate_rows_after_first_occurrence":dupes,"invalid_bid_ask_rows":bad,
            "ask_minus_bid_mismatch_rows_tolerance_0_011":spread_mismatch,
            "spread_mean":float(a.mean()) if len(a) else None,"spread_median":q(a,.5),
            "spread_p90":q(a,.9),"spread_p95":q(a,.95),"spread_p99":q(a,.99),
            "spread_p995":q(a,.995),"spread_max":float(a.max()) if len(a) else None,
            "spread_gt_0_50_rows":int((a>.5).sum()),"spread_gt_0_75_rows":int((a>.75).sum()),
            "duplicate_policy":"Keep every input row in metrics; exact duplicates counted separately."}
    (args.outdir/"spread_log_integrity_summary.json").write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    path=args.outdir/"spread_log_integrity_by_utc_hour.csv"
    fields=["utc_hour","rows","mean","median","p90","p95","p99","max","gt_0_50_rows","gt_0_75_rows"]
    with path.open("w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader()
        for h,vals in sorted(hours.items()):
            x=np.asarray(vals,dtype=float)
            w.writerow({"utc_hour":h,"rows":len(x),"mean":x.mean(),"median":q(x,.5),"p90":q(x,.9),
                        "p95":q(x,.95),"p99":q(x,.99),"max":x.max(),
                        "gt_0_50_rows":int((x>.5).sum()),"gt_0_75_rows":int((x>.75).sum())})
    print(json.dumps(result,indent=2))

if __name__=="__main__": main()
