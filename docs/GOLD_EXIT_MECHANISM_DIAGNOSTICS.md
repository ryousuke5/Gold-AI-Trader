# GOLD exit-mechanism diagnostics

## Purpose

This is an observability-only addition to historical GOLD V2 backtests. It separates losses that reach the stop-loss during the first entry candle from losses that remain open until the configured holding-time limit and then close below entry. It does not change candidate generation, stop/target levels, risk sizing, or order execution.

## Exit classes

- `ENTRY_BAR_STOP_LOSS`: the stop is touched in the first M5 OHLC candle scanned after entry.
- `LATER_STOP_LOSS`: the stop is touched on a later candle.
- `TIME_EXIT_LOSS`: no earlier stop/target/data-gap exit occurs and the final modeled result is negative when the maximum holding window ends.
- `TIME_EXIT_WIN` / `TIME_EXIT_BREAKEVEN`: the same time exit with non-negative result.
- `TARGET_EXIT`, `DATA_GAP_EXIT`, `SAFETY_EXIT`, and `OTHER_EXIT`: retained separately so they are not incorrectly counted as time-exit losses.

## Cause-comparison fields

For each group, the JSON report summarizes sample size, share, loss rate, total and average R, average loss R, average holding bars/minutes, MFE/MAE in R, BUY/SELL breakdown, UTC-hour breakdown, and mean entry/setup characteristics:

- `range_atr`, `breakout_atr`, `body_atr`, `close_location`, `volume_ratio`, `extension_atr`, and `entry_gap_atr`.

This lets the reviewer check whether immediate stops are associated with larger entry gaps, weaker breakout bodies, extreme extension, or particular session hours, while time-exit losses can be compared by the same factors and by their adverse/favorable excursion before the time limit. Differences are descriptive, not causal proof; segment conclusions require enough trades and out-of-sample replication.

## Backtest engine parity and admission conditions

The ordinary and resumable runners are compared on the same prepared five-year M5 dataset. The comparison now applies the same `GOLD_BACKTEST_MIN_EFFECTIVE_RR` floor (default 1.50), the same entry-gap calculation (next M5 open versus signal close divided by signal ATR), and the same server-timezone H1 candle boundaries.

The resumable runner uses `GOLD_BACKTEST_SERVER_TIMEZONE` when aggregating M5 bars into H1 candles, with `Europe/Nicosia` as the five-year workflow setting. The H1 aggregation version is part of the checkpoint identity so checkpoints created using the previous UTC-only aggregation are rejected instead of mixed with the current run.

The comparison artifact, `gold_v2_engine_comparison.json`, verifies:
- Matched and unmatched trade identities based on signal timestamp plus entry timestamp.
- Side, setup type, entry/SL/TP, exit time/reason, net R, net PnL, effective RR, and entry-gap agreement.
- Candidate-funnel counts and the setup-wait-reason breakdown between both engines.
- No trade in either output falls below the shared effective-RR floor.

The five-year workflow is configured to fail unless all of those parity checks reconcile. This is a research reproducibility check, not permission to activate live trading.

## Setup funnel diagnostics

The resumable five-year runner also writes `gold_v2_funnel_diagnostics.json` and embeds the same object as `funnel_diagnostics` in `gold_v2_baseline_metrics.json`. Counters are stored in every checkpoint and restored on resume; the checkpoint identity includes a funnel schema version so old checkpoints cannot silently mix incomplete counters with new results.

The funnel reports:

- `bars_scanned`, `bars_skipped_while_in_trade`, and bars omitted for incomplete M5/H1 indicators.
- `signals_evaluated`, plus counts of each `setup_wait_reasons` reason.
- Candidate totals and BUY/SELL/other direction counts.
- Risk-gate checks, candidates blocked by each risk reason, and candidates passing the gate.
- Candidates rejected because the next M5 candle is not contiguous, invalid stop/target geometry, excessive entry gap, or insufficient effective reward/risk.
- `trades_accepted`, which should match the emitted trade list and exit-diagnostics sample size.

The workflow enforces reconciliation equations so lost counters or double-counted candidates fail validation rather than producing a misleading report:

- Evaluated signals = WAIT outcomes + candidates.
- Candidates = risk-gate blocked + risk-gate passed.
- Risk-gate passed = next-bar-gap rejects + trade attempts.
- Trade attempts = geometry rejects + entry-gap rejects + effective-RR rejects + accepted trades.

These are descriptive accounting counters, not additional filters. They must not change entry decisions or live execution.

## Reproduce

With a prepared XAUUSD M5 OHLCV dataset containing at least 200,000 valid bars:

```bash
GOLD_BACKTEST_DATA_FILE=/path/to/xauusd_m5.json node scripts/backtest-gold-v2-resumable.mjs
GOLD_TRADES_FILE=gold-backtest-output/gold_v2_resumed_trades.json node scripts/report-gold-v2-backtest.mjs
```

The report is written to `gold-backtest-output/gold_v2_baseline_metrics.json`; its `exit_mechanisms` section contains both requested loss groups. The resumable checkpoint identity versions exit diagnostics, funnel diagnostics, H1 aggregation, and trade-admission rules, so a checkpoint from an earlier schema or H1 candle boundary cannot be silently mixed with current output.

## OHLC limitations and safety

OHLC bars identify that a level was touched within a candle, not the exact order of the high and low. If stop and target are both touched in one candle, the backtest retains its conservative stop-first assumption and reports the ambiguity. MFE/MAE for the exit candle are candle-range approximations, not a tick-by-tick reconstruction.

Current Forward/Paper monitor snapshot has zero closed trades, so there is no observed live-loss sample to classify yet. Keep real orders disabled and do not alter thresholds solely to increase the count of one exit class.
