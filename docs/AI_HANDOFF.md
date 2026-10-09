# Gold AI Trader — AI Handoff

## Current state

Date: 2026-10-08
Repository: ryousuke5/Gold-AI-Trader
Branch: main
Latest code commit: 73f2521637f753e3dc89c25678abe33031253318

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

Formal Session Core Run #2 (37624889957) completed successfully.

Five-year formal results:
- baseline 1.50R: 51 trades, PF 0.599, expectancy -0.287R, net -14.62R, max DD 20.28R
  - recent 730d: 13 trades, PF 1.677, expectancy +0.317R, net +4.13R
- extended 07:00–17:00: 73 trades, PF 0.705, expectancy -0.200R, net -14.63R, max DD 21.44R
  - recent 730d: 20 trades, PF 1.174, expectancy +0.097R, net +1.94R
- baseline 1.80R: 52 trades, PF 0.627, expectancy -0.276R, net -14.36R, max DD 20.41R
  - recent 730d: 14 trades, PF 1.676, expectancy +0.344R, net +4.81R
- baseline retest6: 62 trades, PF 0.745, expectancy -0.169R, net -10.49R, max DD 16.92R
  - recent 730d: 17 trades, PF 1.699, expectancy +0.318R, net +5.40R

Annual behavior is strongly regime-dependent:
- 2021–2023 were materially negative across variants
- 2024–2026 improved, with 2026 strongly positive
- this pattern is not enough to claim stable profitability

Conclusion: Session Core V1 is NOT a standalone validated strategy. It is only a candidate generator for environment-filter research.

Current validation status — 2026-10-08:
- Previous policy-proxy replay attempt 37625758272 was invalid for judging the filter because it executed an older commit and did not load the policy mask.
- The subsequent runs on commit efc0552... were cancelled when the session retest-bound fix was committed.
- New validation is running on commit 9d68d58...; unit tests have already passed.
- The current policy replay preparation job is 113018047220 (run 37687223366).
- Real orders remain disabled until the corrected replay is fully analyzed.

### AI/fundamental policy
Do not call live web search inside historical replay.
AI/fundamental evaluation must use point-in-time replayable inputs.
Existing replay infrastructure:
- `src/gold_ai_replay.js`
- `scripts/run-gold-v2-ai-replay.mjs`
- `scripts/report-gold-v2-ai-replay.mjs`
- `scripts/build-gold-v2-ai-replay-dataset.mjs`

Do not add the AI layer until a deterministic candidate core has an adequate sample and credible OOS behavior.


## 2026-10-08 engineering correction

A defensive causal constraint was added to src/eurusd_session_range_core_v1.js:
- retest-touch scanning is explicitly bounded to maxRetestBars
- retest touches must occur before the current confirmation bar

A regression test was added in tests/eurusd_session_range_core_v1.test.js, and the repository test job passed.

Corrected Session Core replay after this change:
- baseline 1.50R: 51 trades, PF 0.544, expectancy -0.336R, net -17.12R, max DD 22.78R
- recent 730d: 13 trades, PF 1.677, expectancy +0.317R, net +4.13R
- baseline 1.80R and other variants also completed successfully on the corrected code

This confirms the session core remains regime-dependent and is not promotion-ready.

Policy replay integrity hardening:
- the replay now checks that a configured policy-mask file exists and contains valid rows
- CI explicitly requires the policy mask
- runtime diagnostics report the configured path and loaded row count
- a configured policy replay with zero evaluated policy candidates now fails instead of producing a false successful result

Do not rely on any policy-filter performance result generated before these integrity checks.


## Safety / Live execution status — 2026-10-08

The EURUSD implementation now has a safety-first live architecture with AI optional.

### AI is optional
- Render sets EURUSD_AI_ENABLED=false.
- With AI disabled, /api/eurusd/signal does not call OpenAI and uses the deterministic technical candidate directly.
- AI remains available only for explicit research/test endpoints.
- Real orders remain disabled until strategy validation is complete.

### Deterministic safety layer
Implemented in:
- src/eurusd_safety_gate.js
- src/eurusd_news_feed.js
- src/eurusd_risk.js

