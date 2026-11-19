# GOLD V19 MT5 Portability Audit

Date: 2026-11-20  
Scope: read-only audit of the repository's current `main` baseline. This document does not authorize live trading or a production deployment.

## 1. Baseline and freshness warning

Audited file:

- `mt4/GoldAITraderV19.mq4`
- MQL4 source, version property `1.9`, 1,071 lines
- Git blob SHA: `5461cb91ff339acc99af54caa63764aca835aa7f`
- The latest commit touching this file on `main` is `ee43a468b294a3121ab7e933d213905b1d16bbca` (2026-11-03).

The repository's `main` branch has newer commits than the V19 source file, but the V19 file itself has not changed since 2026-11-03. Conversation evidence contains V19 runtime logs from 2026-11-18. Therefore, this repository copy must **not** be assumed to be byte-for-byte identical to the latest local MetaEditor source. Before changing EA code, import/push the latest local `.mq4` and compare it with this baseline.

## 2. What V19 actually does

V19 is currently an **analysis / telemetry bridge**, not an order-execution EA.

- `OnTimer()` updates the local quote-safety state, sends a safety heartbeat, and posts one completed M5 bar to the Render API.
- `BuildSignalPayload()` collects M5/H1 indicator values, completed-bar history, account/risk metadata and UTC timestamps.
- `UpdateMarketSafety()` enforces quote validity/freshness, spread, weekly-reopen lock, abnormal-tick detection and recovery sampling.
- `PostJson()` is the HTTP boundary.
- `AllowAutoOrders` defaults to false. The source contains no `OrderSend()`; enabling the input does not create order execution.

Do not introduce a trade executor as part of this portability refactor. Order execution is a separate future scope and must remain disabled.

## 3. The strategy is already outside the EA

The backend already owns platform-independent GOLD V2 logic:

- `src/gold_strategy_v2.js` implements candidate generation from normalized M5/H1 features and recent bars.
- `src/gold_market_safety.js` independently validates the safety snapshot at the API boundary.

The MT4/MT5 programs should therefore be thin terminal adapters. They should collect equivalent market/account data, preserve the existing API contract, and report safety state. Do not duplicate the V2 strategy in MQL5 or change its thresholds during this refactor.

## 4. Target architecture

Keep the two terminal integrations separate while preserving one backend contract:

```text
MT4 adapter (MQL4)                 MT5 adapter (MQL5)
  symbol / quote access              symbol / quote access
  M5/H1 rates & indicators           M5/H1 rates & indicator handles
  account / position snapshot        account / position / deal snapshot
  local market-safety state          local market-safety state
  JSON payload + HTTP                JSON payload + HTTP
             \\                         //
              \\                       //
               Existing Render API contract
                         |
              Node.js GOLD V2 strategy
              API-side market-safety gate
                         |
                    Supabase
```

Recommended MT4 file boundaries, after the newest local source is synchronized:

- `mt4/GoldAITraderV19.mq4`: inputs, global state, and event lifecycle only.
- `mt4/include/GoldV19_Common.mqh`: string/JSON helpers and small platform-neutral scalar helpers.
- `mt4/include/GoldV19_Time.mqh`: server-to-UTC conversion and bar-close timestamp rules.
- `mt4/include/GoldV19_MarketData.mqh`: MT4-specific quotes, rates, indicators and account snapshot.
- `mt4/include/GoldV19_MarketSafety.mqh`: persistent local safety state and gate.
- `mt4/include/GoldV19_Payload.mqh`: API request payload construction.
- `mt4/include/GoldV19_Http.mqh`: authenticated HTTP transport.
- `mt4/include/GoldV19_Flow.mqh`: new-bar, retry, heartbeat and request-state flow.

The MT5 adapter should implement equivalent responsibilities under `mt5/`, using MQL5-native APIs. Do not force MT4-specific terminal calls into a shared include file. Share behavior through the API contract and tests, not by pretending MQL4 and MQL5 terminal APIs are interchangeable.

## 5. MT4-to-MT5 portability points

