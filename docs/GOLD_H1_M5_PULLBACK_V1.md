# GOLD H1 Trend + M5 Pullback/Reconfirmation V1

## Version and safety boundary

- Strategy ID: `gold-h1-m5-pullback-v1`
- Endpoint: `POST /api/gold/pullback/signal`
- MT4 monitor: `mt4/GoldAITraderPullbackV1.mq4`
- The existing `/api/gold/signal` and `gold-m5-h1-v2` rules remain unchanged.
- V1 is research / forward-paper monitor only. Its response always has `order_allowed=false`; the EA defaults `AllowAutoOrders=false` and contains no order-send implementation.
- Performance is unproven until fixed-window IS/OOS and cost-sensitivity research completes.

## Frozen entry hypothesis

1. Use the last completed H1 candle only. BUY needs H1 close above EMA20, EMA20 > EMA50 > EMA200, and RSI14 in 50–72. SELL is mirrored with close below EMA20, EMA20 < EMA50 < EMA200, RSI14 in 28–50.
2. The prior completed M5 candle must cross the EMA20 touch band (default tolerance 0.15 ATR) and stay within 0.35 ATR of EMA20 on close in the counter-trend direction.
3. The latest completed M5 candle must confirm continuation: bullish close above the prior candle high and above M5 EMA20 for BUY; bearish close below the prior candle low and below M5 EMA20 for SELL. Directional M5 RSI ranges are 52–75 for BUY and 25–48 for SELL. Confirmation close-location limits are 0.60 / 0.40, and extension from EMA20 is capped at 1.50 ATR.
4. Stop is beyond the recent four-bar swing with 0.15 ATR buffer. Reject stops outside 0.80–2.00 M5 ATR. Initial take-profit is fixed at 2R.
5. Consecutive M5 bar close-times must differ by exactly 300 seconds, and the latest bar timestamp must match the request's UTC `bar_time`. Missing/invalid indicator data fails closed to WAIT.

## Parameters

The runtime defaults can be changed only for a new, explicitly versioned test after the current hypothesis has been frozen: `GOLD_PULLBACK_TOUCH_ATR`, `GOLD_PULLBACK_CLOSE_TOLERANCE_ATR`, `GOLD_PULLBACK_MAX_EXTENSION_ATR`, `GOLD_PULLBACK_STOP_BUFFER_ATR`, `GOLD_PULLBACK_MIN_STOP_ATR`, `GOLD_PULLBACK_MAX_STOP_ATR`, `GOLD_PULLBACK_TAKE_PROFIT_R`, direction-specific H1/M5 RSI settings, and `GOLD_PULLBACK_SESSION_START_UTC` / `GOLD_PULLBACK_SESSION_END_UTC`.

## Backtest and acceptance

Run with `GOLD_BACKTEST_STRATEGY_VARIANT=h1_m5_pullback_v1` against the prepared five-year XAUUSD M5 dataset. The dedicated workflow tests spread scenarios of 0.26, 0.30, 0.40, 0.50, 0.55, and 0.75 price units, with 0.05 slippage, and reports candidate/trade counts, PF, expectancy, net profit, max drawdown, three-year IS, two-year OOS, recent-year results, and drawdown-lock diagnostics.

Do not choose settings based on the OOS results and then present those same results as untouched validation. Revisions require a new strategy version and a fresh holdout. No profitability claim is implied by successful implementation or tests.
