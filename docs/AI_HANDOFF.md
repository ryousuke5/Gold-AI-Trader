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


## EURUSD research status — 2026-10-07

### Technical Core V4
Created:
- `src/eurusd_technical_core_v4.js`
- `scripts/backtest-eurusd-technical-core-v4.mjs`
- `scripts/prepare-eurusd-core-v4-data.mjs`
- `.github/workflows/eurusd-technical-core-v4.yml`

The candidate generator deliberately separates broad deterministic technical setup from later environment filtering:
- H1 EMA20/50/200 direction
- M15 impulse → pullback → trigger
- no hard M15 RSI gate
- no volume dependency
- no AI dependency

Run #8: 37622752492, success.
Shared five-year EURUSD M15 data: about 122k bars.

Results:
- 1.30R: 234 trades, PF 0.841, expectancy -0.097R, max DD 25.92R
- 1.50R: 234 trades, PF 0.856, expectancy -0.092R, max DD 27.27R
- 1.80R: 233 trades, PF 0.908, expectancy -0.062R, max DD 25.23R
- stress 1.50R: 149 trades, PF 0.804, expectancy -0.129R, max DD 23.98R

Fixed 3-year IS / 2-year OOS split for 1.80R:
- IS: 135 trades, PF 0.827, expectancy -0.119R
- OOS: 98 trades, PF 1.027, expectancy +0.017R
- OOS max DD: 15.83R

Conclusion: Technical Core V4 is rejected as a standalone trading core. Do not promote it or add AI just to rescue it.

### Legacy EURUSD range-breakout core
Existing `buildEurUsdSetup()` remains a separate candidate because an older run had only 11 trades but PF 3.20.

A reproducible five-year Dukascopy replay was added:
- `scripts/backtest-eurusd-legacy-core.mjs`
- `.github/workflows/eurusd-legacy-core-research.yml`

Five-year result (2021-10 through 2026-10):
- current parameters: 14 trades, PF 1.476, expectancy +0.275R, max DD 5.09R
- no-volume: 27 trades, PF 0.985, expectancy -0.010R, max DD 11.18R
- balanced: 37 trades, PF 0.729, expectancy -0.200R, max DD 13.30R
- current recent 365 days: only 1 trade, -1.014R

The older PF 3.20 result was from a different period/data slice (2017-03 to 2022-03) with only 11 trades, so it is not sufficient evidence of stable profitability.

A 10-year validation workflow is currently queued/running:
- Run #2: 37625030497
- Target window: about 2016-10 to 2026-10
- Uses one shared dataset and three configurations

### EURUSD session-range candidate
Created:
- `src/eurusd_session_range_core_v1.js`
- `tests/eurusd_session_range_core_v1.test.js`
- `scripts/backtest-eurusd-session-range-core-v1.mjs`
- `.github/workflows/eurusd-session-range-core-v1.yml`

Architecture:
- UTC 00:00–07:00 range
- breakout window default 07:00–15:00 UTC
- H1 EMA trend filter
- breakout bar → prior retest touch → current confirmation bar
- next-bar execution
- stop based only on actual retest touch extremes
- no RSI/volume hard gate

The implementation received causal-timestamp and retest-definition fixes before research.

An independent local prototype on the same five-year data found one exploratory configuration (07:00–15:00, retest within 4 bars, 1.5R) with:
- 45 trades over five years
- overall PF 0.810, expectancy -0.124R
- last two years: 11 trades, PF 2.566, expectancy +0.577R

This is not production evidence. It suggests regime sensitivity and justifies checking the formal CI result before deciding whether an environment filter is worth testing.

Current formal CI:
- Session Core Run #2: 37624889957, in progress
- Legacy Core Run #2: 37625030497, in progress

### AI/fundamental policy
Do not call live web search inside historical replay.
AI/fundamental evaluation must use point-in-time replayable inputs.
Existing replay infrastructure:
- `src/gold_ai_replay.js`
- `scripts/run-gold-v2-ai-replay.mjs`
- `scripts/report-gold-v2-ai-replay.mjs`
- `scripts/build-gold-v2-ai-replay-dataset.mjs`

Do not add the AI layer until a deterministic candidate core has an adequate sample and credible OOS behavior.
