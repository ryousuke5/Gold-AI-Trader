# GOLD Macro Regime V1 — Pre-registered Research

## Purpose
Test one falsifiable, macro-driven hypothesis as an independent research line. This is not a replacement for GOLD V2/V19 and is not eligible for live execution.

## Hypothesis
When the Federal Reserve Board's nominal broad U.S. dollar index and the 10-year TIPS real yield both fall materially over the latest five published observations, the next eligible XAUUSD UTC session is biased upward. When both rise materially, the bias is downward. Mixed or stale macro conditions produce no trade.

The dollar series is FRED **DTWEXBGS**, not the ICE U.S. Dollar Index. The real-yield series is FRED **DFII10**.

Sources:
- DTWEXBGS: https://fred.stlouisfed.org/series/DTWEXBGS
- DFII10: https://fred.stlouisfed.org/series/DFII10

## Frozen signal rules
- Lookback: exactly five available daily macro observations.
- USD threshold: at least 0.25% absolute change over those observations.
- Real-yield threshold: at least 5 basis points absolute change over those observations.
- BUY: both changes are at or below their negative thresholds.
- SELL: both changes are at or above their positive thresholds.
- Otherwise: WAIT.
- Use only macro observations whose observation date is strictly before the XAUUSD UTC trade date. The most recent macro value must be no more than four calendar days old.
- No parameter search or optimization is part of V1.

## Gold execution proxy
- Input: Dukascopy M1 BID data aggregated to M5.
- Include only full UTC sessions beginning at 00:00, with at least 240 M5 bars and no intraday data gap above 70 minutes.
- Enter at the first eligible session's 00:00 M5 BID open.
- Exit at the last available M5 BID close in that session.
- At most one position per eligible session.
- Long: pay spread plus entry slippage, then exit at BID less exit slippage.
- Short: enter at BID less entry slippage, then exit at ASK (BID plus spread and exit slippage).

## Frozen cost scenarios
| Scenario | Spread | Slippage per side | Estimated round-trip price cost |
|---|---:|---:|---:|
| Baseline | 0.50 | 0.05 | 0.60 |
| Conservative | 0.75 | 0.10 | 0.95 |
| Stress | 1.00 | 0.15 | 1.30 |

These are static XAUUSD price-unit assumptions, not measured XM spreads. A later execution study must use broker-specific historical/forward spread and commission data.

## Evaluation periods
- IS: 2021-10-06 through 2024-10-04 (end-exclusive 2024-10-05).
- OOS: 2024-10-05 through 2026-10-04 (end-exclusive 2026-10-05).
- The OOS is not used to change V1 rules.

## Evidence gate
V1 advances only if all of the following pass:
- At least 100 executed trades in IS and 50 in OOS under conservative costs.
- Net expectancy is positive in IS and OOS under both baseline and conservative costs.
- Conservative-cost PF is at least 1.15 in both IS and OOS.
- The 95% circular block-bootstrap confidence interval (5 consecutive eligible trading sessions per block) for conservative-cost mean net PnL per trade has a lower bound above zero in both IS and OOS.
- At least two OOS calendar years have positive conservative-cost net PnL.

Failure means reject or design a genuinely new hypothesis; do not tune V1 using the OOS results.

## Limitations and promotion
This V1 is a daily-direction event study, not a complete strategy: it has no protective stop, position sizing, financing/swap model, or broker-specific execution model. A pass only permits a separate stop/exit, sizing, and XM cost-validation study. It never enables demo or live orders automatically. GOLD V2, MT5 V19, Render production settings, and all order gates remain unchanged.
