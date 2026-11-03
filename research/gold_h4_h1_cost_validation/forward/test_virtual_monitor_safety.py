from pathlib import Path

src = Path(__file__).with_name("GOLD_H4_H1PR01_VirtualMonitor.mq4").read_text(encoding="utf-8")
upper = src.upper()
for forbidden in ("ORDERSEND", "ORDERCLOSE", "ORDERMODIFY", "ORDERDELETE", "ORDERCLOSEBY"):
    assert forbidden not in upper, f"Forbidden trading API reference found: {forbidden}"
assert 'ExpectedSymbol = "GOLD#"' in src
assert "RequireDemoAccount = true" in src
assert "ACCOUNT_TRADE_MODE_DEMO" in src
assert "ServerTimeToUtc" in src and "CurrentOffsetMatchesSchedule" in src
assert "BuildUtcBars(H1_SECONDS,12,g_h1)" in src
assert "BuildUtcBars(H4_SECONDS,48,g_h4)" in src
assert "g_h1[i].close>g_h1[i-1].high" in src
assert "g_h1[i].close<g_h1[i-1].low" in src
assert "rsiCurrent>=48.0 && rsiCurrent<=70.0" in src
assert "rsiCurrent>=30.0 && rsiCurrent<=52.0" in src
assert "targetPrice = (side>0 ? entryPrice+2.0*riskPrice : entryPrice-2.0*riskPrice)" in src
assert "riskAtr<0.60 || riskAtr>2.80" in src
assert "MaxM5HistoryBars = 90000" in src
assert "HistoryDiagnosticText()" in src
assert "H1_COMPLETE_BAR_COUNT_BELOW_MINIMUM" in src
assert "H4_COMPLETE_BAR_COUNT_BELOW_MINIMUM" in src
assert "M5_TOTAL=%d;M5_USED=%d;H1=%d/%d;H4=%d/%d" in src
assert "MinH4Bars = 1000" in src
assert "WAITING_FOR_FRESH_SERVER_UTC_OFFSET_CONFIRMATION" in src
assert "FRESH_SERVER_UTC_OFFSET_CONFIRMED" in src
print("PASS: no order API references; demo/symbol guards; UTC bar reconstruction; frozen rules; EMA200 warmup; stale-clock startup guard")
