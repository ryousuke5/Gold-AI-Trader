from pathlib import Path
import csv, json, subprocess, sys, tempfile

def test_demo_summarizer():
    script = Path(__file__).with_name("summarize_demo_execution_costs.py")
    header = "event,request_id,server_time,gmt_time,server_minus_gmt_seconds,account_currency,symbol,ticket,magic,side,lots,requested_price,fill_price,slippage_adverse_price,slippage_adverse_points,bid_before,ask_before,spread_before,commission_account_ccy,swap_account_ccy,profit_or_floating_account_ccy,net_profit_after_costs_account_ccy,open_time,close_time,holding_minutes,error_code,detail".split(",")
    with tempfile.TemporaryDirectory() as directory:
        root=Path(directory); events=root/"events.csv"; quotes=root/"quotes.csv"; out=root/"out"
        rows=[
          {"event":"ENTRY_FILL","request_id":"ENTRY_1","gmt_time":"2026.10.26 10:00:00","symbol":"GOLD#","ticket":"1001","side":"BUY","lots":"0.01","requested_price":"4000.10","fill_price":"4000.15","slippage_adverse_price":"0.05","slippage_adverse_points":"5","account_currency":"USD"},
          {"event":"CLOSE_FINAL","request_id":"CLOSE_1001","gmt_time":"2026.10.27 10:00:00","symbol":"GOLD#","ticket":"1001","side":"BUY","lots":"0.01","requested_price":"4005.00","fill_price":"4004.98","slippage_adverse_price":"0.02","slippage_adverse_points":"2","commission_account_ccy":"0","swap_account_ccy":"-0.15","profit_or_floating_account_ccy":"4.83","net_profit_after_costs_account_ccy":"4.68","account_currency":"USD","holding_minutes":"1440"}]
        with events.open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=header);w.writeheader();w.writerows(rows)
        quotes.write_text("server_time,gmt_time,server_minus_gmt_seconds,symbol,bid,ask,spread_price,spread_points,connected\n2026.10.26 10:00:00,2026.10.26 10:00:00,0,GOLD#,4000.00,4000.20,0.20,20,1\n")
        subprocess.run([sys.executable,str(script),"--events",str(events),"--quotes",str(quotes),"--outdir",str(out)],check=True,capture_output=True,text=True)
        result=json.loads((out/"demo_execution_cost_summary.json").read_text())
        assert result["tickets_seen"]==1
        assert result["closed_tickets_with_final_costs"]==1
        assert result["entry_slippage_adverse_price"]["mean"]==0.05
        assert result["close_slippage_adverse_price"]["mean"]==0.02
        assert result["realized_swap_account_currency"]["sum"]==-0.15
        assert result["realized_net_after_costs_account_currency"]["sum"]==4.68

if __name__=="__main__":
    test_demo_summarizer()
    print("PASS: synthetic entry/close slippage, commission/swap/net calculations")
