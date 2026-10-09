# AI Handoff — next step

Read docs/AI_HANDOFF.md, docs/CONNECTION_RECOVERY.md, docs/AUTO_RECOVERY.md, docs/GOLD_V2_LIVE_DIAGNOSTIC_2026-10-09.md, and docs/GOLD_V2_H1_TREND_DIAGNOSTIC_2026-10-09.md from the current main branch first.


## Latest GOLD V2 forward state — 2026-10-09 21:10 JST

The latest supplied snapshot supersedes the earlier 16:25 snapshot for current monitoring: 309 signals, all WAIT (BUY 0 / SELL 0); runtime ANALYSIS, DB ok, auto-trading OFF. Of the latest 200 rows, 101 were outside session and all remaining 99 failed the combined H1 trend gate. No observations reached M5 range/compression/breakout, so the blank Range ATR panel is expected, not proof of missing ATR data upstream.

### Next GOLD task

A diagnostics-only implementation is in branch `feat/gold-h1-trend-diagnostics` with a dedicated `GOLD V2 Diagnostic Tests` workflow. It stores the H1 component checks separately (price vs EMA20, EMA20 vs EMA50, EMA50 vs EMA200, RSI band) for both UP and DOWN paths, then adds overlapping blocker counts to the Forward Monitor. It must not change candidate selection or production thresholds. Review PR and require all tests to pass before merge. Render auto-deploy is disabled; do not deploy without a separate decision. Once deployed, collect new in-session diagnostic rows before deciding if any H1 filter deserves research.

## Latest GOLD V2 forward state — 2026-10-09 16:25 JST

The forward monitor reports gold-m5-h1-v2 on M5; ANALYSIS mode; auto-trading OFF; DB ok; AI only on candidate enabled. Total 252 signals: BUY 0, SELL 0, WAIT 252. Of the latest 200, 108 failed session, 78 of the 92 in-session failed H1 trend, 13 of 14 reaching compression failed, and the one remaining candidate failed breakout width.

Range ATR sample size is 12: min 2.63, median 4.85, max 5.36, mean 4.50 versus production bounds 0.80–2.80. The range ratio is the previous 12 M5 bars' high-low width divided by M5 ATR14. This signals a hypothesis to test, not enough data for production recalibration.

## Next GOLD research task

Inspect the newest GOLD V2 Five-Year Research run and its matrix artifact. The research workflow already defines max-range variants 4.0, 4.5, 5.0 and 5.5, plus a looser multi-parameter variant. Compare full-period, fixed IS/OOS, recent-period, conservative-cost and drawdown results. Preserve the frozen OOS window. Do not start another run until checking whether one is already active.

## Auto-recovery status

The workflow .github/workflows/auto-recover-research.yml watches the GOLD V2 Five-Year Research and two EURUSD research workflows. It retries only the first attempt of failures/timeouts/startup failures on this repository's main branch, caused by push or workflow_dispatch, at most once. It becomes active only after merge to main and after repository Actions policy permits its actions: write token permission.

## Safety invariants

GOLD auto-trading OFF; EURUSD live execution OFF; no Render deployment for research-only work; no promotion without sufficient OOS and conservative-cost evidence.

## Latest EURUSD forward state — 2026-10-09 (monitor display 20:45:03)

- Strategy: `eurusd-m15-h1-deterministic-forward-v1`, M15.
- Total 58 signals: BUY 0, SELL 0, WAIT 58. Forward trades/open 0; execution OFF.
- Diagnostics: 53/58 rows (91.4%), average Range ATR 2.42, Body ATR 0.60, average spread 1.93 pips. Mean/median/P90 spread 1.93/1.90/2.08, range 1.80–2.20 pips; all 53 exceed the 1.20-pip ceiling and 40/53 fail spread/ATR 15%.
- H1 trend is unclear on all 53 diagnostic rows. EMA, directional RSI, penetration and close-location reasons overlap because those checks are direction-dependent; they should be labeled “not evaluated — H1 unclear” rather than counted as independent failures when `trend === RANGE`.
- Do not raise production thresholds from the live sample. The existing historical sensitivity run did not validate positive OOS at assumed 2.0 pips; ATR 35%/50% research variants had zero OOS trades.

### Next EURUSD research task

Read `docs/EURUSD_FORWARD_DIAGNOSTIC_2026-10-09.md`. The diagnostics-only solution normalizes persisted/API reasons in `src/eurusd_diagnostics.js` and translates labels in the Forward Monitor UI; candidate generation stays unchanged. The focused `EURUSD Diagnostic Unit Tests` workflow runs the complete Node test suite without coupling this display-only change to the unrelated historical backtest/MT4 static-validator workflow. Then use the fixed historical IS/OOS split to decompose H1 regime frequency, technical candidate frequency, and spread/cost blockers. No Render deployment or live execution change.
