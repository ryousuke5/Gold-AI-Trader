# GOLD V19 MT5 Read-Only Adapter — Initial Port

Date: 2026-11-20  
Branch: \`refactor/v19-mt5-portability-foundation\`

## Source-of-truth confirmation

The user compared the active XM Experts-folder \`GoldAITraderV19.mq4\` with the preserved safe source baseline after decoding UTF-16 LE and normalizing line endings. The source text matched except for:

- The active terminal's \`ApiKey\` input value (credential; never store it in Git).
- A final newline difference.

The checked-in baseline remains credential-free with \`ApiKey = "CHANGE_ME"\`. The XM-installed source was copied locally to \`mt4/source-baselines/GoldAITraderV19_XM_Installed_2026-11-20.mq4\` for comparison only. That local snapshot contains the formerly configured production key and must not be committed or uploaded. Add it to the local \`.git/info/exclude\` file or remove the snapshot once local comparison is complete.

The repository's Render Blueprint declares \`GOLD_API_KEY\`, and \`server.js\` uses that same variable in the shared \`auth\` middleware for the Gold API routes, including \`/api/gold/market-safety\` and \`/api/gold/signal\`. There is no separate research-key auth path in this service. The user reports that the production key was rotated after it was exposed in the local diff output. Never put the replacement key in source control or chat.

## Retrieved MT4 behavior used as the porting reference

- \`GoldV19_Payload.mqh\`: signal payload and market-safety heartbeat JSON fields.
- \`GoldV19_Http.mqh\`: authenticated HTTP POST using \`X-Gold-API-Key\`, request ID, UTF-8 JSON and duplicate-bar handling.
- \`GoldV19_Flow.mqh\`: timer lifecycle, heartbeat cadence, completed-M5 gating, retry delay, signal submission and stale-bar rejection.
- \`GoldV19_MarketSafety.mqh\`: quote validity/freshness, spread ceiling, weekly-reopen lock, tick-jump detection and stable-tick recovery.

## Initial MT5 implementation

The new \`mt5/\` adapter uses native MQL5 APIs:

- Indicator handles created in initialization; values read using \`CopyBuffer\`.
- Closed M5/H1 bars fetched through \`CopyRates\`.
- Quotes and tick timestamps read through \`SymbolInfoTick\`.
- Account and positions read through MQL5 account/position APIs.
- Realized daily P/L read from selected deal history.
- HTTP requests use MQL5 \`WebRequest\`.

The MQL5 implementation keeps the existing JSON field names and route paths. It is a first-pass port, not yet proven equivalent at runtime. In particular, MT5 hedging/netting position semantics and deal-based realized-P/L aggregation require comparison against the XM MT4 snapshot on the same account/data.

## Safety defaults

- \`EnableSignalRequests=false\`.
- \`EnableSafetyHeartbeat=false\`.
- \`ApiKey="CHANGE_ME"\`.
- No \`CTrade\`, order-send, order-close, position-open or position-close calls.
- Heartbeat always reports \`allow_auto_orders=false\`.
- No Render deployment, no chart attachment, no live-order testing.

## Known MT5 time caveat

MQL5 documents that \`TimeTradeServer()\` is calculated by the terminal, while \`TimeGMT()\` is computed using the PC clock/time-zone settings. In the Strategy Tester, \`TimeGMT()\` is simulated equal to trade-server time. Therefore the server-to-UTC offset path must be validated on a real demo terminal with a synchronized PC clock; a successful Strategy Tester run alone does not prove UTC conversion parity.

MQL5 references:
- [CopyRates](https://www.mql5.com/en/docs/series/copyrates)
- [CopyBuffer](https://www.mql5.com/en/docs/series/copybuffer)
- [SymbolInfoTick](https://www.mql5.com/en/docs/marketinformation/symbolinfotick)
- [WebRequest](https://www.mql5.com/en/docs/network/webrequest)
- [TimeTradeServer](https://www.mql5.com/en/docs/dateandtime/timetradeserver)
- [TimeGMT](https://www.mql5.com/en/docs/dateandtime/timegmt)
- [AccountInfoDouble](https://www.mql5.com/en/docs/account/accountinfodouble)
- [Trade functions / history](https://www.mql5.com/en/docs/trading)

## Required validation before use

1. Compile in MetaEditor 5. Compilation has not yet been performed.
2. Resolve any compiler diagnostics without adding order execution.
3. Run static tests and full Node test suite.
4. Compare captured MT4 and MT5 JSON payloads from the same completed-bar fixture.
5. Confirm M5/H1 bar order, UTC timestamps, volume, account data and safety heartbeat parity.
6. Only after those steps, perform an explicitly enabled demo-only telemetry test.

Do not merge this branch into \`main\` or deploy from this draft.
