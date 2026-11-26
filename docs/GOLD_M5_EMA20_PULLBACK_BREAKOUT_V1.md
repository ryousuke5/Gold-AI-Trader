# GOLD M5 EMA20 Pullback Breakout V1

Status: research-only candidate. Not approved for live trading.

## Hypothesis

In a completed H1 uptrend, an M5 pullback toward EMA20 may resume upward.
A BUY candidate is emitted only when a later completed M5 candle closes above
the highest high of the preceding three completed M5 candles.

This is a BUY-only hypothesis. It is deliberately separate from GOLD V2,
Halfback V1, and Halfback V2. It does not change their conditions.

## Fixed signal rules

All candles used by the signal must already be closed.

1. H1 trend: latest completed H1 close > H1 EMA20 > EMA50 > EMA200.
2. M5 EMA20 slope: current completed M5 EMA20 > its value three completed M5
   bars earlier.
3. Pullback: at least one of the previous five completed M5 candles must touch
   the EMA20 zone. Its low may be at most 0.10 ATR above EMA20 or 0.50 ATR
   below EMA20. Its close must not be more than 0.25 ATR below EMA20.
4. Structure: after the selected (most recent) EMA20 touch and before the signal
   candle, no completed M5 candle may close more than 0.25 ATR below its EMA20.
5. Breakout: the signal candle must be bullish, have body >= 0.20 ATR, close in
   the upper 35% of its range, and close strictly above the highest high of the
   preceding three completed M5 candles.
6. Extension: signal close must be above EMA20 and no more than 1.00 ATR above it.
7. Session: signal-bar close time must be UTC 07:00 through 20:59.
8. Stop: lowest low from the selected pullback-touch candle through the signal
   candle, minus 0.15 ATR.
9. Stop width: 0.40 to 2.00 ATR, inclusive.
10. Target: fixed 2.00R.
11. Entry model: the shared backtester enters at the next M5 bar open and applies
    spread/slippage by trade side. Same-bar stop/target conflicts use stop first.

## Fixed IS screen

- Data: Dukascopy XAUUSD M1 BID archive bars are resampled to complete M5 bars
  in UTC. Incomplete M5 groups and inactive zero-volume flat placeholders are
  removed by the existing preparation pipeline. H1 bars are aggregated from M5
  by the shared backtester.
- Requested data window: 1,825 days ending 2026-10-05 23:59:59 UTC.
- Evaluation: the shared IS-only split excludes the final 730 days before
  generating indicators/signals. OOS prices are not used for signal generation.
- Initial equity: 100,000.
- Risk per trade: 0.25%.
- Baseline cost: spread 0.50 + slippage 0.05.
- Conservative cost: spread at least 0.75 + slippage at least 0.10.
- Daily loss limit: 2%; maximum drawdown lock: 5%; maximum hold: 96 M5 bars.
- Research direction filter: BUY.
- The EMA20 setup consumes a seven-bar rolling M5 context, sufficient for its fixed five-bar pullback, three-bar breakout, and three-bar EMA20-slope rules; this does not alter signal criteria.

The existing IS candidate gate is unchanged: at least 20 trades, PF >= 1.10,
expectancy >= +0.05R, max drawdown <= 5%, and at least two calendar years with
15 or more trades and positive net R.

## Non-goals and safety

- No SELL logic.
- No AI/fundamental filter; historical point-in-time AI outputs are unavailable.
- No changes to GOLD V2, Halfback V1/V2, MT5 EA, Render service, or live settings.
- No order execution is implemented by this module.
- Passing the IS gate is only permission to review a frozen OOS test; it is not
  approval for forward/live deployment.
