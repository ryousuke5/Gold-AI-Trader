# GOLD H1 Trend + M5 Halfback V1

## Purpose and status

This is an isolated, deterministic **monitor / backtest-only** hypothesis. It is not a claim of profitability and does not replace GOLD V2 or the EMA20 pullback/reconfirmation V1. The strategy version is `gold-h1-m5-halfback-v1`.

## Frozen entry definition (initial research version)

1. **H1 direction:** BUY only when H1 close > EMA20 > EMA50 > EMA200 and H1 RSI(14) is 50–72. SELL is the exact inverse with RSI(14) 28–50.
2. **Impulse anchors:** locate a confirmed M5 swing low/high using two bars on the left and two completed bars on the right. A pivot is not used before its right-side confirmation bars close. Pair the most recent eligible pivots in trend direction; require a continuous M5 sequence, 5–40 bars between pivots, and an impulse of at least 1.5 × M5 ATR(14).
3. **Halfback zone:** the immediately prior completed M5 candle must retrace 45–55% of that impulse by its wick extreme. A deeper or shallower pullback is not a halfback setup.
4. **Continuation:** the latest completed M5 candle must close in the H1 trend direction beyond the preceding candle's extreme, with a minimum body of 0.25 × ATR and a strong close location (BUY >= 60%, SELL <= 40%).
5. **Risk geometry:** stop beyond the recent five-bar swing extreme with a 0.15 × ATR buffer. Reject stop distances outside 0.5–2.5 × ATR. Initial target is 2R. The backtest enters at the next M5 bar open and applies configured spread/slippage.
6. **Session:** 07:00–20:00 UTC. This parameter and all thresholds must be frozen before inspecting OOS results.

## Look-ahead and comparison safeguards

- Only completed bars are supplied to the setup function. Pivot detection requires completed right-side bars, and no future candles are read.
- An opportunity that has already moved past the 45–55% zone before reconfirmation is skipped rather than filled retrospectively.
- Use the same prepared XAUUSD M5 dataset, H1 aggregation, broker-cost assumptions, trade simulator, and fixed IS/OOS dates for comparisons with GOLD V2 and EMA20 pullback V1.
- Treat the 45–55% band as a testable hypothesis, not as evidence that a Fibonacci level has predictive power.

## Monitor-only interface

- Endpoint: `POST /api/gold/halfback/signal`
- MT4 bridge: `mt4/GoldAITraderHalfbackV1.mq4`
- Strategy replies explicitly set `order_allowed=false`, `risk_approved=false`, `persisted=false`, and `orders_executed=false`. The bridge contains no `OrderSend` or `OrderClose` calls.
- No Render deployment, production configuration change, database persistence, or live-order capability is included.

## Backtest

Use the main project script with `GOLD_BACKTEST_STRATEGY_VARIANT=halfback_v1`. It reports baseline and conservative cost scenarios plus trade count, PF, expectancy, drawdown, annual results, and the existing 3-year / 2-year summaries. Fix the data end date and preserve the artifact before comparing results. The end date must remain the same across compared strategy versions.

Example (with a fixed end date):
```bash
GOLD_BACKTEST_STRATEGY_VARIANT=halfback_v1 GOLD_BACKTEST_END_UTC=2026-10-05T23:59:59Z GOLD_BACKTEST_LOOKBACK_DAYS=1825 node scripts/backtest-gold-v2.mjs
```

Do not promote or tune the strategy based on the full-sample summary alone. Freeze all parameters using IS, then inspect OOS once, include conservative transaction costs, and require sufficient trades plus PF, expectancy, and maximum drawdown evidence before even considering paper validation.
