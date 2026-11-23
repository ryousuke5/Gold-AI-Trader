# MT5 V19 Local Forward CSV Logging

Status: read-only local capture; no order-execution feature is included.

## Behavior

- `EnableLocalForwardLogging` defaults to `true`.
- The timer captures one row for each newly completed M5 bar after `UpdateMarketSafety()`.
- A closed M5 bar is written at most once per broker server, account login and symbol. The last successful bar time is persisted in an MT5 terminal global variable.
- The logger reads M5/H1 OHLC and indicators, the current Bid/Ask snapshot, spread, quote age, market-safety state and symbol tick-value metadata.
- The CSV is appended and flushed after each row.

## File location

`<MT5 data folder>/MQL5/Files/GoldAITraderV19_M5_Forward.csv`

Open MT5 using **File > Open Data Folder**, then open `MQL5/Files`.

The file is stored in the current terminal's private Files directory; it is not written to `FILE_COMMON`. The CSV includes the broker server, symbol and account currency, but does not write the account login.

## Safety boundary

- The logger uses local terminal history and `FileOpen/FileWrite/FileFlush` only.
- The logger does not call `WebRequest`, does not build or send API requests, and does not use any order or position execution API.
- Existing `EnableSignalRequests=false` and `EnableSafetyHeartbeat=false` defaults remain unchanged.
- This feature does not change strategy rules, risk limits, order gates, or backend settings.

## Operational verification

1. Compile `mt5/GoldAITraderV19_MT5_Research.mq5` in MetaEditor 5 with F7.
2. Confirm **0 errors** before attaching it to the chart.
3. Keep the existing network switches OFF.
4. After a completed M5 bar, look in the MT5 **Experts** tab for `[V19 FORWARD LOG] M5_BAR saved`.
5. Check that the CSV header appears once and new M5 rows are appended.

A successful GitHub static test is not a substitute for compiling the EA in MetaEditor.
