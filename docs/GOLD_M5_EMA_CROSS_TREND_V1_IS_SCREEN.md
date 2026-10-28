# GOLD M5 EMA20/EMA50 Fresh Crossover V1 — Fixed IS Research Contract

Status: research-only. No order path is added and the strategy is not approved for demo or live execution.

## Hypothesis

A fresh M5 EMA20/EMA50 crossover in the direction of an already established H1 trend produces continuation with enough follow-through to overcome execution costs. Unlike the previously screened halfback and EMA pullback/reclaim setups, the entry is the **first completed M5 candle on which EMA20 crosses EMA50**; persistent alignment alone is not an entry. It is also not an N-bar breakout or a failed-breakout/liquidity-sweep reversal.

## Frozen entry and risk rules

- Long regime: completed H1 close above EMA50, H1 EMA20 above EMA50, H1 RSI14 at least 52.
- Short regime: completed H1 close below EMA50, H1 EMA20 below EMA50, H1 RSI14 at most 48.
- H1 EMA20–EMA50 separation must be at least 0.15 H1 ATR; H1 close must be within 2.0 H1 ATR of EMA20.
- Entry signal: fresh M5 EMA20/EMA50 cross in the same direction as the H1 regime, bullish candle for BUY or bearish candle for SELL, candle body at least 0.20 M5 ATR, close in the top 40% for BUY or bottom 40% for SELL.
- UTC entry hours: 07:00–20:59 signal-candle hour.
- Stop: beyond the highest/lowest of the last 8 completed M5 candles, with a 0.10 M5 ATR buffer. Accept only stop distance of 0.40–2.00 M5 ATR.
- Target: fixed 1.5R. Entry occurs at the next M5 bar open under the common backtest engine. One position at a time; common daily/max drawdown safeguards remain enabled.
- No parameter grid, no side/year filtering, and no IS retuning.

## Fixed evaluation window and costs

- IS: [2021-10-06T00:00:00Z, 2024-10-05T00:00:00Z) — end exclusive.
- Data: prepared five-year Dukascopy XAUUSD M5 BID artifact trimmed to the fixed IS window; H1 bars are derived from M5.
- Baseline modeled costs: spread price 0.50 and slippage price 0.05.
- Conservative modeled costs: spread price 0.75 and slippage price 0.10.
- Initial equity 100,000; risk 0.25% per trade; max drawdown stop 5%.
- Same-bar stop/target conflict resolves stop-first; historical broker-native XM quotes, actual slippage, financing and commission are not supplied by this dataset.

## Pre-registered screen

Baseline requires at least 30 trades, PF >= 1.15, expectancy >= +0.05R, maximum drawdown <= 5%, and at least two positive calendar years. Conservative costs require at least 20 trades, PF >= 1.00 and positive expectancy. Any failed criterion means REJECT_NO_OOS_NO_IS_TUNING. Only a fully passing IS result can be considered for a separate, single frozen OOS evaluation; this workflow does not run OOS.


## Fixed IS result — 2026-10-28

Workflow: https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/40626837945  
Artifact (report, trade CSVs, decision JSON, and IS manifest): https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/40626837945/artifacts/12789896685

### Baseline modeled costs

- 30 trades; 8 wins / 22 losses; win rate 26.67%.
- PF 0.2698; expectancy -0.6172R per trade; total -18.5153R.
- Net P/L -4,534.59 (-4.5346% from 100,000); max drawdown 5.0224%.
- 20 stop exits and 5 target exits; mean hold 60.8 minutes.
- BUY: 10 trades, 2 wins / 8 losses, -5.5122R. SELL: 20 trades, 6 wins / 14 losses, -13.0031R.
- Only 1 positive calendar year.

### Conservative modeled costs

- 31 trades; 11 wins / 20 losses; win rate 35.48%.
- PF 0.3714; expectancy -0.4960R per trade; total -15.3768R.
- Net P/L -3,784.22 (-3.7842%); max drawdown 4.9693%.
- 17 stop exits and 8 target exits; mean hold 65.3 minutes.
- BUY: 10 trades, 6 wins / 4 losses, +1.1740R. SELL: 21 trades, 5 wins / 16 losses, -16.5508R.

### Gate and decision

Decision: **REJECT_NO_OOS_NO_IS_TUNING**. Failed criteria were baseline PF, baseline expectancy, baseline max drawdown, baseline positive-year count, conservative PF, and conservative expectancy. The minimum trade-count criteria passed; that alone is insufficient.

Data window requested: [2021-10-06T00:00:00Z, 2024-10-05T00:00:00Z), end-exclusive. Last observed bar ended at 2024-10-04T21:00:00Z. The prepared dataset had 213,045 M5 rows, 0 invalid OHLC rows, and 100% positive-volume coverage. There were 776 gaps over 7.5 minutes: 152 weekend gaps and 624 non-weekend gaps.

The conservative-cost report is numerically less negative than baseline despite higher modeled friction. The shared engine's sequential equity and daily/max-drawdown gates alter future trade eligibility and the two scenarios follow different trade paths, so this is not evidence that higher transaction costs help. Both scenarios are clearly negative on expectancy and PF; do not tune on this IS or run OOS.