| V19 responsibility | MT4 pattern in the audited source | MT5 implementation direction |
|---|---|---|
| Current bid/ask/time | `MarketInfo(... MODE_*)` | `SymbolInfoTick()` and `SymbolInfoDouble/Integer()` |
| Indicator values | `iMA/iRSI/iATR(..., shift)` return values | Create indicator handles in `OnInit()`; read buffers with `CopyBuffer()`; release handles on deinit |
| Recent OHLCV bars | `iTime/iOpen/iHigh/iLow/iClose/iVolume` loops | `CopyRates()` into `MqlRates[]`, with explicit chronological-order checks |
| Account values | `AccountBalance/AccountEquity` | `AccountInfoDouble()` |
| Open-position count | MT4 order pool + `OrderSelect()` | `PositionsTotal()`, `PositionGetTicket()`, and position properties |
| Daily realized P/L | MT4 order history | `HistorySelect()` and filtered deal history |
| Persistent terminal state | `GlobalVariableCheck/Set` | Keep terminal global variables, but namespace keys by broker/server, account, symbol and EA instance |
| Timer lifecycle | `EventSetTimer/OnTimer` | Keep the timer model; verify the same timing and retry semantics |
| HTTP | `WebRequest()` | Keep a dedicated MQL5 transport adapter and verify request/response parity |

MQL5 indicators return handles; calculated values are retrieved through indicator buffers. This is a substantive porting task, not a function-name substitution. See the official MQL5 references for [indicator handles](https://www.mql5.com/en/docs/indicators), [CopyBuffer](https://www.mql5.com/en/docs/series/copybuffer), [SymbolInfoTick](https://www.mql5.com/en/docs/marketinformation/symbolinfotick), [positions](https://www.mql5.com/en/docs/trading/positiongetticket), and [HistorySelect](https://www.mql5.com/en/docs/trading/historyselect).

## 6. API and behavioral invariants

The MT5 adapter must preserve these semantics unless a separately reviewed API change is made:

1. Submit only fully closed M5/H1 bars; never include the forming bar.
2. Preserve UTC epoch seconds and the current bar-close convention: bar open time + timeframe seconds - broker server UTC offset.
3. Preserve the existing `recent_m5` and `recent_h1` chronological order and contiguous 300/3600-second spacing.
4. Preserve the signal payload fields: `symbol`, `timeframe`, `market_safety`, `features`, `recent_m5`, `recent_h1`, and `account`.
5. Preserve the safety heartbeat fields and the separation between heartbeat reporting and signal submission.
6. Fail closed on missing history, invalid UTC conversion, stale/invalid quotes, excessive spread, reopen lock, or abnormal-tick recovery.
7. Keep `strategy_version=gold-m5-h1-v2` and all production V2 thresholds unchanged during the adapter refactor.
8. Keep automated order execution disabled. No MT4 order functions or MQL5 `CTrade` order calls are to be added in this phase.

## 7. Test plan before accepting the refactor

- Capture a frozen baseline of current V19 request JSON and safety-heartbeat JSON from known fixtures.
- Add contract tests that validate required JSON keys, types, bar timestamps, ordering and missing-data behavior for both terminal adapters.
- Update static tests to inspect the new include files. Existing tests currently read `mt4/GoldAITraderV19.mq4` directly and assume key functions/conditions remain in that one file. In particular, review:
  - `tests/mt4_gold_v19_signal_flow.test.js`
  - `tests/gold_market_safety_static.test.js`
- Keep the current Node.js strategy/safety unit tests unchanged and passing.
- Compile the MT4 adapter with MetaEditor and run its existing demo/forward workflow.
- Compile the MT5 adapter with MetaEditor; then compare MT4 and MT5 payloads from the same historical data fixture before running the FXTF MT5 demo.
- Confirm that restart persistence, weekly reopen lock, tick-anomaly recovery, stale-bar rejection, retry/backoff and API heartbeat behavior match.
- No production Render deployment and no live orders as part of this work.

## 8. Implementation sequence

1. Synchronize and checksum the latest local V19 source; record the exact baseline.
2. Add payload fixtures and tests before moving code.
3. Extract MT4 functions into include modules with no intended behavior change; update static tests in the same commit.
4. Build the MT5 read-only adapter against the exact same payload contract.
5. Compile both platforms and compare payload/telemetry parity.
6. Run MT5 demo forward verification. Only consider a separately scoped execution project after independent IS/OOS and forward evidence.

This branch is a staging area. Do not merge it into `main` or deploy it until source freshness, compiler results, parity tests and demo verification are reviewed.
