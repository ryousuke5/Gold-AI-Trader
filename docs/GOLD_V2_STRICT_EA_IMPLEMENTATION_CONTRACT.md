# GOLD V2 Strict EA Implementation Contract (Research / Demo First)

**Status:** specification baseline; not an authorization for live orders.  
**Strategy baseline:** GOLD V2 Strict. This contract does not promote Pullback or Halfback.

## 1. Delivery stages

1. **Price and signal parity (current):** pure execution-price helpers and tests; all strategy levels are BID-chart levels. Backtest outputs record the price basis.
2. **MT4 signal / telemetry layer:** reuse the existing `mt4/GoldAITraderV19.mq4` as the market-safety heartbeat and completed-bar feature bridge. V19 already sends completed M5/H1 candles and Bid/Ask quote context to `/api/gold/signal`; it has no order-sending path, and `AllowAutoOrders` is intentionally ignored. Do not modify or redeploy the production V19 copy during research. Capture its feature payload and the server's returned candidate/decision/entry/SL/TP/risk/`order_allowed` fields in a separate research ledger.
3. **Parity replay:** replay identical M5/H1 bars through the JavaScript strategy and the MT4-to-API feature bridge. Require agreement for feature values, candidate, reason, stop, target, and bar-time within broker tick size. Compare indicator warm-up, H1 bar boundaries, broker timezone, DST, and missing bars. If a fully local MQL4 strategy copy is later added, test it against the same fixtures before using it.
4. **Demo shadow:** continue V19 signal-only operation; observe live Bid/Ask, spread, quote age, rejected/late/duplicate bars and market-safety gates without opening orders. Collect a frozen prospective sample.
5. **Demo order execution:** only after research and parity gates pass, build a separate versioned demo executor. It may use the API response only when the server reports `order_allowed=true` and risk approved, and it must independently check a fresh quote, local safety, demo account, symbol contract, risk sizing and idempotency. Default demo execution remains OFF until explicitly approved. No real-money orders.
6. **Live readiness review:** separate written approval after sufficient forward demo evidence. The real-order gate remains OFF.

## 2. Frozen GOLD V2 Strict signal contract

All logic uses closed candles only. A signal is evaluated once after a new M5 bar starts, using M5 shift 1 as the latest completed candle. H1 inputs must come from the latest fully completed H1 candle at or before the M5 signal close. Never read shift 0 for signal decisions.

- Instrument: broker's XAUUSD symbol (suffix resolved explicitly; never assume `GOLD` and `XAUUSD` are interchangeable).
- Timeframe: signal M5; trend H1.
- H1 BUY: close > EMA20 > EMA50 > EMA200; RSI14 50–72 inclusive.
- H1 SELL: close < EMA20 < EMA50 < EMA200; RSI14 28–50 inclusive.
- UTC session: 07:00–20:00 (inclusive hour semantics must be unit-tested).
- M5 range: high/low of the 12 completed candles immediately before the signal candle; range width / ATR14 must be 0.80–2.80 inclusive.
- Signal candle: absolute body / ATR14 >= 0.40.
- Volume: signal tick volume / mean volume of the preceding 12 candles >= 1.10 when source volumes are valid; zero/invalid volume must fail closed, not silently pass.
- BUY breakout: signal close >= prior range high + 0.10 ATR; close location >= 0.65; M5 RSI14 52–75; close >= EMA20; extension from EMA20 <= 1.50 ATR.
- SELL breakout: signal close <= prior range low - 0.10 ATR; close location <= 0.35; M5 RSI14 25–48; close <= EMA20; extension from EMA20 <= 1.50 ATR.
- BUY stop: min(prior range low - 0.15 ATR, signal low - 0.05 ATR).
- SELL stop: max(prior range high + 0.15 ATR, signal high + 0.05 ATR).
- Stop distance: 0.80–2.00 ATR; target: 2.00R from signal close. These are technical BID-chart levels; execution-cost-aware entry risk must be calculated separately.

## 3. Price-side and execution contract

The prepared historical bars and the strategy's OHLC-derived levels are BID-based. Keep these domains separate:

