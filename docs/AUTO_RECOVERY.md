# Automatic recovery for long-running research

## What it does

The workflow .github/workflows/auto-recover-research.yml watches:

- EURUSD Spread Sensitivity Research
- EURUSD Legacy Range Breakout Core Research
- GOLD V2 Five-Year Research

On an eligible first-attempt failure, timeout, or startup failure from this repository's main branch, it re-reads the run from the GitHub API and requests a rerun of failed jobs and dependent jobs once. A successful recovery-workflow run means the retry request was accepted; it does not mean the research subsequently passed.

## Safety protections

- Exact allowlist of three workflow names.
- Only this repository's main branch and push/workflow_dispatch events qualify; pull-request runs are excluded.
- Only attempt 1 is retried; attempt 2 never triggers another retry.
- Cancelled and successful runs are not retried.
- The privileged workflow does not check out or execute triggering-branch code.
- Uses GITHUB_TOKEN with actions: write and contents: read; no personal access token is stored.
- No trading, Render deployment, or strategy thresholds are changed.

## Enable and verify

1. Merge .github/workflows/auto-recover-research.yml and this document to main.
2. In repository Settings > Actions > General, ensure the GITHUB_TOKEN workflow permission policy permits the explicitly declared actions: write permission.
3. Open Actions > Auto Recover Research Runs after an eligible failure, then inspect the original run and its new attempt.
4. Test first with a manually dispatched research run only if you already have a failed/cancelled research scenario to inspect; do not deliberately break production services to test this.

## GOLD V2 snapshot — 2026-10-09

The forward monitor reported 252 signals, all WAIT, with zero BUY/SELL, runtime ANALYSIS, auto-trading OFF, and DB status ok. In the latest 200 records, 108 were rejected by the session filter, 78 of the 92 in-session records by the H1 trend filter, 13 of 14 range-compression checks, and the one remaining candidate at breakout width.

Range ATR had only 12 observations: min 2.63, median 4.85, max 5.36, mean 4.50. Configured bounds are 0.80–2.80, so 11/12 observations exceeded the upper bound. This justifies inspecting the existing research variants, not changing the production threshold from a small sample.

The existing GOLD V2 Five-Year Research matrix includes research-only max-range variants 4.0, 4.5, 5.0 and 5.5. Check the latest run and compare five-year, fixed IS/OOS, recent-period, conservative-cost and drawdown results before considering a change.

## Important limitation

This mechanism retries only eligible GitHub Actions jobs. It cannot reconnect a disconnected ChatGPT browser or network session. Keep durable repository checkpoints and run artifacts as the recovery point.
