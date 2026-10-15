# GOLD XAUUSD Retest V3 — Five-Year Cost Review

**Date:** 2026-10-15  
**Research branch:** `research/xauusd-retest-v3-five-year-cost-review`  
**Workflow:** https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38674016966  
**Period:** 2021-10-06 00:00 UTC to 2026-10-05 00:00 UTC (end exclusive)

## Decision

**Do not adopt this V3 configuration. Keep production execution disabled.** Every cost scenario was materially negative. In the execution-cost-zero counterfactual, the full-period result remained negative and the last-365-day validation period returned −12.20R.

## Results

| Scenario | Execution spread | Assumed slippage per side | Trades | Win rate | Net R | PF | Expectancy R/trade | Recent 365d OOS |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Execution-cost-zero counterfactual | 0.00 | 0.00 | 48 | 20.8% | −20.00 | 0.474 | −0.417 | 15 trades, 1 win, −12.20R |
| Baseline | 0.55 | 0.10 | 51 | 13.7% | −33.46 | 0.270 | −0.656 | 15 trades, 0 wins, −15.30R |
| Spread stress | 0.75 | 0.10 | 51 | 11.8% | −36.70 | 0.215 | −0.720 | 15 trades, 0 wins, −15.29R |
| Higher spread stress | 1.00 | 0.10 | 50 | 12.0% | −35.77 | 0.216 | −0.715 | 15 trades, 0 wins, −15.28R |
| Slippage stress | 0.55 | 0.20 | 51 | 11.8% | −38.12 | 0.214 | −0.747 | 15 trades, 0 wins, −15.59R |

Spread values are GOLD price units, not EURUSD pips. R is risk-normalized performance, not account-currency PnL.

### Counterfactual definition

For the execution-cost-zero scenario, the execution simulator used zero spread and zero slippage, while signal-side spread input remained fixed at 0.55 to preserve the strategy’s signal conditions. This is an execution-cost counterfactual, not a claim that every spread-related calculation was removed. Trade count can vary across scenarios because the backtest revalidates stop distance after next-bar entry.

## Diagnostic observations

- Baseline: 51 trades, 7 wins, 44 losses; 43 stops, 7 targets, 1 conservative same-bar stop/target conflict.
- Across the four non-zero execution-cost scenarios, the recent 365-day OOS period recorded 15 trades and 15 losses in each case.
- The execution-cost-zero OOS period recorded 1 win and 14 losses.
- In OOS, `hold_bars = 0` (stopped during the entry bar) occurred 4 times in the execution-cost-zero scenario and 5–6 times in the other scenarios. Audit the breakout → retest → reclaim → next-bar entry sequence and stop placement before further tuning.
- Trade frequency was only about 0.19–0.20 trades/week over the five-year window. The sample is small, but its observed expectancy is decisively negative for this configuration.

## Data and limitations

- Data source: Dukascopy XAUUSD M1 BID data aggregated to M5.
- 354,305 M5 rows assembled from 131 chunks, covering 2021-10-06 through 2026-10-05 exclusive.
- SHA-256 of decompressed JSON content: `ceeda0ff53f61fd971f38e4e80dbb92092040b2c25012cef42b4ac2367b14b79`.
- The manifest flags 1,290 gaps longer than 15 minutes under its non-weekend heuristic. The available output does not classify every gap; assess any session overlap before relying on this dataset for production decisions.
- These are fixed-cost simulations, not a full historical replay of broker Bid/Ask ticks. Dynamic spreads, measured slippage, commissions and swaps are not fully modeled.

## Next research step

Do not optimize the spread threshold to increase trade count. First audit all OOS trades bar-by-bar, focusing on immediate stops, stop distance, entry gap from confirmation close, and whether the retest/reclaim geometry provides enough follow-through. Keep production branch, Render configuration, and real-order gate unchanged; gate stays OFF.
