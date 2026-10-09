# GOLD V2 H1 Trend Filter Diagnostic — 2026-10-09 21:10 JST

## Runtime snapshot supplied by Forward Monitor

- Strategy: `gold-m5-h1-v2`, M5.
- Runtime: `ANALYSIS`; database `ok`; Gold auto-trading `OFF`.
- Total signals: 309; BUY 0; SELL 0; WAIT 309.
- Latest 200 rows: session filter rejected 101/200; the remaining 99/99 were rejected at H1 trend; no rows reached range continuity/compression/breakout.
- Range ATR: no new diagnostic observations, because the pipeline stopped at H1 trend before computing the M5 range.
- Trade results: 0. No profitability conclusion can be drawn.

## What can and cannot be concluded

The current H1 trend gate requires one of two complete combinations:

- UP: H1 close > EMA20 > EMA50 > EMA200, and H1 RSI within 50–72.
- DOWN: H1 close < EMA20 < EMA50 < EMA200, and H1 RSI within 28–50.

The current monitor reports only the aggregate reason `h1_trend_filter`. Therefore, 99/99 rejected rows establishes that the combined condition did not pass in this sample, but it does **not** tell us whether the dominant blocker was EMA ordering, close versus EMA20, RSI bands, or a combination. This sample alone does not justify loosening the H1 criteria.

## Diagnostic change prepared

A diagnostics-only change adds, for valid in-session GOLD V2 signal rows:

- H1 close/EMA20, EMA20/EMA50, and EMA50/EMA200 distances normalized by H1 ATR.
- Boolean pass/fail for each UP and DOWN component.
- Separate component-failure lists for UP and DOWN.
- Forward Monitor counts for each component among rows rejected by the H1 trend filter.

These are overlapping component counts, not mutually exclusive or sequential funnel stages; the UI explicitly warns not to add them together. The existing candidate logic, trend thresholds, session hours, range ATR limit, AI behavior, and execution settings are unchanged.

## Next steps

1. Run the dedicated GOLD V2 diagnostic unit tests and all existing Node tests.
2. Review/merge the diagnostic-only PR if CI is green.
3. This repository's Render configuration has auto-deploy disabled; the live monitor will not receive new fields until an explicit deployment is performed. Do not deploy as part of this research task without a separate decision.
4. After the diagnostic code is deployed, collect a fresh set of in-session signals, then assess which H1 component is the most frequent blocker.
5. Only after H1 allows signals to reach later stages should we revisit Range ATR. Keep GOLD auto-trading OFF and do not loosen thresholds based on signal-count pressure.
