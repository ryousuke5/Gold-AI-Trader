# GOLD Trend Momentum Pullback V1 — Research Specification

**Intent from strategy owner:** small losses, disciplined stop-losses, trade with trend momentum, buy pullbacks and sell rallies.  
**Status:** fixed research hypothesis only. Not production, not a validated profitable strategy, and not permission to place orders.

## Why this is a separate hypothesis

The earlier Pullback Retest candidate mainly tested an EMA20 touch and a candle reconfirmation. Halfback V1 measured a fixed 45–55% impulse retracement. Neither explicitly required measurable H1 directional momentum. Momentum Pullback V1 adds a pre-registered H1 momentum gate before looking for an M5 retracement.

No threshold in this specification may be tuned on the already-consulted OOS data.

## Entry decision

Use closed bars only. Evaluate each completed M5 candle once. H1 input is the latest fully completed H1 candle available at the M5 signal close. The three preceding H1 intervals used for momentum must be contiguous; incomplete or stale candles fail closed.

### 1. H1 trend and momentum gate

BUY only when all are true:
- H1 close > EMA20 > EMA50 > EMA200.
- H1 RSI14 is 52–70 inclusive.
- H1 close has advanced by at least 0.35 H1 ATR over the most recent three H1 intervals.
- EMA20 - EMA50 is at least 0.15 H1 ATR.

SELL only when all are true, mirrored:
- H1 close < EMA20 < EMA50 < EMA200.
- H1 RSI14 is 30–48 inclusive.
- H1 close has declined by at least 0.35 H1 ATR over the most recent three H1 intervals.
- EMA50 - EMA20 is at least 0.15 H1 ATR.

### 2. M5 pullback

- Previous completed M5 candle must touch the M5 EMA20 band within 0.20 M5 ATR.
- Pullback may penetrate EMA50 by no more than 0.15 M5 ATR. A deeper break means the setup is rejected; do not average down into it.
- The current signal candle must be contiguous with the pullback candle.

### 3. M5 re-acceleration confirmation

BUY:
- M5 EMA20 > EMA50.
- Signal candle closes bullish and at least 0.05 ATR above the pullback candle high.
- M5 RSI14 is 52–70 inclusive.
- Signal candle body >= 0.30 ATR.
- Close location within the candle >= 0.70.
- Close-to-EMA20 extension <= 1.00 ATR.

SELL mirrors these conditions:
- M5 EMA20 < EMA50.
- Bearish signal close at least 0.05 ATR below the pullback candle low.
- RSI14 30–48, body >= 0.30 ATR, close location <= 0.30 and extension <= 1.00 ATR.

No chase entry after the extension limit is exceeded.

## Stop-loss and profit target

- Initial stop is placed beyond the most extreme high/low of the latest three completed M5 candles, with a 0.10 ATR buffer.
- Reject stop distances below 0.60 ATR or above 1.50 ATR. A too-wide structural stop is a skipped trade, not a reason to reduce the buffer or force an entry.
- Initial take-profit target = 2.50 times the raw structural stop distance from the signal close.
- Backtest P/L and R must use executable-side fills, effective entry-to-stop risk, spread, slippage, and later commission/swap. Report raw structural stop ATR separately from effective money risk.
- Same-bar SL/TP conflict remains stop-first until tick-level data proves the intrabar sequence.
- No break-even move, partial close, trailing stop, or discretionary stop widening in V1. Test those as separate hypotheses later, not simultaneously.

## Risk and operating rules

- Planned risk remains 0.25% of equity or less, computed from executable entry-to-stop fill distance and broker tick value/tick size.
- Round lot size down to broker lot step. Reject if minimum lot exceeds the risk cap.
- Daily loss lock 2%; equity drawdown lock 5%; XAUUSD spread ceiling 0.50 price units; quote age <=30 seconds; reopen/tick anomaly locks enabled.
- One position per symbol/magic number. No grid, martingale, averaging down, or automatic recovery.
- All stale, duplicate, late, malformed or unsafe signals are blocked.

## Fixed initial parameter set (not optimized)

| Parameter | Value |
|---|---:|
| H1 momentum lookback | 3 completed H1 intervals |
| H1 minimum directional move | 0.35 ATR |
| H1 EMA20–EMA50 separation | 0.15 ATR |
| M5 EMA20 pullback touch band | 0.20 ATR |
| M5 allowed EMA50 penetration | 0.15 ATR |
| Confirmation body | 0.30 ATR |
| Confirmation close location | 0.70 BUY / 0.30 SELL |
| Confirmation breakout margin | 0.05 ATR |
| Maximum entry extension | 1.00 ATR |
| Stop buffer | 0.10 ATR |
| Stop range | 0.60–1.50 ATR |
| Initial target | 2.50R |
| Session | 07:00–20:00 UTC |

## Evaluation plan

1. Verify unit tests for bullish, bearish, weak-trend, broken-structure, late-entry, and missing/gapped bar cases.
2. Run fixed historical IS 3Y with baseline and conservative costs. Keep the existing Strict, Pullback Retest and Halfback reference rows.
3. Report trade count, win rate, PF, expectancy R, net expectancy by side, stop/target/time/data-gap exits, maximum drawdown, consecutive losses and year-by-year stability.
4. Treat the previously consulted 2024–2026 OOS only as a repeated robustness reference, never as a fresh blind holdout or a tuning set.
5. Add time-varying spread, commission and swap before calling the backtest broker-realistic.
6. Freeze the best candidate, then collect a new forward signal-only/paper sample. Require at least 100 closed signals and 6 months, extending the period when trade frequency is low.
7. Only after positive forward evidence and MT4/JS parity may a separate demo-only executor be considered. Real-order gate remains OFF.

## Promotion gate

This variant is not selected because it matches the owner's preferred style. It must independently demonstrate after-cost positive expectancy, PF >= 1.20, max DD <=5%, and stable results across the IS subperiods; then repeat the evidence on fresh forward data. If it fails, reject it and preserve the loss evidence.
