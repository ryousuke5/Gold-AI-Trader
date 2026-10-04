# EURUSD H1 Trend Pullback v1

## Purpose

A second deterministic EURUSD strategy designed to complement the existing M15 range-breakout engine.

- Strategy A: M15 range breakout.
- Strategy B: H1 trend + M15 pullback continuation.
- AI: macro/news environment veto only. AI does not create entry, SL, TP, or position size.

## Signal flow

1. H1 trend must be clear:
   - BUY: close > EMA50, EMA20 > EMA50 > EMA200.
   - SELL: close < EMA50, EMA20 < EMA50 < EMA200.
   - Recent H1 closes must agree with the trend at least 60%.
2. H1 is rejected when price is excessively extended from EMA50 relative to H1 ATR.
3. M15 must remain structurally aligned with H1.
4. The preceding M15 sequence must show a controlled pullback:
   - touch/approach to EMA20,
   - structure remains above EMA50 for BUY or below EMA50 for SELL,
   - retracement between 0.20 ATR and 1.20 ATR.
5. The latest completed M15 candle must be the trigger:
   - close above the pullback high for BUY, or below the pullback low for SELL,
   - body 0.30–1.50 ATR,
   - strong close location,
   - continuation-zone RSI,
   - acceptable spread.
6. SL is placed beyond the pullback structure with an ATR sanity band.
7. TP is 2.0R by default.
8. Existing EURUSD risk engine applies daily loss, drawdown, open-position, spread, broker constraints and lot sizing.
9. AI must return a favorable current environment with verified sources. Unknown/stale/high-impact-event conditions fail closed.

## Deliberate exclusions

No Bollinger-band exit, no fixed 15-pip stop, no current-bar/unfinished-bar signal, no AI-generated entry price, and no direct order execution in the monitor EA.

## Default parameters

| Parameter | Default |
| --- | ---: |
| Pullback lookback | 6 M15 bars |
| Retracement | 0.20–1.20 ATR |
| EMA touch buffer | 0.15 ATR |
| Structure buffer | 0.20 ATR |
| Trigger body | 0.30–1.50 ATR |
| Trigger close location | 0.65 |
| BUY RSI | 50–70 |
| SELL RSI | 30–50 |
| H1 max extension | 2.50 ATR |
| Take profit | 2.0R |

## Production policy

The new monitor is separate from the existing EURUSDAIMonitor. Both can coexist because the strategy version and API path are separate. Order execution remains disabled until a dedicated forward/paper validation gate is passed.

## Validation gate

Before live execution, compare Strategy A and Strategy B separately and together.

Minimum checks:
- net expectancy after spread and slippage assumptions,
- profit factor,
- maximum drawdown,
- trade count per week,
- consecutive losses,
- performance by session,
- performance around high-impact events,
- parameter sensitivity,
- out-of-sample stability.

Do not optimize parameters on the same period used to judge final performance.
