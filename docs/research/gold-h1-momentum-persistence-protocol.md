# GOLD H1 Volatility-Normalized Momentum Persistence — Frozen Research Protocol

**Status:** Research-only; not approved for production or live orders.
**Protocol ID:** GOLD_H1_MOMENTUM_IS_FROZEN_OOS_v1

## Hypothesis

After a completed H1 move of sufficient magnitude relative to recent H1 volatility, continuation in the direction of that move may persist for a limited horizon. This differs from range-breakout, EMA pullback/reclaim, Bollinger re-entry, and countertrend liquidity-sweep strategies: the signal is the normalized multi-hour return itself, not a range edge, moving-average interaction, or reversal candle.

## Pre-registered signal

M = (Close[t] - Close[t-N]) / (ATR14_H1[t] * sqrt(N))

- N: 4, 8, or 12 completed H1 bars.
- Threshold: 0.75, 1.00, or 1.25; nine candidates total.
- BUY when M >= threshold; SELL when M <= -threshold; otherwise no signal.
- Reject if any bars between t-N and t are not consecutive UTC hours; this prevents a weekend/market-data gap from being treated as an N-hour move.
- Signal is known only after the H1 bar is complete. Entry is the next consecutive complete H1 open.
- Fixed session: signal bars closing during UTC hours 07–20 inclusive, chosen to exclude the observed daily rollover widening window. This filter is fixed for all candidates.
- Stop distance: 1.5 × H1 ATR14 at signal close. Target: 2.0R. Maximum holding: eight H1 bars. One position at a time; no overlapping trades.
- Exit simulation uses M5 candles and stop-first when stop and target are both touched in one candle. Gapped-through stops are filled at the next observed open with adverse slippage rather than assumed at the stop price.

## Data and cost model

- Fixed five-year data artifact: Dukascopy XAUUSD M5 BID, nominal window [2021-10-06, 2026-10-05) UTC. It is a proxy feed, not XM GOLD# broker-native bid/ask history.
- H1 bars are constructed in Europe/Nicosia server-hour alignment, requiring all 12 constituent M5 bars. Partial or discontinuous H1 bars are excluded.
- Cost scenarios are price units, not pips: baseline spread 0.30 and slippage 0.05 each side; conservative spread 0.55 and slippage 0.10 each side; stress spread 0.75 and slippage 0.10 each side.
- No guarantee that this model captures spread path, stop slippage, commissions, swaps, financing, or execution latency. These remain blockers for deployment.

## Selection and split

- IS [2021-10-06, 2024-10-06) UTC.
- OOS [2024-10-06, 2026-10-05) UTC.
- First score all nine candidates on IS at baseline and conservative costs only.
- IS eligibility: baseline trades >=100, PF >=1.05, expectancy >=+0.02R/trade, max drawdown <=20R; all three predeclared Oct-to-Oct annual blocks must have >=10 trades and at least two blocks must have positive expectancy. Conservative costs must have >=100 trades, PF >=1.00, expectancy >0 and max drawdown <=20R.
- Among eligible candidates, select highest conservative-cost IS expectancy; deterministic tie-breakers are higher conservative PF, lower conservative max DD, more trades, then candidate ID.
- If no candidate passes IS, do not run OOS; report “no candidate passed”. Do not loosen thresholds based on the result.
- If an IS candidate passes, freeze its parameters and run that single candidate once on OOS at all three predeclared cost scenarios. No OOS tuning or reselection.
- OOS acceptance: baseline trades >=50, PF >=1.10, expectancy >0 and max DD <=20R; conservative PF >=1 and expectancy >0; stress PF >=1, expectancy >0 and max DD <=25R. Any failed gate rejects the version.

## Safety invariants

- Research branch only; no changes to production signal routing, current EA thresholds, Render configuration, Supabase state, or deployment.
- Real trading remains OFF. Passing this research report would still require XM-native historical reconciliation, a longer spread/rollover sample, actual demo execution slippage, and applicable commission/swap analysis before any promotion.