Current production settings:
- max hold: 3600 seconds
- Friday new-order block: 20:00 UTC
- Friday force-close window: 20:30 UTC onward
- Sunday reopen lock: 21:00 UTC for 90 minutes
- rollover lock: 21:55–22:15 UTC
- weekend gap block: >0.50 ATR
- missing Monday gap data fails closed for the first 12 hours
- high-impact USD/EUR news: block new orders 60 minutes before through 60 minutes after
- high-impact news force-close window: 15 minutes before through 15 minutes after
- stale/missing news feed blocks new orders in production

The economic-calendar feed uses the free Finance Calendar JSON endpoint and refreshes every 10 minutes. A valid empty high-impact event list is now accepted as a healthy feed state; malformed payloads fail closed.

### Continuous server safety check
Added:
- POST /api/eurusd/safety-check
- GET /api/eurusd/safety-status

The MT4 executor can poll the safety endpoint continuously, so an important event occurring in the middle of an M15 bar does not have to wait for the next signal bar.

### MT4 live executor
Added:
- mt4/EURUSDLiveTrader.mq4
- scripts/validate-eurusd-live-trader.mjs

Executor characteristics:
- AllowAutoOrders=false by default
- requires server order_allowed=true
- requires local safety gate
- checks execution-price deviation before OrderSend
- checks free margin and broker symbol specifications
- limits managed positions to the strategy's single-position model
- closes managed positions when max hold is exceeded
- can respond to server safety force-close decisions
- reports FILLED/REJECTED results to /api/eurusd/execution-result with idempotency_key
- no live trading is enabled by the repository/Render configuration

### Validation
Latest test workflow succeeded:
- npm test: success
- live executor static validator: success
- existing Gold V4 smoke tests: success
- Python self-tests/compile: success

Latest EURUSD backtest workflow also succeeded for all matrix variants after the validator correction.

Do not enable AllowAutoOrders or EURUSD_EXECUTION_ENABLED until the EURUSD strategy passes the agreed OOS/forward validation gate.


## 2026-10-08 deterministic forward validation

Forward-validation mode is implemented without real order execution.

Files:
- src/eurusd_forward.js
- tests/eurusd_forward.test.js
- docs/EURUSD_FORWARD_RUNBOOK.md

Behavior:
- AI is disabled for the forward stage.
- /api/eurusd/signal settles any existing forward paper trade using the newest completed M15 bar.
- A new paper trade opens only when deterministic technical setup + risk.approved + safety.newOrdersAllowed all pass.
- At most one forward paper trade is held.
- Same-bar SL/TP ambiguity is resolved conservatively with SL-first.
- Safety force-close and maximum-hold conditions close paper trades at current side-specific market price.
- Forward results are persisted through the existing gold_orders table using FORWARD_* statuses and standardized gold_trade_results records.
- /api/eurusd/forward-status returns PF, expectancy, net R, max DD, win rate, trade count and latest paper trades.
- Forward mode is enabled in render.yaml, but EURUSD_EXECUTION_ENABLED and EURUSD_LIVE_TRADING_APPROVED remain false.

Current Render configuration target:
- EURUSD_AI_ENABLED=false
- EURUSD_AI_ENVIRONMENT_REQUIRED=false
- EURUSD_FORWARD_TEST_ENABLED=true
- EURUSD_FORWARD_MAX_TRADES=1
- EURUSD_EXECUTION_ENABLED=false
- EURUSD_LIVE_TRADING_APPROVED=false
- strategy version: eurusd-m15-h1-deterministic-forward-v1

Validation:
- npm test: success
- npm run test:mt4:live: success
- existing Gold V4 smoke checks: success
- existing Python self-tests/compile: success
- latest EURUSD backtest matrix jobs: success
- latest full CI run: success

Deployment note:
- Code/config is committed to GitHub.
- Render deployment/runtime verification is not yet confirmed because the connected Render MCP session has no selected workspace. Do not claim that the forward test is already running until Render health and the /api/eurusd/forward-status endpoint are checked.


## 2026-10-08 EURUSD AI-free monitor V1

