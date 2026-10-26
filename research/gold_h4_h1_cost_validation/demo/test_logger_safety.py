from pathlib import Path
s=Path(__file__).with_name("GOLD_DemoExecutionCostLogger.mq4").read_text(encoding="utf-8")
assert "EnableDemoProbeOrders = false" in s
assert "ACCOUNT_TRADE_MODE_DEMO" in s and "return INIT_FAILED" in s
assert "Symbol() != ExpectedSymbol" in s
assert s.count("OrderSend(")==1
assert s.count("OrderClose(")==1
assert "void OnTick() { WriteQuote(); }" in s
init=s.split("int OnInit()",1)[1].split("void OnTick()",1)[0]
assert "SendDemoProbe(" not in init and "OrderSend(" not in init
print("PASS: default order switch OFF; non-demo init guard; exact-symbol guard; no automatic order send at init or tick")
