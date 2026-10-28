# GOLD M5 Failed-Breakout Reversal V1 — Research Contract

Status: research-only. This hypothesis is not approved for live trading.

## Entry hypothesis

Fade a failed M5 breakout of the previous 12 completed M5 candles. A signal candle must extend at least 0.10 M5 ATR beyond one side of the prior range, then close back inside that range with a rejection candle:

- Sell: the candle swept the prior range high, closed below that high and above the prior range low, closed bearish, had an upper rejection wick of at least 0.10 ATR, body of at least 0.25 ATR, and closed in the lower 40% of its own range.
- Buy: the candle swept the prior range low, closed above that low and below the prior range high, closed bullish, had a lower rejection wick of at least 0.10 ATR, body of at least 0.25 ATR, and closed in the upper 40% of its own range.
- A candle sweeping both sides is ambiguous and rejected.
- H1 context must be range-like: absolute H1 EMA20–EMA50 distance no greater than 0.60 H1 ATR, and H1 close no farther than 1.25 H1 ATR from EMA20.
- UTC session: 07:00–20:00 inclusive.

The strategy does not use halfback retracement, impulse pivots, H1 directional EMA ordering, EMA20 reclaim, or breakout continuation. This is a distinct failure-of-breakout reversal hypothesis.

## Entry and risk model

- Signal: completed M5 rejection candle.
- Entry simulation: next M5 bar open with the common backtest spread/slippage assumptions.
- Stop: beyond the signal candle's sweep extreme by 0.10 M5 ATR.
- Stop distance: 0.25–2.00 M5 ATR; invalid geometries are rejected.
- Target: 1.50R.
- The existing global daily-loss, drawdown, non-overlap, bar-gap, and entry-gap simulation rules remain in force.
- The setup module returns research signals only; it does not place orders.

## Fixed IS-only gate

The workflow evaluates only 2021-10-06T00:00:00Z through 2024-10-05T00:00:00Z (end exclusive). It must not use the final two-year OOS window for selection.

The candidate passes only if:
- Baseline costs produce at least 30 trades, PF >= 1.15, expectancy >= +0.05R, max drawdown <= 5%, and at least 2 positive calendar years.
- Conservative costs produce at least 20 trades, PF >= 1.00, and expectancy > 0R.

A failed gate is a valid research outcome, not a workflow error. If it fails, reject this hypothesis and do not proceed to OOS or tune parameters on the same IS window.