MT4 monitoring implementation:
- `mt4/EURUSDAIMonitorV13.mq4`
- Uses completed M15 bars and H1 context.
- Sends to `/api/eurusd/signal`.
- No `OrderSend/OrderClose/OrderModify` execution code.
- One completed M15 bar is processed once, with bounded retry behavior.
- Includes startup `/health` probe and safety telemetry.
- Static structure/order-execution validation passed after creation.

Runtime architecture:
- `EURUSD_AI_ENABLED=false` means `/api/eurusd/signal` uses `buildTechnicalOnlyDecision()` and does not call OpenAI for normal signal requests.
- `EURUSD_EXECUTION_ENABLED=false` keeps real order execution disabled.

Current user-side setup:
- EURUSD M15 chart with `EURUSDAIMonitorV13`.
- Keep real orders OFF.
- Gold Render observation remains a separate track; do not mix its logs with the EURUSD deterministic validation.

Next step:
1. Confirm the local MT4 `EURUSDAIMonitorV13` matches repository V1.4.
2. Compile with MT4 MetaEditor and attach to EURUSD M15.
3. Confirm startup health + first completed-bar signal logs.
4. Verify Render logs show `/api/eurusd/signal`, `openai.called=false`, and deterministic decision data.
5. Continue deterministic EURUSD performance validation before any AI layer or live execution.


## 2026-10-08 runtime stabilization checkpoint

### Gold V18
- MT4 GoldAITraderV18 was confirmed using the current Render primary URL `https://gold-ai-trader-1.onrender.com` (runtime log: `url_length=37`).
- Previous HTTP 401 authentication failures and subsequent MT4 WebRequest 4060 errors are resolved.
- Successful runtime response confirmed: `ok=true`, `strategy_version=gold-m5-h1-v2`, `candidate=WAIT`, with no order execution.
- GitHub source `mt4/GoldAITraderV18.mq4` was updated to keep `ApiBaseUrl` aligned with the current Render primary URL.
- Do not change the Gold strategy or database configuration based on the resolved auth issue.

### EURUSD V13
- `mt4/EURUSDAIMonitorV13.mq4` had a retry-window log spam bug: expired bars were logged every 5 seconds indefinitely.
- Fixed with `g_retryExpiredBarOpen`, so `retry window expired` is emitted at most once per M15 bar.
- GitHub commit: `109bd24425807612a2b1c904cb466212b786be3d`.
- Real order execution remains absent/disabled.

### Current operating procedure
1. Keep Gold auto-orders OFF and EURUSD execution OFF.
2. Keep EURUSD V13 and Gold V18 running as monitor/forward components only.
3. Collect roughly 3 hours of logs, but do not treat log volume alone as evidence of profitability.
4. For EURUSD, evaluate deterministic candidate frequency, WAIT/BUY/SELL distribution, signal persistence, and forward paper-trade statistics.
5. For Gold, record every successful `/api/gold/signal` response, especially candidate/decision/risk/openai fields when a non-WAIT candidate occurs.
6. Do not promote to live execution without a statistically credible OOS/forward validation result.


## 2026-10-08 Forward Monitor V1

A read-only unified dashboard was added at `/forward-monitor`.

### What it shows
- EURUSD M15 deterministic forward summary: total signals, BUY/SELL/WAIT candidate counts, forward trades, win rate, PF, expectancy, net R, max DD, trades/week.
- Gold M5 V2 runtime summary: total signals, BUY/SELL/WAIT candidate counts, latest signals, recorded trade-result metrics.
- Recent combined EURUSD + Gold signals.
- EURUSD forward trades and Gold trade results.
- DB probe state, EURUSD AI flag, EURUSD execution/live gate, Gold state/auto-trading/live gate.
- EURUSD news-feed safety status.

### Security / operation
- `GET /api/forward-monitor` is protected by the existing `X-Gold-API-Key` authentication.
- The HTML shell is public, but data is not.
- The browser stores the API key only in `sessionStorage` and sends it as a request header.
- No OpenAI key, Supabase secret, or other server secret is returned by the monitor.
- Refresh interval is 30 seconds.
- No order-execution code was added.

### Validation
- Added pure summary tests in `tests/forward_monitor.test.js`.
- Latest CI test run must pass before deployment.
- Render auto-deploy remains OFF; manual deploy is required after validation.

