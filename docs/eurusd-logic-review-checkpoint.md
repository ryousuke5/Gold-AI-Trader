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

After correcting the timebase separation, E is a valid research candidate:
- Session/range timezone: `Europe/London`, pre-London range 00:00–07:00 local
- H1 trend timezone: `Europe/Nicosia` (XM-style broker H1)
- Entry window: 07:00–15:00 London local
- H1 stack + 6-bar slope agreement
- Range width: 0.50–2.00 ATR
- Structural stop: opposite range ±0.15 ATR
- Target: 2.0R
- Max one trade per London session/day
- Spread-to-target filter: 15%

Authoritative exact evaluator on the canonical five-year dataset:
- 75 trades
- PF 1.267
- EV +0.098R
- net +7.34R
- max DD 4.93R
- recent 365d: 12 trades, PF 2.177, EV +0.364R, DD 2.39R
- BUY: 38 trades, EV +0.143R
- SELL: 37 trades, EV +0.052R
- bootstrap EV 95% CI: approximately [-0.123R, +0.329R]
- bootstrap P(EV <= 0): about 0.204

Annual net R:
- 2021: -3.26R
- 2022: +0.45R
- 2023: +6.57R
- 2024: -0.48R
- 2025: +3.56R
- 2026 YTD: +0.49R

Cost sensitivity using the same candidate stream:
- 0.8 pip / 0.1 pip: PF 1.267, EV +0.098R
- 1.0 pip / 0.2 pip: PF 1.134, EV +0.051R
- 1.2 pip / 0.2 pip: needs final exact workflow confirmation before acceptance

**Decision: RESEARCH ONLY.** E is materially better than C/D and deserves further OOS and cost-stress testing, but it does not yet clear the production gate because EV is below +0.10R and performance is execution-cost sensitive. The recent validation has only 12 trades, so it cannot establish a stable edge by itself.

## Next engineering gate

1. Export every Strategy E candidate with only point-in-time features and a future outcome label.
2. Build an AI-filter dataset without lookahead/data leakage.
3. Compare Base E vs Base E + AI on the exact same candidate stream.
4. Require the AI filter to improve expectancy and cost robustness, not merely trade frequency.
5. Re-run rolling out-of-sample validation and stress tests before any live integration.

This file is the restart checkpoint: do not skip directly to live deployment.
