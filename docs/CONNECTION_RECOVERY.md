# Gold AI Trader — Connection / Session Recovery Checkpoint

Last updated: 2026-10-09 (Asia/Tokyo)
Repository: ryousuke5/Gold-AI-Trader
Default branch: main

Purpose: recover engineering work after a ChatGPT/browser/network interruption without relying on chat history.

## Safety invariants

- Keep EURUSD live execution disabled.
- Keep GOLD auto-orders disabled.
- Do not deploy to Render for research-only changes.
- Do not raise production spread/ATR limits just to increase trade count.
- Keep proposed strategy changes in research/backtest until independent OOS evidence is sufficient.

## Last verified research checkpoint

- EURUSD research merge: b88f29219d55baee8468eaf9cdddc433ae2289e8 (PR #34).
- Results/handoff commit: bbd31acec5a2022580e409ebdd1590ffc1069e3c.
- Workflow run: 37895240858 — https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/37895240858
- All 12 scenario jobs, dataset preparation/validation, smoke validation, npm test, and aggregation passed.
- Summary artifact ID: 11600052035 (eurusd-spread-sensitivity-summary).

## EURUSD interpretation

No tested configuration establishes positive out-of-sample performance at plausible costs. At assumed 0.8 pips there were 22 trades overall but only two OOS trades, both losing; OOS expectancy was -1.013 R. At assumed 2.0/2.2 pips with 15% spread/ATR ceiling there were no trades. Raising the ATR ceiling in research generated some in-sample trades but no OOS trades. Do not promote loosened thresholds.

The last dataset was a validated fallback from run 37625030497 because fresh Dukascopy requests returned HTTP 202 twice. It contained 248,164 bid-only M15 OHLCV bars, coverage 99.082%, ending at 2026-10-07T00:00:00Z. SHA-256: 29d0b820ffe43220b66147d707c2c30e245d35eac8d7ec05b27c5df292af08a9. It is not historical XM Ask/spread data. The source fallback artifact was expected to expire around 2026-10-14; before rerunning after expiry, repair or replace the data feed. Never call fallback data fresh or bypass freshness validation.

## GOLD V2 latest forward snapshot — 2026-10-09 16:25 JST

Strategy gold-m5-h1-v2 on M5; runtime ANALYSIS; database ok; auto-trading OFF; AI only on candidate. There were 252 signals: BUY 0, SELL 0, WAIT 252. Among the latest 200 records, session rejected 108, H1 trend rejected 78 of 92, compression rejected 13 of 14, and the remaining candidate failed breakout width. Range ATR sample count was 12, min 2.63, median 4.85, max 5.36, mean 4.50 against configured bounds 0.80–2.80.

Do not change production settings from this small live sample. Inspect the latest GOLD V2 Five-Year Research run and compare range_max_4, range_max_4_5, range_max_5, range_max_5_5 and loose variants, including fixed IS/OOS, recent, conservative-cost and drawdown metrics.

## Resume steps

1. Read docs/AI_HANDOFF.md, this file, docs/AUTO_RECOVERY.md and docs/GOLD_V2_LIVE_DIAGNOSTIC_2026-10-09.md.
2. Check the current main commit and latest Actions runs before launching anything.
3. If a run is active, inspect it first. Avoid duplicate dispatches because concurrency cancellation may cancel a running research job.
4. For partial failures, prefer rerunning failed jobs over repeating the whole matrix.
5. Save run IDs, artifacts, outcomes and the next action back to repository docs before starting another large task.
6. Keep production and order execution unchanged unless explicitly authorized.

Suggested restart instruction:

"Read docs/AI_HANDOFF.md, docs/CONNECTION_RECOVERY.md, docs/AUTO_RECOVERY.md, and docs/GOLD_V2_LIVE_DIAGNOSTIC_2026-10-09.md from the current main branch of ryousuke5/Gold-AI-Trader. Verify the latest Actions run and repository commit first. Resume the next research-only task. Do not enable live trading, change production thresholds, or deploy to Render."

A repository checkpoint cannot prevent ChatGPT itself from disconnecting. It preserves the project state and evidence so work can resume without depending on uninterrupted chat.
