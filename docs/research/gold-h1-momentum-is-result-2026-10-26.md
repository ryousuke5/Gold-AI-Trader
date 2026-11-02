# GOLD H1 Momentum Persistence — IS Result (2026-10-26)

**Decision: REJECT THIS VERSION. No candidate passed IS. OOS was deliberately not run.**

## Data and protocol

- Data: Dukascopy XAUUSD M5 BID, 354,305 M5 rows, 29,495 complete H1 bars, nominal UTC range [2021-10-06, 2026-10-05). This is a proxy feed, not XM GOLD# broker-native five-year Bid/Ask history.
- IS: [2021-10-06, 2024-10-06) UTC.
- OOS: [2024-10-06, 2026-10-05) UTC. Not opened because all nine candidates failed the pre-registered IS gate.
- Signal: M = (Close[t] - Close[t-N]) / (ATR14_H1 * sqrt(N)); N = 4, 8, 12; threshold = 0.75, 1.00, 1.25.
- Baseline costs: spread 0.30 price units, slippage 0.05 each side. Conservative costs: spread 0.55, slippage 0.10 each side.
- Common exit: next complete H1 open, 1.5 ATR stop, 2R target, maximum 8 H1 bars, one position at a time; M5 stop-first barrier simulation.
- Fees, swaps/financing and actual demo slippage are not fully represented.

## IS candidate scores

PF = gross profit / gross loss. Expectancy, net and maximum drawdown are measured in R units; maxDD is peak-to-trough cumulative trade R, not account-percent drawdown.

| Candidate | Base n | Base PF | Base E (R) | Base DD (R) | Conservative n | Conservative PF | Conservative E (R) | Conservative DD (R) | Positive annual blocks | IS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| MOM_H1_N4_T0.75 | 1251 | 0.953 | -0.022 | 44.89 | 1254 | 0.840 | -0.081 | 104.04 | 1/3 | FAIL |
| MOM_H1_N4_T1.00 | 816 | 0.884 | -0.055 | 48.16 | 815 | 0.784 | -0.110 | 89.26 | 0/3 | FAIL |
| MOM_H1_N4_T1.25 | 506 | 0.771 | -0.110 | 58.08 | 506 | 0.687 | -0.160 | 80.83 | 0/3 | FAIL |
| MOM_H1_N8_T0.75 | 942 | 0.831 | -0.084 | 84.64 | 951 | 0.744 | -0.134 | 127.93 | 0/3 | FAIL |
| MOM_H1_N8_T1.00 | 566 | 0.837 | -0.078 | 56.74 | 565 | 0.725 | -0.140 | 84.50 | 0/3 | FAIL |
| MOM_H1_N8_T1.25 | 307 | 0.764 | -0.116 | 43.84 | 309 | 0.693 | -0.158 | 55.35 | 1/3 | FAIL |
| MOM_H1_N12_T0.75 | 700 | 0.779 | -0.112 | 92.91 | 704 | 0.711 | -0.152 | 118.12 | 0/3 | FAIL |
| MOM_H1_N12_T1.00 | 381 | 0.831 | -0.081 | 38.09 | 379 | 0.740 | -0.133 | 55.21 | 1/3 | FAIL |
| MOM_H1_N12_T1.25 | 197 | 0.924 | -0.035 | 17.59 | 196 | 0.864 | -0.065 | 22.06 | 2/3 | FAIL |

## Result interpretation

- 0 of 9 candidates passed the pre-registered IS gates, so OOS was not run. The workflow intentionally avoids evaluating OOS when IS is unsuccessful.
- The closest candidate, N=12 and threshold 1.25, still had baseline PF 0.924 and expectancy -0.035R; conservative PF was 0.864 and expectancy -0.065R. It failed the profitability and conservative-cost gates despite lower drawdown than other candidates.
- We are not changing the thresholds to rescue this version or using OOS to tune it.

## Safety

Research only. No production EA routing, Render settings, Supabase state, or live-order gate was changed. Real trading remains OFF. Even a future passing proxy-data test would require XM-native data reconciliation, a longer quote/spread sample, demo fill-slippage measurements, and commission/swap analysis before any promotion.

Code and protocol are in this research PR: https://github.com/ryousuke5/Gold-AI-Trader/pull/68
