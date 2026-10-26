#!/usr/bin/env python3
"""Summarize local MT4 demo logger output without inferring missing values."""
from __future__ import annotations
import argparse, csv, json
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np

def num(value):
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

def quantile(values, p):
    return float(np.quantile(np.asarray(values, dtype=float), p, method="linear")) if values else None

def stats(values):
    return {"n":len(values),"mean":float(np.mean(values)) if values else None,
            "median":quantile(values,.50),"p90":quantile(values,.90),
            "p95":quantile(values,.95),"max":max(values) if values else None}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--events",type=Path,required=True)
    ap.add_argument("--quotes",type=Path)
    ap.add_argument("--outdir",type=Path,required=True)
    args=ap.parse_args(); args.outdir.mkdir(parents=True,exist_ok=True)
    with args.events.open(encoding="utf-8-sig",newline="") as f:
        events=list(csv.DictReader(f))
    by_ticket=defaultdict(dict); counts=Counter(); rejected=0
    for row in events:
        event=row.get("event",""); counts[event]+=1
        if event in ("ENTRY_REJECTED","CLOSE_REJECTED"): rejected+=1
        ticket=row.get("ticket","").strip()
        if ticket and ticket not in ("0","-1"):
            by_ticket[ticket][event]=row
    trades=[]; entry_slip=[]; close_slip=[]; swaps=[]; commissions=[]; net=[]; currencies=Counter()
    for ticket, evs in by_ticket.items():
        entry=evs.get("ENTRY_FILL"); final=evs.get("CLOSE_FINAL")
        if not entry and not final: continue
        base=final or entry
        commission=num(final.get("commission_account_ccy")) if final else None
        swap=num(final.get("swap_account_ccy")) if final else None
        netval=num(final.get("net_profit_after_costs_account_ccy")) if final else None
        tr={"ticket":ticket,"symbol":base.get("symbol",""),"side":(entry or final or {}).get("side",""),
            "lots":num((entry or final or {}).get("lots")),
            "entry_request_price":num(entry.get("requested_price")) if entry else None,
            "entry_fill_price":num(entry.get("fill_price")) if entry else None,
            "entry_slippage_adverse_price":num(entry.get("slippage_adverse_price")) if entry else None,
            "entry_slippage_adverse_points":num(entry.get("slippage_adverse_points")) if entry else None,
            "entry_gmt":entry.get("gmt_time","") if entry else "",
            "close_request_price":num(final.get("requested_price")) if final else None,
            "close_fill_price":num(final.get("fill_price")) if final else None,
            "close_slippage_adverse_price":num(final.get("slippage_adverse_price")) if final else None,
            "close_slippage_adverse_points":num(final.get("slippage_adverse_points")) if final else None,
            "close_gmt":final.get("gmt_time","") if final else "",
            "commission_account_ccy":commission,"swap_account_ccy":swap,
            "profit_or_floating_account_ccy":num(final.get("profit_or_floating_account_ccy")) if final else None,
            "net_profit_after_costs_account_ccy":netval,
            "account_currency":base.get("account_currency",""),
            "holding_minutes":num(final.get("holding_minutes")) if final else None,
            "close_slippage_status":("measured against immediately pre-close logger quote" if final and num(final.get("slippage_adverse_price")) is not None else ("not measured: no pre-close reference quote" if final else "still open or no final history row"))}
        trades.append(tr)
        if tr["entry_slippage_adverse_price"] is not None: entry_slip.append(tr["entry_slippage_adverse_price"])
        if tr["close_slippage_adverse_price"] is not None: close_slip.append(tr["close_slippage_adverse_price"])
        if commission is not None: commissions.append(commission)
        if swap is not None: swaps.append(swap)
        if netval is not None: net.append(netval)
        if tr["account_currency"]: currencies[tr["account_currency"]]+=1
    fields=list(trades[0].keys()) if trades else ["ticket","symbol","side","lots","entry_request_price","entry_fill_price","entry_slippage_adverse_price","entry_slippage_adverse_points","entry_gmt","close_request_price","close_fill_price","close_slippage_adverse_price","close_slippage_adverse_points","close_gmt","commission_account_ccy","swap_account_ccy","profit_or_floating_account_ccy","net_profit_after_costs_account_ccy","account_currency","holding_minutes","close_slippage_status"]
    with (args.outdir/"demo_trade_costs.csv").open("w",encoding="utf-8-sig",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(trades)
    summary={"status":"NO_DEMO_ORDERS_LOGGED_YET" if not events else "LOCAL_DEMO_LOGS_SUMMARIZED",
       "events_file":args.events.name,"event_rows":len(events),"event_counts":dict(counts),
       "tickets_seen":len(by_ticket),"closed_tickets_with_final_costs":sum(1 for x in trades if x["net_profit_after_costs_account_ccy"] is not None),
       "entry_slippage_adverse_price":stats(entry_slip),"close_slippage_adverse_price":stats(close_slip),
       "realized_commission_account_currency":{"sum":float(sum(commissions)) if commissions else None,"n":len(commissions)},
       "realized_swap_account_currency":{"sum":float(sum(swaps)) if swaps else None,"n":len(swaps)},
       "realized_net_after_costs_account_currency":{"sum":float(sum(net)) if net else None,"n":len(net)},
       "orders_rejected":rejected,"account_currencies":dict(currencies),
       "interpretation":"Only actual records present in the local logger CSV are summarized. Missing request/fill reference prices are left blank, never inferred. Manual/SL/TP closes without a captured pre-close quote do not have exact exit slippage."}
    if args.quotes and args.quotes.exists():
        with args.quotes.open(encoding="utf-8-sig",newline="") as f: qrows=list(csv.DictReader(f))
        spreads=[float(r["spread_price"]) for r in qrows if r.get("spread_price","").strip()]
        summary["quote_file"]=args.quotes.name; summary["quote_rows"]=len(qrows); summary["spread_price"]=stats(spreads)
        summary["quote_first_gmt"]=qrows[0].get("gmt_time") if qrows else None
        summary["quote_last_gmt"]=qrows[-1].get("gmt_time") if qrows else None
    (args.outdir/"demo_execution_cost_summary.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    unit=(next(iter(currencies)) if len(currencies)==1 else "account currency")
    report=["# XM Demo Execution Cost Summary","",f"Status: **{summary['status']}**","",
       f"Events: {len(events)}; tickets seen: {len(by_ticket)}; closed tickets with final costs: {summary['closed_tickets_with_final_costs']}.","",
       "## Actual logger observations","",
       f"Entry adverse slippage (price units): {stats(entry_slip)}",
       f"Close adverse slippage (price units): {stats(close_slip)}",
       f"Realized commission total: {sum(commissions) if commissions else 'not available'} {unit}",
       f"Realized swap total: {sum(swaps) if swaps else 'not available'} {unit}",
       f"Realized net after costs total: {sum(net) if net else 'not available'} {unit}","",
       "Positive adverse slippage means the fill was worse than the price captured immediately before that logger's order/close request; negative means price improvement. The EA does not auto-send trades; probe orders require manual clicks with EnableDemoProbeOrders=true on a demo account.","",
       "This probe captures execution cost mechanics only. It does not validate the H4/H1 strategy edge. Actual MT4 records must exist before this report can show measured costs.",""]
    (args.outdir/"demo_execution_cost_summary.md").write_text("\n".join(report),encoding="utf-8")
    print(json.dumps(summary,indent=2,ensure_ascii=False))
if __name__=="__main__": main()
