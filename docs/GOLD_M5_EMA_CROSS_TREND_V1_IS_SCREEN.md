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
