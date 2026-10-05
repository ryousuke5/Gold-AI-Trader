# Gold AI Trader — Resume / Interruption Checkpoint

## Current checkpoint
- Phase: Gold V2 resumable backtest
- Runtime script: `scripts/backtest-gold-v2-resumable.mjs`
- E2E test workflow: `.github/workflows/gold-v2-resume-test.yml`
- Real-money orders: OFF during research/validation

## Resume contract
1. Checkpoint file: `gold_v2_resume_checkpoint.json`
2. Writes are atomic (temporary file + rename).
3. Checkpoint identity binds dataset + config + strategy. A mismatch aborts resume rather than risking an unsafe continuation.
4. Resume starts at `next_index` and restores equity, trades, daily state, and next available entry index.
5. `GOLD_TEST_STOP_AFTER_BARS` intentionally pauses a run for interruption testing.
6. The E2E workflow performs the interruption in one job, restores the checkpoint into a fresh job, resumes to completion, then compares the resumed trade output with a clean baseline.

## Required verification before treating the mechanism as production-grade
- E2E workflow passes.
- Resumed output equals clean baseline byte-for-byte.
- Final checkpoint status is `COMPLETE`.
- No duplicate/overlapping trades are introduced.
- Dataset/config/strategy identity mismatch is rejected.

## Next action after an interruption
Run/inspect **Gold V2 Resume Test** first. Do not start a new backtest or delete the checkpoint until its identity and status have been checked.
