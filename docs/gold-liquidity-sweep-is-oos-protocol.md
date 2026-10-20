# GOLD liquidity-sweep research protocol

## Hypothesis
A completed M5 candle sweeps beyond a prior N-bar high/low by a minimum ATR distance, then closes back inside the range with a reversal-direction body and an extreme RSI reading. Entry is modeled at the next M5 open. This is countertrend range-rejection, not a breakout or EMA20 pullback strategy.

## Fixed variables and periods
- Prepared XAUUSD M5 data: 2021-10-06 through 2026-10-04, end boundary 2026-10-05 exclusive.
- IS: [2021-10-06 00:00 UTC, 2024-10-05 00:00 UTC).
- OOS: [2024-10-05 00:00 UTC, 2026-10-05 00:00 UTC).
- Baseline friction: spread 0.50 and slippage 0.05; stress friction at least 0.75 and 0.10.
- Fixed: close back inside by 0.05 ATR; BUY RSI <=40; SELL RSI >=60; close location >=0.60 BUY / <=0.40 SELL; stop 0.10 ATR beyond wick; stop 0.50–2.50 ATR; target 1.50R; UTC session 07:00–20:59.
- Candidate grid: lookback 12/24/36 bars × sweep penetration 0.05/0.10/0.20 ATR = 9.
- Entry/exit assumptions: next M5 open, stop-first on same-bar SL/TP collision, max 96 M5 bars, 0.25% risk.

## Frozen selection
Score all nine candidates on IS only. Among candidates with >=30 trades, select highest IS expectancy_R; tie-break by PF, lower max DD, higher n, then candidate ID. If none reaches 30 trades, the screen fails automatically. IS passes only with n>=30, PF>=1, expectancy_R>0, max DD<=10%.

Run exactly one candidate on OOS unchanged. Overall pass requires IS pass; OOS n>=30, PF>=1.10, expectancy_R>0, max DD<=10%; plus stress-cost OOS n>=15, PF>=1 and expectancy_R>=0. Research daily-loss/drawdown locks are disabled only to measure every qualifying trade in each window, not to change production gates. Any failed gate rejects this version. OOS must not be used for retuning.
