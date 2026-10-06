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
Research candidate: pre-London range 00:00–07:00 London local time; entry window 07:00–15:00; H1 strict trend plus 0.67 slope agreement; range width 0.50–2.00 ATR; structural stop at the opposite range plus 0.15 ATR; 2.0R target; max one trade per session.

Best neighborhood observed in offline search:
- 74–76 trades over the full dataset
- PF about 1.29–1.34
- EV about +0.105R to +0.119R
- max DD about 4.9–5.2R
- recent 365d: 11 trades, PF about 1.53–1.73, EV about +0.18R to +0.25R
- recent max DD about 2.39R

Annual P/L for the strongest 74/75-trade variants remained mixed rather than uniformly positive. This is a research signal, not proof of a stable market edge.

### Cost stress — critical
Using the strongest E variant (0.8 pip spread / 0.1 pip slip baseline):

- 0.8 / 0.1: PF 1.286, recent PF 1.734, recent EV +0.248R
- 1.0 / 0.2: PF 1.150, recent PF 0.929, recent EV -0.031R
- 1.2 / 0.2: PF 1.144, recent PF 0.924, recent EV -0.033R
- 1.5 / 0.2: PF 1.027, recent PF 0.413, recent EV -0.308R

**Decision: E is promising but not production-ready.** It is sensitive to execution costs, especially in the recent validation period.

## Next engineering gate

1. Export every Strategy E candidate with only point-in-time features and a future outcome label.
2. Build an AI-filter dataset without lookahead/data leakage.
3. Compare Base E vs Base E + AI on the exact same candidate stream.
4. Require the AI filter to improve expectancy and cost robustness, not merely trade frequency.
5. Re-run rolling out-of-sample validation and stress tests before any live integration.

This file is the restart checkpoint: do not skip directly to live deployment.
