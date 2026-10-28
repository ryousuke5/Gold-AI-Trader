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


## IS screen result (completed 2026-10-28)

**Decision: REJECT — no OOS and no parameter tuning on this IS window.**

The workflow completed successfully, including unit/safety tests, syntax checks, the report contract, and artifact upload. The strategy failed all eight pre-registered IS gate checks.

| Metric | Baseline cost | Conservative cost |
|---|---:|---:|
| Trades | 26 | 17 |
| Wins / losses | 6 / 20 | 3 / 14 |
| Win rate | 23.08% | 17.65% |
| Profit factor | 0.224 | 0.136 |
| Expectancy | -0.812R | -1.238R |
| Net P/L on 100,000 starting research equity | -5,154.40 (-5.15%) | -5,139.88 (-5.14%) |
| Maximum drawdown | 5.15% | 5.14% |
| Positive calendar years | 0 | — |

The baseline side breakdown was negative in both directions: BUY had 8 trades, 2 wins, and -4.68R; SELL had 18 trades, 4 wins, and -16.43R. Conservative costs also produced a negative result on the one BUY and 16 SELL trades.

### Data quality and reproducibility

- Requested IS: 2021-10-06T00:00:00Z to 2024-10-05T00:00:00Z (exclusive).
- Source: fixed prepared XAUUSD M5 dataset created by the GOLD V2 Five-Year Research workflow.
- Bars in IS dataset: 213,045; invalid OHLC rows: 0; positive-volume coverage: 100%.
- The data-quality report shows 776 gaps over 7.5 minutes, including 624 non-weekend gaps. The strategy rejects setups whose reference bars are not contiguous, but the gap profile should still be considered when choosing future hypotheses.
- Baseline modeled costs: spread 0.50 and slippage 0.05. Conservative scenario: spread at least 0.75 and slippage at least 0.10.
- Actual last bar in the market data is 2024-10-04T21:00:00Z because the requested end timestamp falls on the weekend market closure.

This is a completed technical-price backtest with simplified costs, not a broker-execution validation. It does not justify live deployment. No OOS was used to select or modify this hypothesis.
