# GOLD H1 M5 Halfback V2 — IS Screen

**Decision: REJECTED at the IS screen. Do not deploy or enable orders.**

## Hypothesis

V2 keeps V1's H1 EMA20/50/200 aligned trend, confirmed M5 impulse, 45–55% retracement zone, confirmation candle, stop geometry, 2R target, and UTC session. It adds one pre-defined condition: the confirming M5 candle must cross back through M5 EMA20 in the H1 trend direction, and M5 EMA20 must slope in that direction versus three bars earlier.

This is a single-factor hypothesis test, not a parameter sweep. No OOS test is authorized unless the fixed IS screen passes.

## Fixed window and execution assumptions

- IS requested window: 2021-10-06 00:00 UTC through 2024-10-05 00:00 UTC (exclusive).
- Data source: prepared five-year XAUUSD M5 dataset from the successful GOLD V2 Five-Year Research run; the IS dataset is cut to this fixed window.
- Initial equity: 100,000 research units; risk per trade: 0.25%.
- Baseline modeled costs: spread price 0.50 and slippage price 0.05.
- Conservative modeled costs: spread price at least 0.75 and slippage at least 0.10.
- Entry: next M5 bar open; same-bar stop/target conflict resolves stop first.
- The existing 5% drawdown guard remains active in the primary ledger. An isolated post-lock shadow ledger continues trades for diagnostic purposes; it is not the live-equity result.

## Primary ledger results

| Metric | Baseline costs | Conservative costs |
|---|---:|---:|
| Trades | 38 | 35 |
| Win rate | 21.05% | 22.86% |
| Profit factor | 0.319 | 0.308 |
| Expectancy | -0.560 R | -0.624 R |
| Net return | -5.20% | -5.33% |
| Maximum drawdown | 5.23% | 5.33% |

Both cost conditions are clearly negative. The extra EMA20 cross-and-slope condition did not improve the observed IS result sufficiently to justify OOS testing.

## Post-drawdown shadow diagnostics

This ledger is explicitly separate from the primary equity/risk gate. It is useful to see whether candidate trades after the first drawdown lock appear promising, but is not a replacement for the primary result.

| Metric | Baseline costs | Conservative costs |
|---|---:|---:|
| Post-lock diagnostic trades | 38 | 23 |
| Profit factor | 0.721 | 0.466 |
| Expectancy | -0.179 R | -0.432 R |
| Return on shadow ledger | -1.70% | -2.48% |

The shadow diagnostic is also negative under both costs.

## Conclusion and next step

Reject Halfback V2. Do not adjust multiple thresholds to force a pass, and do not run OOS for this candidate. Keep the branch as a research record only. A subsequent strategy should start from a materially different, pre-defined entry hypothesis and use a new fixed IS selection window before any candidate is frozen for OOS.
