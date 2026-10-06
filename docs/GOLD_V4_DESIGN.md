# GOLD V4 Design

## Objective

GOLD V4 tests a different entry mechanism from V2:

1. H1 trend alignment
2. M5 range/compression
3. strong directional breakout
4. controlled retest of the broken range boundary
5. confirmation rejection from the boundary
6. entry on the next M5 bar

The system is research-only. No automatic live-order promotion is part of V4.

## Why V4 is a new experiment

V2 enters on the breakout confirmation candle. V4 deliberately does not enter there. A valid breakout creates a level; price must subsequently return to that level within a limited number of bars, remain within a controlled depth, and then close back in the breakout direction.

This is intended to reduce chasing and reject breakouts that fail immediately.

## Main controls

- Range width is measured in ATR.
- Breakout requires minimum body/ATR, close location, and volume expansion.
- Retest must happen within a bounded number of M5 bars.
- Retest depth is bounded in ATR so a full breakdown is not accepted as a retest.
- Confirmation requires body, directional close, a small buffer beyond the broken level, and M5 EMA20 alignment.
- Stop is placed beyond the observed retest extreme with an ATR buffer.
- Target is fixed at a configurable R multiple.
- Entry-gap, daily-loss, and drawdown gates are enforced by the backtester.

## Validation standard

V4 is not considered a candidate for live execution merely because a 5-year PF is above 1.

The preferred evidence is:

- Baseline and conservative transaction-cost scenarios both pass the quality gate.
- Recent 365-day results remain viable.
- At least three positive calendar years.
- BUY/SELL results are not completely dependent on one side.
- Fixed 3-year IS / 2-year OOS walk-forward remains viable without OOS tuning.

## Resumability

V4 reuses the repository's tested chunk-based Dukascopy downloader:

- 14-day independent chunks
- stable completed-M5 cache keys
- raw M1 checkpoint cache per chunk
- atomic checkpoint files
- separate V4 cache namespace
- fixed date window

A stopped workflow can be rerun without discarding completed chunks. A new run restores stable completed M5 chunks and prior raw M1 checkpoints.
