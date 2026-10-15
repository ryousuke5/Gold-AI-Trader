# GOLD V3 Alternative Strategy Research Screen — 2026-10-15

**Status: research-only. No strategy has been approved for live trading.**
**Execution controls:** Real orders remain OFF; no Render deployment was made; the PR stays Draft and unmerged.

## Why this screen exists

The strict GOLD V2 candidate engine produced only four trades in the five-year historical run. Before changing V2 thresholds, a few structurally different strategy families were checked. The goal is to reject weak hypotheses, not to search the same dataset for a profitable parameter combination.

Historical price source for the exploratory studies is Dukascopy XAUUSD M5 BID (354,305 bars, 2021-10-06 through 2026-10-04). It is not the user's XM MT4 quote feed. Fixed spread/slippage are model assumptions, not observed XM execution costs.

## Candidate family A — H1 trend pullback / M5 EMA20 reclaim

Frozen development prototype:
- H1 trend requires the full EMA20/50/200 stack and an RSI band.
- M5 triggers on a close back across EMA20 in the trend direction after a retracement.
- Stop is the prior six-M5-bar extreme with a small ATR buffer; target is 1.5R; holding limit is 36 bars.
- No production settings changed.

Overlapping isolated event paths (not portfolio performance):

| Cost model | Closed event paths | Expectancy | PF |
|---|---:|---:|---:|
| Baseline | 7,868 | -0.362R | 0.526 |
| Conservative | 7,862 | -0.526R | 0.392 |

A separate sequential, one-position replay stopped at the first unresolved data gap in the historical provider: 47 completed trades in the baseline scenario and 45 in the conservative scenario before censoring at 2021-11-03 22:00 UTC. Those partial-path summaries are **not** valid five-year portfolio statistics and are not used as a performance claim. This family does not qualify for promotion; do not optimize its thresholds against the same historical window.

## Candidate family B — failed-breakout reversal

Frozen development prototype:
- A close breaks the prior 12-bar range, then a reversal close is required within six bars.
- Target 1.5R, maximum hold 36 M5 bars, and stop-first intrabar tie handling.
- Session filters were not tuned during this screen.

Overlapping isolated paths:

| Cost model | Closed event paths | Expectancy | PF |
|---|---:|---:|---:|
| Baseline | 5,998 | -0.483R | 0.435 |
| Conservative | 5,676 | -0.708R | 0.297 |

The sequential portfolio replay encounters an unverified historical data gap early in the sample (baseline censor at 2022-01-17 23:00 UTC, after 322 closed trades). The preceding segment was already poor (expectancy -0.724R, PF 0.261), but it is not a full-period result. This family does not qualify for promotion.

## Candidate family C — New York opening-range breakout

The rule set was frozen for this research run; no threshold sweep was conducted:
- Use New York local time (America/New_York), so U.S. daylight saving is handled by the timezone database instead of a fixed UTC hour.
- The opening range uses the six M5 candles labelled 09:30–09:55 local time.
- During 10:00–10:55 local time, the first M5 close at least 0.05 ATR beyond the range boundary, with candle direction confirmation, triggers an entry on the next M5 open.
- Stop goes just outside the opposite range edge; target 1.5R; maximum holding period 12 M5 bars; at most one attempt per local trading date.
- Only opening ranges between 0.5 and 2.5 signal-bar ATR are considered.
- Same-bar ambiguity is resolved stop-first. An unverified in-position data gap censors the applicable window instead of fabricating a closing price.

### Sequential portfolio results

| Period | Cost model | Trades | Expectancy | PF | Return on 100,000 start equity | Max drawdown |
|---|---|---:|---:|---:|---:|---:|
| Development (before 2024-10-06 UTC) | Baseline | 265 | -0.133R | 0.619 | -8.45% | 8.89% |
| Holdout segment (from 2024-10-06 UTC) | Baseline | 156 | -0.038R | 0.879 | -1.50% | 3.56% |
| Development (before 2024-10-06 UTC) | Conservative | 265 | -0.184R | 0.512 | -11.49% | 11.88% |
| Holdout segment (from 2024-10-06 UTC) | Conservative | 156 | -0.066R | 0.801 | -2.56% | 3.98% |

No unverified gap censored these ORB windows. The fixed holdout rules reduced the loss relative to development, but expectancy stayed negative and PF remained below 1 even with baseline cost assumptions. The conservative-cost result was worse. Within the holdout segment, 2025 and the available portion of 2026 were both negative; the positive 2024 subsection covers only the final part of that year and does not establish consistency.

**Decision: reject the naive opening-range breakout as a promotion candidate.** Its more frequent signals do not translate into a positive net edge after modeled costs.

Note on research integrity: the holdout results have now been inspected. That date range must not be called an untouched holdout again for tuning variants of this opening-range rule. A future parameter variant needs either new prospective data or a newly reserved, genuinely unseen period.

## Cross-family conclusion

None of the four families currently has demonstrated positive, robust expectancy:
1. V2 strict trend/compression breakout: only four baseline trades in five years; three SELL stop losses; not enough evidence and the existing quality gate fails.
2. H1 trend pullback: negative overlapping-event diagnostics, and the sequential replay is censored very early by a source-data gap.
3. Failed-breakout reversal: negative overlapping-event diagnostics and poor pre-censor portfolio segment.
4. New York opening-range breakout: 156-trade historical holdout segment with negative expectancy and PF below 1.

This is not a basis for raising or lowering thresholds until a positive chart appears. It is evidence that broad technical setup changes on this price source have not yet demonstrated an edge.

## Next step

Move research emphasis from retrospective strategy tweaking to **XM-account data and execution-model validation**:
- capture a broker-native GOLD M5 history export with server-time bar labels, spread/quotes where available, and the account's exact symbol-session schedule;
- reconcile the XM bars to UTC using the historical Europe/Nicosia server-time offset, and audit DST/daylight saving and weekend gaps;
- retain monitor/paper-only state and compare modeled entries/exits against actual XM quotes and spread; include applicable swap/rollover costs before making multi-hour/overnight holds eligible;
- if a new strategy hypothesis is later proposed, register its rules, cost model, and promotion criteria before inspecting the reserved evaluation segment.

The research workflow added in this branch can reproduce the fixed-rule New York opening-range study on the prepared historical dataset. It is a diagnostic workflow only; it does not change app services or create broker orders.

## Reproducibility

- Fixed-rule runner: `research/gold-v3-opening-range-research.py`
- Research workflow: `.github/workflows/gold-v3-opening-range-research.yml`
- Five-year dataset is drawn from the successful `gold-v2-research.yml` workflow artifact.
- This report intentionally records negative results and the reasons not to promote the candidate; no strategy is recommended for production.
