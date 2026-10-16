# GOLD V2 H1 Trend-Mode One-Factor Study — 2026-10-16

**Status: research only.** This study was run successfully via GitHub Actions on the same prepared five-year Dukascopy XAUUSD M5 dataset. No production configuration changed; no Render deployment or live orders.

## Fixed one-factor comparison

The only factor changed was the H1 trend mode:
- **Strict:** H1 close vs EMA20 confirmation, EMA20/EMA50/EMA200 ordered stack, plus the existing H1 RSI band.
- **Research ablation:** keep H1 close vs EMA20 and the same H1 RSI band, removing only the ordered EMA-stack requirement.

M5 filters, entry decisions outside the H1 mode, stop/target logic, effective-RR admission, session, risk, modeled spreads/slippage, Europe/Nicosia aggregation, and schedule-aware gap handling were held fixed. This is not a threshold sweep.

## Results

| Window | Mode | Cost | Trades | Candidates | PF | Expectancy (R/trade) | Return | Max DD | Valid complete window |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| Five years | Strict | Baseline | 4 | 6 | 0.446 | -0.459 | -0.460% | 0.539% | Yes |
| Five years | H1 stack ablation | Baseline | 9 | 12 | 1.235 | +0.147 | +0.326% | 0.828% | Yes |
| Five years | Strict | Conservative | 3 | 6 | 0.000 | -1.166 | -0.872% | 0.872% | Yes |
| Five years | H1 stack ablation | Conservative | 6 | 12 | 0.739 | -0.205 | -0.311% | 0.871% | Yes |
| Recent 730 days | Strict | Baseline | 2 | 2 | 0.000 | -1.080 | -0.539% | 0.539% | Yes |
| Recent 730 days | H1 stack ablation | Baseline | 4 | 4 | 0.592 | -0.338 | -0.340% | 0.828% | Yes |
| Recent 730 days | Strict | Conservative | 2 | 2 | 0.000 | -1.122 | -0.560% | 0.560% | Yes |
| Recent 730 days | H1 stack ablation | Conservative | 4 | 4 | 0.543 | -0.398 | -0.400% | 0.871% | Yes |

## Interpretation

Removing the strict EMA stack tripled the candidate count from 6 to 12 and produced 9 vs 4 baseline-cost trades. Its five-year baseline PF/expectancy were nominally positive, but **the effect does not meet the quality gate**:
- only 9 actual modeled trades, far below the 30-trade five-year minimum;
- conservative-cost PF is 0.739 and expectancy is -0.205R/trade;
- the recent 730-day window is negative under both cost assumptions;
- all four recent-window modeled trades under the stack ablation still have negative expectancy in aggregate.

Therefore this is a **hypothesis worth retaining, not a candidate for production**. More signals alone do not demonstrate an edge. The recent 730-day window has now been inspected and is no longer an untouched holdout for follow-up variants.

## Decision

Keep the strict mode in the running app/production settings. Do not turn on the alternative H1 mode in Render or MT4. The next step is broker-native data/source validation (including spread and rollover assumptions) rather than optimizing the stack-ablation's thresholds on the same data.

## Reproducibility

- Workflow: https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38842818453
- Artifact: https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38842818453/artifacts/12022595283
- Draft PR #49 remains unmerged.
