# GOLD V2 H1 Trend Filter Ablation — 2026-10-16

**Status:** research-only, not approved for live use.  
**Safety:** real order gate remains OFF; Mode ANALYSIS / Forward-Paper only; no Render deployment; PR #49 remains Draft/unmerged.

## Why this test was run

The user-provided GOLD API diagnostic snapshot at 2026-10-16 11:45 JST showed 1,342 cumulative GOLD signal evaluations, all WAIT. In the most recent 200 reason-attributed bars, 57 were rejected by the session filter, and the remaining 143 failed the strict H1 trend condition. For those 143, the observed H1 UP/DOWN condition count was 0/143 under the existing four-condition strict rule.

EURUSD's latest 200 technical diagnostics also showed a complete spread-gate failure: 2.31 pips mean spread versus a 1.20-pip limit (200/200 over limit), with the H1 trend unclear on 160/200. Those are independent blockers and are not addressed by the GOLD study below.

The test is a one-factor ablation of an already-existing research-only option in `src/gold_strategy_v2.js`, not a new threshold search:
- **Strict:** H1 close versus EMA20 + the ordered EMA20/EMA50/EMA200 stack + the existing H1 RSI band.
- **Research ablation (`close_ema20_rsi`):** keeps H1 close versus EMA20 and the same H1 RSI band, removes only the ordered EMA stack.
- M5 setup filters, breakout/volume/body/RSI/EMA checks, session, entry, SL/TP geometry, effective-RR admission, risk sizing, spread/slippage assumptions, and timezone are held fixed.
- Runs use the XM scheduled-gap-aware execution treatment; an unverified gap censors that window instead of creating a fictional exit.
- Data is the same prepared Dukascopy XAUUSD M5 history (354,305 bars, 2021-10-06 through 2026-10-04 UTC), not XM-native quotes.

## Results

### Full five-year window (risk/equity reset at the start)

| Mode | Cost | Closed trades | Setup candidates | PF | Expectancy (R/trade) | Return | Max DD |
|---|---|---:|---:|---:|---:|---:|---:|
| Strict | Baseline | 4 | 6 | 0.446 | -0.459 | -0.460% | 0.539% |
| Strict | Conservative | 3 | 6 | 0.000 | -1.166 | -0.872% | 0.872% |
| H1 stack ablation | Baseline | 9 | 12 | 1.235 | +0.147 | +0.326% | 0.828% |
| H1 stack ablation | Conservative | 6 | 12 | 0.739 | -0.205 | -0.311% | 0.871% |

All four five-year policy paths were complete under the current gap-censor policy. No unverified gap occurred within the simulated portfolio path for these runs.

### Separately reset recent 730-day window

| Mode | Cost | Closed trades | PF | Expectancy (R/trade) | Return | Max DD |
|---|---|---:|---:|---:|---:|---:|
| Strict | Baseline | 2 | 0.000 | -1.080 | -0.539% | 0.539% |
| Strict | Conservative | 2 | 0.000 | -1.122 | -0.560% | 0.560% |
| H1 stack ablation | Baseline | 4 | 0.592 | -0.338 | -0.340% | 0.828% |
| H1 stack ablation | Conservative | 4 | 0.543 | -0.398 | -0.400% | 0.871% |

Both recent-window comparisons were complete. The recent-window run resets equity and risk state at its own start while using earlier bars only for causal indicator warm-up. This window has now been inspected and must not be presented as unseen holdout for future variants.

## Interpretation

The ablation changes trade frequency (four to nine completed trades in the full five-year baseline-cost run), so the dashboard observation that the strict H1 stack is the current funnel bottleneck is consistent with the historical study. But **higher frequency is not demonstrated higher robustness**:
- The full five-year baseline-cost result of the ablation looks positive (PF 1.235, expectancy +0.147R) but is only nine trades and fails the existing five-year quality gate.
- Under conservative costs, its five-year expectancy becomes negative and PF falls below 1.
- The separately reset recent 730-day segment has negative expectancy under both cost models (only four trades).
- The existing quality gate also requires at least 30 trades and applies activity/positive-year conditions; neither H1 mode qualifies.

Therefore, **do not replace the strict H1 filter in production and do not deploy the ablation**. This outcome is a research hypothesis: if further checked, it needs fresh broker-native XM GOLD bars/spread evidence and genuinely new prospective data, not another threshold search on this same history.

## Reproducibility

- H1-mode study workflow (first complete run on the frozen one-factor experiment): https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38842507033
- Artifact: https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38842507033/artifacts/12022175596
- Study runner: `scripts/run-gold-v2-h1-mode-study.mjs`
- Workflow: `.github/workflows/gold-v2-h1-mode-research.yml`
- Related strategy implementation: `src/gold_strategy_v2.js`

No production strategy, EA, Render service, or live-order gate was changed by this experiment.
