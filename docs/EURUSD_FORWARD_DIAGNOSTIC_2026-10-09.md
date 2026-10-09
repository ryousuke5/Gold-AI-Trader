# EURUSD Forward Monitor Diagnostic Checkpoint

Snapshot displayed by the Forward Monitor: 2026-10-09 20:45:03 (the UI timezone is not asserted here).
Strategy: `eurusd-m15-h1-deterministic-forward-v1`; timeframe M15.
Execution remains OFF. This is forward/paper observation only.
AI environment filter: DISABLED. OpenAI on latest signal: OFF. News feed: unknown.
No deployment or production settings were changed from this snapshot.

## Observed state

- Total signals: 58; BUY 0, SELL 0, WAIT 58.
- Technical-setup diagnostic coverage: 53 / 58 (91.4%); 5 rows lack a current diagnostic record.
- Forward trades: 0; open: 0; no win-rate/PF/expectancy evidence can be inferred from zero trades.
- On the 53 diagnostic rows: average range width 2.42 ATR; average breakout body 0.60 ATR; average measured spread 1.93 pips.
- Breakout distance average is unavailable (`—`) because a directional H1 regime was not observed in the diagnostic set.
- Latest reason list includes H1 trend unclear, M15 EMA mismatch, M15 RSI outside breakout zone, spread failed, breakout penetration too small, weak close location, and failed volume confirmation.

## Spread facts

- Sample: 53 observations.
- Configured pips ceiling: 1.20.
- Mean / median / P90: 1.93 / 1.90 / 2.08 pips.
- Minimum / maximum: 1.80 / 2.20 pips.
- Pips gate failures: 53 / 53 (100%).
- Spread/ATR gate failures: 40 / 53 (75.5%).
- Combined spread filter failure: 53 / 53 (100%).

At these observed costs, the current 1.20-pip maximum prevents every diagnostic observation from passing the spread gate. However, **raising the ceiling alone is not a justified fix**: all 53 diagnostic observations also reported `h1_trend_not_clear`, and the downstream directional breakout conditions are not meaningfully testable without a defined direction. Of the observations, 13/53 pass the current spread/ATR gate, but that does not mean 13 valid setups exist.

## Important diagnostics interpretation — overlapping reasons

Code inspection of `src/eurusd_features.js` shows that the monitor records multiple rejection reasons per signal rather than a sequential, mutually-exclusive funnel. When `eurUsdH1Trend()` returns `RANGE`, the direction-dependent conditions are false by construction:

- M15 EMA alignment is checked against UP/DOWN; if trend is RANGE, neither directional expression matches.
- The breakout RSI-zone test is likewise direction-dependent.
- Breakout penetration and close-location confirmation need UP or DOWN to choose a side.

Therefore, counts such as H1 trend unclear 53, EMA mismatch 53, and RSI outside zone 53 are overlapping diagnostics, not three independent failures. They should be displayed as “not evaluated — H1 trend unclear” for those downstream directional checks, while preserving the actual candidate logic. Independent gates such as spread, range width, candle body, and volume can still be measured.

## Historical research cross-check

The already-completed 12-scenario EURUSD research found no OOS validation at plausible transaction costs:

- At assumed 2.0 pips with the 15% spread/ATR cap, the configuration produced no trades.
- Raising the pips ceiling to 2.2 while retaining the 15% ATR cap also produced no trades.
- Research-only 35% / 50% spread/ATR variants produced 12 overall trades (8 IS) but zero OOS trades.
- The historic source was bid-only OHLCV with constant assumed cost, not broker-specific historical XM spread.

Those results do not support changing production thresholds. They reinforce the need to separate trend frequency, independent technical candidate geometry, and costs in diagnostics.

## Next research steps

1. Normalize only the Forward/API diagnostic reasons at the server boundary (`src/eurusd_diagnostics.js`, called from both EURUSD AI-test and signal endpoints) when trend is RANGE. Do not change the BUY/SELL/WAIT candidate conditions or spread thresholds.
2. Use the focused `EURUSD Diagnostic Unit Tests` workflow and regression tests to verify RANGE is still WAIT, valid UP/BUY setup data is not altered, and true directional failures remain failures for UP/DOWN.
3. Inspect H1 trend frequency and candidate geometry in the fixed historical IS/OOS sample under realistic costs; do not use overlapping RANGE downstream reasons as independent failure counts.
4. Check current GitHub Actions runs before any dispatch; avoid a new full matrix if a compatible run is active.
5. Keep EURUSD execution OFF, GOLD auto-orders OFF, AI environment disabled as configured, and do not deploy or modify production spread thresholds based on this snapshot.

## Resumption

Read `docs/AI_HANDOFF.md`, `docs/CONNECTION_RECOVERY.md`, `docs/AUTO_RECOVERY.md`, and this checkpoint before a continuation session. Then verify the latest `main` commit and current Actions runs before editing code.
