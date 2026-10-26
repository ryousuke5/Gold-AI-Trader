#!/usr/bin/env python3
"""Cost sensitivity for frozen H4_H1PR_01 only. Research diagnostics; never sends orders."""
from __future__ import annotations
import argparse, csv, gzip, hashlib, json
from datetime import datetime, timezone
from pathlib import Path
import numpy as np

DATA_SHA256 = "a7e6c7b9af8762bd0b02af1fc407c42e9d6c0be4c09d63c54cc87da14887e780"
IS_END = int(datetime(2024, 10, 6, tzinfo=timezone.utc).timestamp())
OOS_END = int(datetime(2026, 10, 5, tzinfo=timezone.utc).timestamp())
FROZEN = {"tol": 0.15, "stopbuf": 0.10, "rr": 2.0}
SCENARIOS = [
    ("observed_snapshot_median", 0.26, 0.05),
    ("observed_snapshot_p95_rounded_up", 0.30, 0.05),
    ("observed_snapshot_max_rounded_up", 0.45, 0.05),
    ("prior_research_baseline", 0.55, 0.05),
    ("conservative_stress", 0.75, 0.10),
    ("severe_stress_1p0", 1.00, 0.10),
    ("severe_stress_1p5", 1.50, 0.20),
    ("severe_stress_2p0", 2.00, 0.25),
]