### Resume rule
If interrupted, read this section and continue from:
1. latest `Gold AI Trader Tests` result for the monitor commits
2. trigger a manual Render deploy only after CI passes
3. verify `/health` and `/forward-monitor`
4. enter the existing `GOLD_API_KEY` in the monitor UI and confirm live DB data
5. keep EURUSD execution and Gold auto-orders OFF during forward observation


## 2026-10-09 Gold V2 Range ATR diagnostics
- Gold V2 keeps the current range compression bounds unchanged at 0.8-2.8 ATR.
- Diagnostic values are persisted on new Gold signals via invalid_reasons tokens (`GOLD_V2_DIAG:*` and `GOLD_V2_RANGE_ATR:*`).
- Forward Monitor reads these diagnostics and reports observed min/median/max/mean plus below/in/above-bound counts.
- Historical signals created before diagnostic persistence cannot be backfilled without the original M5/H1 feature snapshot; treat Range ATR observations as post-deployment only.
- Resume rule: collect a meaningful sample before changing compression thresholds; compare candidate variants by PF, expectancy, Max DD, trade frequency and cost stress.


## 2026-10-09 Gold V2 Range ATR research matrix engineering update

The Gold V2 five-year research pipeline was strengthened without changing production strategy parameters.

Changes:
- `scripts/backtest-gold-v2.mjs` now reports a fixed 3-year IS / 2-year OOS split in addition to five-year and recent-365d metrics.
- `.github/workflows/gold-v2-research.yml` already includes the research-only Range ATR variants `4.0 / 4.5 / 5.0 / 5.5`, and now adds an `aggregate-results` job.
- The aggregate job downloads all matrix artifacts and produces:
  - `gold_v2_research_matrix.json`
  - `gold_v2_research_matrix.csv`
  - `gold_v2_research_matrix.md`
- The summary ranks variants by OOS expectancy/PF and keeps baseline vs conservative cost-stress metrics visible in one report.
- Conservative cost scenario remains spread >= 0.75 + slippage >= 0.10.
- Production Gold V2 remains unchanged at range ATR 0.8-2.8 and real execution OFF.

Latest commits:
- `40a25340e78581617b3180aed4c5ba70f8d657b2` — fixed 3y IS / 2y OOS metrics
- `e5bf24c402b980bbf1c25a8c8652958f3efadc97` — consolidated research matrix report

Resume rule:
1. Check the latest `GOLD V2 Five-Year Research` run triggered by the commits above.
2. Wait for all Range ATR matrix variants to finish.
3. Inspect the consolidated `gold-v2-research-matrix-summary` artifact.
4. Compare 5y, 3y IS, 2y OOS and conservative-cost metrics before touching production parameters.
5. Do not enable real orders or change Gold V2 production thresholds from research results alone.


## 2026-10-09 EURUSD V13 retry-window deadline bug

Observed MT4 logs on 2026-10-09 showed repeated:
`send skipped. retry window expired`
with `bar_open=01:30` and `max_retry_until=01:42`, while the log timestamp was around 07:46 JST (broker/server clock offset is visible in the bar timestamps).

Root cause:
- `currentClosedBarOpen` is the OPEN timestamp of the last completed M15 candle.
- The retry deadline had been calculated as `currentClosedBarOpen + MaxRetryMinutes * 60`.
- Since a completed M15 candle is only available 15 minutes after its open, the 12-minute retry window expired before the EA could start sending the completed candle.

Fix committed on main:
- `mt4/EURUSDAIMonitorV13.mq4`: `currentClosedBarOpen + 900 + MaxRetryMinutes * 60`
- Same correction applied to `mt4/EURUSDAIMonitorV12.mq4` and `mt4/EURUSDAIMonitor.mq4`
- `scripts/validate-eurusd-mt4-monitor.mjs` requires the corrected formula to guard against regression.
- Commits:
  - `a4fa20d3cc91d030184989d3534dd639c8899993`
  - `4066e67013c703a352cb16e56e7f2584caa41060`
  - `bb82713b282ea5345923cf9e600e6bf64af911cf`
  - `e73ca1d08068c1e6b05e34d0e1b719da6cd81cf9`