| Operation | BUY | SELL |
|---|---|---|
| Market entry fill | Ask + adverse slippage | Bid - adverse slippage |
| Stop trigger on BID bars | Bid low <= BID stop | Bid high >= BID stop |
| Target trigger on BID bars | Bid high >= BID target | Bid low <= BID target |
| Stop exit fill | BID stop - slippage | BID stop + spread + slippage |
| Target exit fill | BID target - slippage | BID target + spread + slippage |
| Time / data-gap exit | BID close - slippage | BID close + spread + slippage |

For open-through gaps, stop fills are adverse at the bar open plus the applicable side/cost; target fills may receive favorable open-price improvement before the configured adverse slippage. Same-bar stop/target conflict remains STOP-first until tick-level replay can resolve sequence.

**MT4 implementation warning:** the API's strategy SL/TP are BID-chart levels. Do not submit the SELL levels unchanged as broker-hosted MT4 SL/TP: SELL positions close on ASK, so the broker's stop trigger is on the other quote side. A spread-offset server-side order is only an approximation when spread changes. To match the research trigger exactly, the EA must monitor the BID logical level and close the SELL at the current ASK, while separately considering a broker-side disaster-protection stop. This behavior must be tested against XM demo ticks before any order code is enabled.

Effective planned risk distance is entry fill to expected stop fill:
- BUY: entry Ask fill minus (BID stop minus exit slippage).
- SELL: (BID stop plus spread plus exit slippage) minus entry Bid fill.

The backtest must express realised P/L in R using this effective distance. Strategy geometry such as stop ATR remains based on the raw BID signal close-to-stop distance and must be reported separately.

A constant-spread M5 approximation is not equivalent to historical Ask OHLC. Before any execution promotion, run a second study using time-varying spread and, if available, broker Ask ticks. The MT4 implementation must use the live Bid/Ask from `MarketInfo(Symbol(), MODE_BID/MODE_ASK)`; never infer the live Ask from a stale signal snapshot.

## 4. Risk and market safety

- Risk target: 0.25% of current equity per trade, computed from effective quote-side stop distance and broker tick value/tick size, then rounded down to lot step.
- Include commission estimate and a configurable slippage reserve; reject if the minimum lot would exceed the risk cap.
- Max daily loss: 2%; max equity drawdown lock: 5%. Fail closed if equity/peak/day-start state is unavailable.
- Spread cap: 0.50 XAUUSD price units; use actual current Ask-Bid. Reject missing, non-finite, negative, or stale prices.
- Quote freshness and tick-anomaly protections must be checked again immediately before any demo order submission.
- Session and weekend/reopen locks must use UTC and explicit server-time conversion. Block ambiguous DST or stale clock inputs.
- One position per symbol/magic number initially; no averaging down, grid, martingale, or automatic recovery.
- A rejected, stale, duplicate, late, or invalid signal must never be retried as a fresh order without a new completed M5 bar.

## 5. MT4 / MQL4 parity checklist

- Confirm symbol digits, point, tick size, tick value, contract size, minimum lot, maximum lot, lot step, stop level, freeze level, and account-currency conversion on the target broker.
- Match EMA/RSI/ATR implementation and warm-up to the JS reference; MT4 indicator values can differ by initialization and price-applied settings.
- Match H1 aggregation/session timezone and DST; record both broker time and UTC in every diagnostic record.
- Enforce once-per-M5-bar idempotency with signal bar open time + strategy version + symbol as the key.
- Record signal inputs, candidate/reason, entry quote, spread, effective risk distance, stop/target, order result, exit result, slippage, commission and safety-gate reason.
- Store telemetry locally first; network reporting failure must not change the signal or cause an order retry.
- Compile with the target MT4 build and run strategy unit/replay tests before demo installation.

## 6. Explicit non-goals

- No change to production V2 Strict parameters.
- No use of OOS data for further parameter fitting.
- No live order path in the initial signal-only EA.
- No automatic promotion from backtest metrics.
- No Render, Supabase, V19 or production environment mutation from this research branch.