def load_bars(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        rows = json.load(f)
    rows.sort(key=lambda x: int(x["time"]))
    return {k: np.array([int(x[k]) if k == "time" else float(x.get(k, 0)) for x in rows],
                        dtype=np.int64 if k == "time" else float)
            for k in ("time", "open", "high", "low", "close", "volume")}

def aggregate(b, seconds, min_count):
    t=b["time"]; bucket=(t//seconds)*seconds
    starts=np.flatnonzero(np.r_[True, bucket[1:] != bucket[:-1]]); ends=np.r_[starts[1:],len(t)]
    out={k:[] for k in ("time","open","high","low","close","volume","count")}
    for s,e in zip(starts,ends):
        if e-s < min_count: continue
        out["time"].append(int(bucket[s])); out["open"].append(float(b["open"][s]))
        out["high"].append(float(np.max(b["high"][s:e]))); out["low"].append(float(np.min(b["low"][s:e])))
        out["close"].append(float(b["close"][e-1])); out["volume"].append(float(np.sum(b["volume"][s:e])))
        out["count"].append(e-s)
    return {k:np.array(v,dtype=np.int64 if k in ("time","count") else float) for k,v in out.items()}

def ema(x, n):
    out=np.full(len(x),np.nan); alpha=2/(n+1); prev=np.nan
    for i,v in enumerate(x):
        if not np.isfinite(v): continue
        prev=v if not np.isfinite(prev) else alpha*v+(1-alpha)*prev; out[i]=prev
    return out

def atr(b, n=14):
    h,l,c=b["high"],b["low"],b["close"]; tr=np.full(len(c),np.nan)
    tr[0]=h[0]-l[0]
    tr[1:]=np.maximum(h[1:]-l[1:],np.maximum(np.abs(h[1:]-c[:-1]),np.abs(l[1:]-c[:-1])))
    out=np.full(len(c),np.nan)
    if len(c)<=n: return out
    v=float(np.nanmean(tr[1:n+1])); out[n]=v
    for i in range(n+1,len(c)):
        v=(v*(n-1)+tr[i])/n; out[i]=v
    return out

def rsi(c, n=14):
    out=np.full(len(c),np.nan)
    if len(c)<=n: return out
    d=np.diff(c); gain=np.maximum(d,0); loss=np.maximum(-d,0)
    ag=float(np.mean(gain[:n])); al=float(np.mean(loss[:n]))
    out[n]=100 if al==0 else 100-100/(1+ag/al)
    for i in range(n+1,len(c)):
        j=i-1; ag=(ag*(n-1)+gain[j])/n; al=(al*(n-1)+loss[j])/n
        out[i]=100 if al==0 else 100-100/(1+ag/al)
    return out

def build_signals(h1,h4):
    h1["ema20"]=ema(h1["close"],20); h1["atr"]=atr(h1); h1["rsi"]=rsi(h1["close"])
    h4["ema50"]=ema(h4["close"],50); h4["ema200"]=ema(h4["close"],200)
    qi=np.searchsorted(h4["time"]+14400,h1["time"]+3600,side="right")-1
    side=np.zeros(len(h1["time"]),dtype=np.int8); tol=FROZEN["tol"]
    for i in range(3,len(h1["time"])-1):
        q=qi[i]
        vals=(h1["ema20"][i],h1["atr"][i],h1["rsi"][i],h1["ema20"][i-1],h1["atr"][i-1])
        if q<0 or not all(np.isfinite(x) for x in vals+(h4["ema50"][q],h4["ema200"][q])): continue
        pa=h1["atr"][i-1]; up=h4["close"][q]>h4["ema50"][q]>h4["ema200"][q]
        dn=h4["close"][q]<h4["ema50"][q]<h4["ema200"][q]
        tl=abs(h1["low"][i-1]-h1["ema20"][i-1])<=tol*pa
        ts=abs(h1["high"][i-1]-h1["ema20"][i-1])<=tol*pa
        loc=(h1["close"][i]-h1["low"][i])/max(h1["high"][i]-h1["low"][i],1e-12)
        if up and tl and h1["close"][i]>h1["high"][i-1] and h1["close"][i]>h1["ema20"][i] and h1["close"][i]>h1["open"][i] and loc>=.60 and 48<=h1["rsi"][i]<=70: side[i]=1
        elif dn and ts and h1["close"][i]<h1["low"][i-1] and h1["close"][i]<h1["ema20"][i] and h1["close"][i]<h1["open"][i] and loc<=.40 and 30<=h1["rsi"][i]<=52: side[i]=-1
    return side, np.flatnonzero(side)

def simulate(h1, side, indices, spread, slip, start, end):
    t,o,hi,lo,cl,a=h1["time"],h1["open"],h1["high"],h1["low"],h1["close"],h1["atr"]
    trades=[]; next_allowed=0
    for i in indices:
        if i+1>=len(t): continue
        if not start <= t[i]+3600 < end: continue
        j=i+1
        if t[j]-t[i]!=3600 or j<next_allowed: continue
        av=a[i]
        if not np.isfinite(av) or av<=0 or abs(o[j]-cl[i])>.75*av: continue
        s=int(side[i])
        if s>0:
            entry=o[j]+spread+slip; sl=float(np.min(lo[max(0,i-3):i]))-FROZEN["stopbuf"]*av; risk=entry-sl
            if risk<=0 or risk<.60*av or risk>2.80*av: continue
            tp=entry+FROZEN["rr"]*risk
        else:
            entry=o[j]-slip; sl=float(np.max(hi[max(0,i-3):i]))+spread+FROZEN["stopbuf"]*av; risk=sl-entry
            if risk<=0 or risk<.60*av or risk>2.80*av: continue
            tp=entry-FROZEN["rr"]*risk
        if not start<=t[j]<end: continue
        xp=reason=xi=None; last=min(len(t)-1,j+23)
        for k in range(j,last+1):
            if t[k]>=end: break
            if k>j and t[k]-t[k-1]>3*3600:
                p=k-1; xp=cl[p]-slip if s>0 else cl[p]+spread+slip; reason="DATA_GAP_EXIT"; xi=p; break
            if s>0:
                if lo[k]<=sl: xp=(min(sl,o[k]) if o[k]<sl else sl)-slip; reason="STOP"; xi=k; break
                if hi[k]>=tp: xp=(max(tp,o[k]) if o[k]>tp else tp)-slip; reason="TARGET"; xi=k; break
            else:
                ah,al,ao=hi[k]+spread,lo[k]+spread,o[k]+spread
                if ah>=sl: xp=(max(sl,ao) if ao>sl else sl)+slip; reason="STOP"; xi=k; break
                if al<=tp: xp=(min(tp,ao) if ao<tp else tp)+slip; reason="TARGET"; xi=k; break
        if xp is None:
            xi=last; xp=cl[xi]-slip if s>0 else cl[xi]+spread+slip; reason="TIME"
        pnl=(xp-entry) if s>0 else (entry-xp)
        trades.append({"entry_time":int(t[j]),"exit_time":int(t[xi]+3600),"side":"BUY" if s>0 else "SELL",
                       "net_R":float(pnl/risk),"risk_price":float(risk),"reason":reason,
                       "spread":spread,"slippage_each_side":slip})
        next_allowed=xi+1
    return trades

def stats(trades):
    r=np.array([x["net_R"] for x in trades],dtype=float)
    if len(r)==0: return {"trades":0,"wins":0,"losses":0,"win_rate_pct":0.0,"PF":0.0,"expectancy_R":0.0,"net_R":0.0,"maxDD_R":0.0}
    gp=float(r[r>0].sum()); gl=float(-r[r<0].sum()); pf=gp/gl if gl else (float("inf") if gp else 0.0)
    eq=np.cumsum(r); peaks=np.maximum.accumulate(np.r_[0.,eq])[1:]; dd=peaks-eq
    return {"trades":len(r),"wins":int((r>0).sum()),"losses":int((r<0).sum()),
            "win_rate_pct":float((r>0).mean()*100),"PF":float(pf),"expectancy_R":float(r.mean()),
            "net_R":float(r.sum()),"maxDD_R":float(dd.max(initial=0))}

def save_csv(path, rows):
    with path.open("w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data",type=Path,required=True); ap.add_argument("--outdir",type=Path,required=True)
    ap.add_argument("--allow-unverified-data",action="store_true")
    args=ap.parse_args(); digest=hashlib.sha256(args.data.read_bytes()).hexdigest()
    if digest!=DATA_SHA256 and not args.allow_unverified_data:
        raise SystemExit(f"Dataset SHA-256 mismatch: {digest}; expected {DATA_SHA256}")
    b=load_bars(args.data); h1=aggregate(b,3600,10); h4=aggregate(b,14400,40)
    side,idx=build_signals(h1,h4); is_start=int(b["time"][0])
    periods={"IS":(is_start,IS_END),"OOS":(IS_END,OOS_END)}; rows=[]; annual=[]; logs=[]
    for name,spread,slip in SCENARIOS:
        for p,(start,end) in periods.items():
            tr=simulate(h1,side,idx,spread,slip,start,end); st=stats(tr)
            rows.append({"scenario":name,"spread_price":spread,"slippage_each_side":slip,"period":p,**st})
            logs.extend({"scenario":name,"period":p,**x} for x in tr)
            if p=="OOS":
                cuts=[("OOS_year1",IS_END,int(datetime(2025,10,6,tzinfo=timezone.utc).timestamp())),
                      ("OOS_year2",int(datetime(2025,10,6,tzinfo=timezone.utc).timestamp()),OOS_END)]
                for label,lo,hi in cuts:
                    annual.append({"scenario":name,"spread_price":spread,"slippage_each_side":slip,"period":label,**stats([x for x in tr if lo<=x["entry_time"]<hi])})
    baseline={x["period"]:x for x in rows if x["scenario"]=="prior_research_baseline"}
    refs={"IS":{"trades":167,"PF":1.1610901417365855,"expectancy_R":0.09054014268059479,"net_R":15.120203827659331,"maxDD_R":15.832543137641574},
          "OOS":{"trades":114,"PF":1.3754769459047471,"expectancy_R":0.19232976823017853,"net_R":21.925593578240353,"maxDD_R":11.62214717931311}}
    for p, expected in refs.items():
        for metric,target in expected.items():
            value=baseline[p][metric]
            if (isinstance(target,int) and value!=target) or (isinstance(target,float) and abs(value-target)>1e-8):
                raise SystemExit(f"Frozen baseline mismatch: {p}.{metric}={value}; expected {target}")
    args.outdir.mkdir(parents=True,exist_ok=True)
    save_csv(args.outdir/"frozen_cost_sensitivity.csv",rows)
    save_csv(args.outdir/"frozen_cost_sensitivity_oos_annual.csv",annual)
    save_csv(args.outdir/"frozen_cost_sensitivity_trade_log.csv",logs)
    print(f"PASS: data SHA-256 {digest}; frozen baseline reproduced exactly.")
    for x in rows: print(x["scenario"],x["period"],x["trades"],f"PF={x['PF']:.3f}",f"E={x['expectancy_R']:+.3f}R",f"net={x['net_R']:+.3f}R")
if __name__=="__main__": main()