Operational note:
- This is an MT4 EA source change, not a Render server change; Render does not need a redeploy for the EA retry-window correction.
- The locally attached `EURUSDAIMonitorV13` must be replaced with the updated main-branch source, compiled in MetaEditor, and reattached/reinitialized.
- Then check for `EURUSD M15 signal processed` instead of `retry window expired`, and confirm the Forward Monitor's EURUSD diagnostic count increases after a new M15 bar.
- Keep all real execution disabled; V13 remains monitor-only and contains no order execution calls.


## 2026-10-09 EURUSD forward-monitor diagnostic correction

Monitor observation:
- 7 total M15 signals, all WAIT; 0 forward trades.
- Technical diagnostics available for 2/7 signals. Older rows may predate diagnostic-token storage; collect more fresh signals before drawing aggregate conclusions.
- Recent WAIT reasons included unclear H1 trend, M15 EMA/RSI misalignment, spread filter failure, insufficient breakout penetration, weak close location, and missing volume confirmation.
- Observed average spread was 2.10 pips versus the configured 1.20-pip maximum. Do not loosen the spread gate solely to increase frequency; validate broker spread and replay with realistic transaction costs.

Code correction:
- Previously `breakout_distance_atr` used the downside formula whenever H1 trend was not UP, including when trend was RANGE. This could fabricate a negative directional distance during an unclear regime.
- The metric is now null when H1 direction is unavailable or required bars/range are invalid, and null values are excluded from the dashboard average.
- The dashboard also excludes stored breakout-distance values whose diagnostic trend is not UP/DOWN, so legacy RANGE rows from before the fix cannot contaminate the average.
- Entry criteria, trading thresholds, AI settings, and real execution settings are unchanged. Real orders remain OFF.
- Regression tests cover RANGE diagnostics and null-average handling.

Resume from this checkpoint: verify the GitHub test workflow, promote the tested diagnostic-only change to main, deploy the server change manually because Render auto-deploy is disabled, then collect several fresh M15 signals and confirm Breakout ATR is only averaged when H1 has a clear UP/DOWN direction.


## 2026-10-09 EURUSD spread-distribution diagnostics

Purpose:
- Measure whether the 1.20-pip EURUSD spread gate is failing across all observed conditions or primarily during specific UTC hours.
- Do not relax execution filters based on the small current forward sample.

Implementation on branch `diagnostics/eurusd-spread-distribution`:
- New signal diagnostics persist the configured pips and spread/ATR limits plus the separate pass/fail flags.
- Forward Monitor reports spread count, min, P25, median, P75, P90, max, mean, pips-limit exceedance count/rate, ATR gate failures and combined spread-filter failures.
- UTC-hour buckets use signal `created_at` (Render receipt time), not the MT4 bar timestamp, to avoid mislabeling broker server time.
- Each observation uses its persisted spread threshold when available; older rows fall back to the currently configured limit.
- Real execution settings and entry/exit logic are unchanged. EURUSD execution remains OFF; Gold auto-orders remain OFF.

Validation / resume:
1. Run `npm test` and inspect the new `summarizeEurUsdSetup reports spread percentiles, captured gate failures, and UTC-hour buckets` test.
2. Inspect the full CI result, separating any known unrelated GOLD V2 fixture failure from EURUSD diagnostics failures.
3. Review the PR before merging.
4. Only after merge, trigger the manual Render deploy because `autoDeploy=no`.
5. Verify latest deploy is live, error logs are clean, and the Forward Monitor exposes the new spread distribution.
6. Collect at least 30-100 new EURUSD observations before judging time-of-day patterns. Do not adjust `EURUSD_MAX_SPREAD_PIPS` solely to increase trade frequency.


## 2026-10-09 EURUSD spread-cost and H1 trend research

Branch: `research/eurusd-spread-h1-diagnostics`

Goal:
- Reproduce the runtime observation that every one of 28 recent diagnostics exceeded the configured 1.20-pip max-spread gate.
- Separate the effect of assumed execution costs from the max-spread filter.
- Identify which clauses of the H1 UP/DOWN rule cause H1 trend to remain RANGE/unclear.
- Do not change production entry criteria, spread gates, or execution settings as part of this research.

