# GOLD V2 candidate-quality diagnostics (research only)

## Purpose

The five-year strict baseline currently emits very few setup candidates. This research-only report records every accepted `BUY` or `SELL` setup before trade admission so we can examine whether candidate rarity or candidate quality is the primary problem. It does not change strategy decisions.

## Outputs

- `gold_v2_candidate_events_baseline.json` and `gold_v2_candidate_events_conservative.json` contain one record per setup candidate for each cost scenario.
- `gold_v2_candidate_quality_diagnostics.json` contains integrity checks, counts by side/hour/year/IS/OOS/recent window, feature summaries, and WAIT-filter distributions.
- `gold_v2_candidate_quality_events.csv` flattens the candidate-level fields for spreadsheet review.
- `gold_v2_candidate_quality_diagnostics.md` is a human-readable summary.

## Captured fields

Each setup candidate records the UTC signal timestamp, side, M5 candle/indicator state, latest completed H1 EMA/RSI state, H1 EMA distance measures normalized by ATR, setup geometry, setup feature diagnostics (range/breakout/body ATR, volume ratio, close location, extension and stop distance), entry gap, effective RR, floor margin, risk gate, admission decision, and actual result if accepted.

## RR-only counterfactuals

When a setup is rejected specifically by the effective-RR floor, a separate shadow simulation bypasses only that floor while preserving entry-gap and geometry validation, the same spread/slippage, the same stop/target, and the same OHLC exit model. The hypothetical result is stored under `counterfactual_rr_only_outcome`.

That shadow trade is **not** a real accepted trade, does not update equity, does not block later candidates, and is not included in PF, expectancy, return, or drawdown. Hypothetical opportunities may overlap. These outcomes are useful for inspecting individual rejected candidates, not for claiming portfolio profitability.

## Integrity contract

The analyzer fails CI if:
- candidate-event count does not match the backtest candidate counter;
- accepted candidate keys do not match the actual trade list;
- accepted / RR-rejected / entry-gap-rejected / geometry-rejected / risk-blocked / data-gap counts do not reconcile.

## Interpretation guardrails

- WAIT-reason percentages refer to evaluated setup bars, not to independent market opportunities.
- Candidate features and actual outcomes are descriptive only; sample sizes may be very small.
- UTC hour is the signal bar's UTC hour. Strategy H1 aggregation remains set by the configured server timezone.
- M5 OHLC cannot reveal exact intrabar event ordering.
- This diagnostic does not select a new threshold and is not authorization to deploy or enable live orders.
