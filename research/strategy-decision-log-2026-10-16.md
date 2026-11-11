# GOLD AI Trader — strategy research decision log

**Date:** 2026-10-16  
**Scope:** research-only; production configuration, Render deployment, merge, and live order activation have not been changed.

## Decision

**Reject every tested candidate for now. Do not loosen thresholds or select a direction/year after seeing the results.** Three distinct M15 hypotheses are negative after modeled costs. M5 V2 is too sparse and loses in the recent 730-day slice; M5 V3 opening-range has negative expectancy and material drawdown. The three-session XM M1 pilot is far too small to select or tune from, but its preliminary expectancy was negative.

## Recent standardized M15 comparisons

| Hypothesis | Window | Cost | Trades | PF | Expectancy (R) | Max DD % | Gate |
|---|---|---|---:|---:|---:|---:|---|
| Trend pullback / re-entry | five_year | baseline | 281 | 0.680 | -0.140 | 11.688 | FAIL |
| Trend pullback / re-entry | recent_730d | baseline | 119 | 0.712 | -0.137 | 5.932 | FAIL |
| Trend pullback / re-entry | five_year | conservative | 269 | 0.655 | -0.150 | 11.353 | FAIL |
| Trend pullback / re-entry | recent_730d | conservative | 119 | 0.683 | -0.154 | 6.263 | FAIL |
| Breakout → retest | five_year | baseline | 113 | 0.689 | -0.143 | 4.287 | FAIL |
| Breakout → retest | recent_730d | baseline | 54 | 0.582 | -0.207 | 3.087 | FAIL |
| Breakout → retest | five_year | conservative | 110 | 0.576 | -0.201 | 5.556 | FAIL |
| Breakout → retest | recent_730d | conservative | 54 | 0.555 | -0.222 | 3.108 | FAIL |
| Range mean reversion | five_year | baseline | 56 | 0.505 | -0.238 | 4.556 | FAIL |
| Range mean reversion | recent_730d | baseline | 35 | 0.686 | -0.132 | 2.443 | FAIL |
| Range mean reversion | five_year | conservative | 52 | 0.474 | -0.260 | 4.547 | FAIL |
| Range mean reversion | recent_730d | conservative | 34 | 0.663 | -0.147 | 2.482 | FAIL |

## Attribution: where losses came from

### H1 trend + M15 pullback/re-entry

- Five-year baseline: 281 trades, PF 0.680, expectancy −0.140R, maximum drawdown 11.69%. Recent 730-day baseline: 119 trades, PF 0.712, expectancy −0.137R, maximum drawdown 5.93%.
- Five-year baseline exits: 102 stop exits averaging −1.007R; 24 target exits averaging +1.567R; 152 time exits averaging +0.171R; 3 gap-open exits averaging −0.062R.
- Both BUY and SELL were negative: BUY 154 trades, expectancy −0.121R; SELL 127, expectancy −0.163R. There is no defensible long-only/short-only candidate in this sample.

### H1 trend + M15 breakout/retest

- Five-year baseline: 113 trades, PF 0.689, expectancy −0.143R. Recent 730-day: 54 trades, PF 0.582, expectancy −0.207R.
- Long entries were materially negative (79 trades, expectancy −0.200R); the 34 short trades averaged −0.010R over five years. The recent 12-short-trade subset was also negative. This does not justify deploying short-only.
- Five-year baseline exits: 43 stops, expectancy −1.010R; 10 targets, +1.521R; 60 time exits, +0.201R. Stop losses dominate.

### H1 range regime + M15 Bollinger re-entry

- Five-year baseline: 56 trades, PF 0.505, expectancy −0.238R. Recent 730-day: only 35 trades, PF 0.686, expectancy −0.132R.
- BUY and SELL both negative. Targets averaged +1.062R but there were 24 stop exits averaging −1.007R, plus 22 time exits near breakeven (+0.009R). It is too sparse and unprofitable.

## Why not optimize now?

The candidates were tested on the same underlying historical source, and the recent 730-day slice has already been inspected across variants. Repeatedly changing EMA, RSI, band, target, or session thresholds until the historical PF rises would increase selection bias rather than demonstrate an edge. The full history is Dukascopy BID OHLC, not five years of XM bid/ask ticks; costs are modeled from limited recent XM quote observations.

## Next work before creating another strategy

1. Freeze these three candidates as rejected; retain scripts and artifacts for reproducibility, but do not connect them to order execution.
2. Audit the shared fill/cost model against MT4/XM contract details: symbol digits/point, lot-size contract, tick value/tick size, stop level, swap/commission, Ask/Bid entry and exit, spread at signal/exit, and gap/rollover behavior.
3. Collect a longer forward sample of XM bid/ask quotes and demo/paper signals before using a strategy score as an adoption decision. Do not treat the three-day quote sample as a long-run spread distribution.
4. For any future hypothesis, write rules and a pass/fail threshold before running it; hold back an untouched date range and only run it once after rule freeze. Require baseline and conservative-cost profitability, enough trades, limited drawdown, and forward paper replication.
5. Keep the dashboard status as “判定エンジン稼働中 / 実売買OFF.” No live activation unless an independently held-out and forward test passes.

## Reproducibility / known limitations

- M15 trend-pullback, breakout-retest, and range-reversion results were produced by workflow run 38911457965 and their artifacts are retained for 30 days.
- Base history: validated 2021-10-06 through 2026-10-04 UTC, Dukascopy BID M5 OHLC. Historical XM Ask and spreads are not present.
- A recent 730-day run resets equity/trade state but still uses the same source period and is not a pristine out-of-sample holdout.
- Research metrics are not a promise of future performance and are not permission to trade live.