New research assets:
- `scripts/backtest-eurusd-legacy-core.mjs` now persists the scenario name/type, spread data limitations, configured max spread, fixed latest-5-year validation split (3-year IS / 2-year OOS), and H1 EMA-stack/close-position rejection counters.
- `scripts/aggregate-eurusd-spread-sensitivity.mjs` aggregates scenario artifacts into JSON, CSV, and Markdown comparison reports.
- `scripts/validate-eurusd-spread-sensitivity.mjs` runs a synthetic smoke replay to verify spread-gate and H1-diagnostic output.
- `.github/workflows/eurusd-spread-sensitivity.yml` evaluates nine scenarios:
  - Cost sensitivity: assumed constant spread 0.8 / 1.2 / 1.5 / 2.0 / 2.2 pips, with the pips gate set to 2.5 to keep that gate from dominating.
  - Gate sensitivity: assumed constant spread 2.0 pips with gate thresholds 1.2 / 1.5 / 2.0 / 2.2 pips.

Data limitation:
- The historical replay dataset has bid OHLCV, not timestamped bid/ask or historical broker spread. Therefore these are constant-spread sensitivity scenarios, not actual historical XM spread reconstruction.
- Gate values below the assumed 2.0-pip spread are expected to reject candidates by design. These scenarios validate gate behavior; they are not profitability evidence.
- A 2.5-pip gate in cost sensitivity only isolates the pips upper-bound gate; the spread-to-target economic filter still applies.
- Use fixed 3-year IS / 2-year OOS over the latest five years as the primary robustness check. Do not select a scenario only because its full-history result looks best.
- Any H1 counters describe bars reached by the replay engine after its one-position/cooldown logic, not every candle in the raw file.

Resume / decision gate:
1. Inspect the GitHub Actions run for EURUSD Spread Sensitivity Research.
2. Require validation, synthetic smoke, and repository tests to pass before using the report.
3. Download the `eurusd-spread-sensitivity-summary` artifact and compare OOS trades/PF/expectancy/drawdown, plus H1 rejection counts.
4. If the currently observed real spread remains near 2.0 pips, assess whether any strategy variant maintains positive OOS expectancy under the 2.0+ pip cost case. Do not lower required evidence standards to increase frequency.
5. Keep EURUSD execution and Gold auto-orders OFF. These are research-only code/workflow changes; no Render deploy is required unless runtime application files change.


## 2026-10-09 EURUSD history provider transient-empty hardening

Failure observed in EURUSD Spread Sensitivity Research run 37890585828:
- The syntax check, synthetic replay smoke test, and full `npm test` suite all passed.
- Dataset preparation then failed after about six minutes because `dukascopy-node` returned zero M15 rows without throwing.
- The same 10-year preparation command had succeeded on 2026-10-07 and returned 248,164 valid M15 rows. This points to a transient upstream empty-response/download issue rather than a deterministic invalid request.

Fix on branch `fix/eurusd-history-download-retry`:
- Use restrained download batches (size 5, 1500ms pause by default).
- Enable provider-level retries for failed and empty artifacts.
- If the overall returned dataset is still insufficient, retry the full request once after a pause.
- Log each attempt's row count, duration, retry configuration, and error so a future failure can be diagnosed instead of only reporting zero bars.
- Keep the minimum data coverage guard and validate OHLC rows, completed-bar cutoff, chronological order, and duplicate timestamps before writing the dataset.
- The research workflow path filters now include the data-preparation script so its changes trigger validation.

Safety/behavior:
- Research data-preparation only; no entry/exit rules, spread thresholds, production Render code, or real-order settings changed.
- The historical dataset is bid OHLCV only, not historical XM bid/ask spread data.
- Keep EURUSD execution and Gold auto-orders OFF.

Resume:
1. Inspect the latest EURUSD Spread Sensitivity Research workflow for `validate` and `prepare` results.
2. If data preparation succeeds, verify all nine scenario jobs and the aggregate report complete.
3. Download `eurusd-spread-sensitivity-summary` and read OOS metrics before considering any parameter change.
4. If data preparation fails again, inspect the per-attempt JSON logs before changing strategy logic.
