# EURUSD Logic Review — research checkpoint

## Current status

**Production status: HOLD.** No live deployment and no real orders.

All research on branch `research/eurusd-logic-review-v4`.

## Common backtest model

- Data: Dukascopy EURUSD M15 BID
- Coverage: 2021-10-07 through 2026-10-06
- Bars: 124,150
- H1 aggregation: `Europe/Nicosia`
- Signal uses a completed M15 bar; entry is next-bar open
- BUY entry = BID open + spread + slippage
- SELL entry = BID open - slippage
- BUY exits use BID; SELL exits use ASK
- Same-bar stop/target: conservative STOP first
- Cost baseline: 0.8 pip spread + 0.1 pip slippage

## Results

### Strategy C — trend/pullback/resumption
Corrected SELL execution model.

- baseline: 3 trades, PF 0.74, EV -0.17R, recent 365d 0
- quality: 2 trades, PF 1.48, EV +0.24R, recent 365d 0
- looser: 5 trades, PF 0.37, EV -0.51R, recent 365d 0

**Decision: reject as a base strategy.** Sample size is too small and recent validation is empty.

### Strategy D — H1 trend + M15 range breakout
- baseline: 4 trades, PF 0.49, EV -0.38R
- quality: 4 trades, PF 0.49, EV -0.38R
- looser: 9 trades, PF 0.74, EV -0.18R

**Decision: reject.** Loosening the filter raises frequency without creating a robust edge.

### Strategy E — pre-London range breakout

An early exploratory implementation produced an apparently stronger result, but the stateful session-range explorer was later found to under-count / mismatch the exact session logic. Those optimistic figures are **discarded**.

Authoritative exact-evaluator result using the same canonical five-year dataset and execution model:

- 256 trades
- PF 1.076
- EV +0.036R
- net +9.31R
- max DD 19.88R
- recent 365d: 58 trades, PF 1.025, EV +0.011R, DD 11.43R
- bootstrap EV 95% CI: [-0.102R, +0.181R]
- P(EV <= 0): about 0.302

Annual net R:
- 2021: -0.50R
- 2022: -0.85R
- 2023: +17.72R
- 2024: -16.25R
- 2025: +7.25R
- 2026 YTD: +1.94R

Direction asymmetry is a major warning:
- BUY: 120 trades, EV +0.130R
- SELL: 136 trades, EV -0.046R

**Decision: reject as production strategy for now.** The observed edge is too weak, the recent validation is near flat, drawdown is too large for the return, and the bootstrap interval includes zero.

## Next engineering gate

1. Export every Strategy E candidate with only point-in-time features and a future outcome label.
2. Build an AI-filter dataset without lookahead/data leakage.
3. Compare Base E vs Base E + AI on the exact same candidate stream.
4. Require the AI filter to improve expectancy and cost robustness, not merely trade frequency.
5. Re-run rolling out-of-sample validation and stress tests before any live integration.

This file is the restart checkpoint: do not skip directly to live deployment.
