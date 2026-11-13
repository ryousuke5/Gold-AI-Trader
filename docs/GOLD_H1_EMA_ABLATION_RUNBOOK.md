# GOLD V2 H1 EMA Component Ablation Runbook

## Purpose

This is a research-only, isolated experiment to identify which H1 EMA ordering rule suppresses candidate generation. It does not change GOLD V2 production settings, Render configuration, MT4 settings, or order execution.

## Pre-registered variants

Every mode preserves the existing H1 close-vs-EMA20 condition and H1 RSI bands (BUY 50–72; SELL 28–50). Every mode also preserves all M5 filters, stop/target logic, risk sizing, and session settings.

| Variant | BUY EMA ordering | SELL EMA ordering |
|---|---|---|
| A Strict | EMA20 > EMA50 > EMA200 | EMA20 < EMA50 < EMA200 |
| B Keep EMA20/EMA50 | EMA20 > EMA50 | EMA20 < EMA50 |
| C Keep EMA50/EMA200 | EMA50 > EMA200 | EMA50 < EMA200 |
| D Close/EMA20 + RSI only | No EMA ordering requirement | No EMA ordering requirement |

The variant names are implemented as `strict`, `keep_ema20_ema50`, `keep_ema50_ema200`, and `close_ema20_rsi`.

## Data and evaluation

- Source data is the prepared fixed-window dataset embedded in Walk-Forward run `43349812731`.
- IS is the fixed 3-year slice; OOS is the separate fixed 2-year slice.
- Each of the four pre-registered variants is run independently on both periods.
- Baseline costs: spread 0.50 / slippage 0.05.
- Conservative costs: spread 0.75 / slippage 0.10.
- All M5 and risk parameters are held fixed at the GOLD V2 baseline values.
- The OOS results are reported for evaluation only. They are not used to select a winner or tune thresholds.
- IS research eligibility screen: conservative-cost trades >=20, PF >=1.05, expectancy >=+0.05R, max drawdown <=5%, and at least 2 positive calendar years. A pass is not promotion approval.

## Execute

The workflow `GOLD V2 H1 EMA Component Ablation (Research Only)` is scoped to branch `research/h1-ema-component-ablation-20261113`. Its push trigger downloads only the named artifact from the already-completed Walk-Forward run above, runs the unit test, then produces JSON and Markdown reports.

## Safety

- Production remains GOLD V2 Strict.
- ANALYSIS mode remains enabled.
- `auto_trading_enabled=false`.
- Real-order gate remains OFF.
- No Render deployment is part of this workflow.
- Do not merge this branch into `main` or promote a research variant based solely on this report.
