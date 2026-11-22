# FXTF V19 MT5 Adapter Implementation — 2026-11-22

Branch: feat/fxtf-mt5-gold-migration
Status: source update committed; GitHub static checks and repository test suite passed; MetaEditor 5 compilation and runtime verification pending.

## Changed source files

- mt5/GoldAITraderV19_MT5_Research.mq5
- mt5/include/GoldV19MT5_Common.mqh
- mt5/include/GoldV19MT5_Time.mqh
- mt5/include/GoldV19MT5_MarketData.mqh
- mt5/include/GoldV19MT5_MarketSafety.mqh
- mt5/include/GoldV19MT5_Flow.mqh

Unchanged modules retained:
- mt5/include/GoldV19MT5_Payload.mqh
- mt5/include/GoldV19MT5_Http.mqh

## FXTF-specific controls added

- Default terminal symbol is XAUUSD.
- Account server must match FXTF-MT5, company must contain Goldenway, and deposit currency must be JPY.
- Strict symbol validation checks the observed XAUUSD metadata: base XAU, profit USD, point 0.01, tick size 0.01, contract size 1, minimum volume 1 and volume step 1. Tick value remains dynamically read in account currency (JPY); it is not hardcoded.
- Server UTC offset accepts FXTF's GMT+2 or GMT+3 only. Strategy Tester time cannot certify this offset because TimeGMT() behavior is simulated there.
- SymbolInfoSessionTrade() is used to block the terminal outside the FXTF broker session. The observed schedule is Monday–Friday 01:05–23:55 broker time (subject to broker schedule changes).
- A fresh first-session tick and any observed quote gap of at least 30 minutes starts a 30-minute market-reopen lock. This is intentionally conservative and should be forward-observed; it is not an execution optimization.
- Quote age is calculated against TimeTradeServer(), because TimeCurrent() can remain at the last quote while the market is closed.
- Daily realized P/L includes DEAL_COMMISSION and DEAL_FEE on every matching symbol+magic deal, including entry-side charges, rather than only closing-side deals. This must still be reconciled against FXTF History > Deals after the first actual commission posting; do not use this EA as a live risk authority yet.
- Peak-equity and market-safety terminal Global Variables are namespaced by broker server, account login, symbol and scope.
- Render network requests are hard-blocked unless AccountInfoInteger(ACCOUNT_TRADE_MODE) is DEMO. The currently logged-in REAL FXTF account therefore stays local-only even if network input switches are accidentally changed to true.
- No MQL5 order execution APIs are present. Strategy version and GOLD V2 thresholds were not changed.

## Install layout

Copy the updated main EA and all seven include modules from the repository into:
MQL5/Experts/GoldAITrader/

Resulting layout:
- GoldAITraderV19_MT5_Research.mq5
- include/GoldV19MT5_Common.mqh
- include/GoldV19MT5_Time.mqh
- include/GoldV19MT5_MarketData.mqh
- include/GoldV19MT5_MarketSafety.mqh
- include/GoldV19MT5_Payload.mqh
- include/GoldV19MT5_Http.mqh
- include/GoldV19MT5_Flow.mqh

Do not overwrite the existing XM MT4 files. Keep the old MT5 research EA as a backup before replacing its files.

## Validation status

Passed:
- GitHub workflow GOLD V19 MT5 and FXTF GOLD Static Checks
- GitHub workflow Gold AI Trader Tests

Not yet completed:
- MetaEditor 5 compile (0 errors / warnings review)
- FXTF MT5 live-session quote freshness and server-time validation
- FXTF demo-only telemetry test
- FXTF History > Deals commission reconciliation
- M5/H1 UTC payload fixture comparison
- broker-cost IS/OOS and Forward validation

Do not merge this branch into main, deploy a production change, or enable live account network requests until the remaining checks are complete.
