# Gold AI Trader — AI Handoff

## Current state

Date: 2026-10-07
Repository: ryousuke5/Gold-AI-Trader
Branch: main
Latest code commit: 68a90acac7f01f4d73d2071ab7828ecc1c4e0574

Real orders remain disabled.

## V4 conclusion

GOLD V4 is rejected for promotion. The strategy was intended as:

H1 trend → M5 rolling range → breakout → retest → confirmation → next-bar entry

Five-year data window:
2021-10-06 through 2026-10-05 exclusive
353,888 M5 bars

Run #20 (37619068638) completed successfully after the market-gap continuity fix.

Baseline conservative result:
- trades: 15
- wins/losses: 2 / 13
- profit factor: 0.1753
- expectancy: -0.9664 R
- total: -14.4958 R
- max drawdown: 4.00%
- annual results were non-positive in every year

Baseline diagnostics:
- breakout_filter: 88,788 waits
- retest_filter: 813
- confirmation_filter: 589
- stop_geometry_filter: 10

The dominant bottleneck is the breakout definition, not data continuity.

Fixed 3-year IS / 2-year OOS walk-forward also rejected every V4 variant:
- no variant passed the IS eligibility thresholds
- selected_variant: null
- OOS was therefore not evaluated

## Important fixes already completed

1. Warmup bug fixed.
2. Runtime sanity guard added so zero signal evaluation fails the job.
3. Setup-stage diagnostics added.
4. Known ~65-minute market/session gaps are accepted as continuity; long gaps remain rejected.
5. Tests for these conditions pass.

Latest relevant commits:
- e7cc65324763e1decc75313063b9b61e0732c3a8
- 149c8e67640b0a9f44c2c607a7c796f5eda7c49c
- 34757299a86c3d9b8b233f99f72ef56c8e0fb311
- 2fbf87b5d62d987054d68b6eb14f6c38213b8de0
- 68a90acac7f01f4d73d2071ab7828ecc1c4e0574

## Research already performed outside the repository

Independent local tests on the same five-year dataset showed:
- allowing the known market gap did not materially improve V4
- relaxing H1 trend, disabling EMA20 confirmation, removing/loosening volume, and changing target R did not produce positive expectancy
- early retest entry improved PF but remained negative
- M15 version of the same basic breakout/retest idea remained negative
- failed-breakout/fade variant was also strongly negative
- simple H1-trend + M5 pullback continuation was strongly negative

These local experiments are research guidance only and are not production code.

## Next engineering direction

Do not keep tuning V4 thresholds.

Next research branch should be a new candidate architecture with strict out-of-sample discipline:

1. Build a broader deterministic candidate generator so the training sample is large enough.
2. Capture point-in-time environment features at candidate time.
3. Label future trade outcome without lookahead.
4. Train an offline environment filter on the IS period only.
5. Freeze the filter and evaluate on the OOS period.
6. Require robustness across normal and conservative costs.
7. Keep real orders disabled until expected value, profit factor, drawdown, trade count, and OOS stability are all acceptable.

The historical technical backtest must not call live OpenAI/news APIs as a substitute for point-in-time data. Any AI/fundamental filter used in historical evaluation needs replayable historical inputs or must be excluded from the historical performance claim.

## Resume rule

On the next session:
- read this file first
- inspect current main
- check the latest GOLD research workflow run
- do not start another full V4 threshold sweep
- continue from the V5 candidate-generator/environment-filter research
