# EURUSD AI-Free Forward Validation Runbook

## Purpose

This stage measures the deterministic EURUSD M15 technical strategy in real market conditions without allowing real orders.

Architecture:

MT4 EURUSDAIMonitor / EURUSDLiveTrader
→ /api/eurusd/signal
→ deterministic technical setup
→ deterministic Safety Gate
→ persistent forward paper trade
→ subsequent M15 bars settle SL/TP/max-hold
→ /api/eurusd/forward-status

AI is disabled during this stage. The AI environment filter is intentionally excluded so that its incremental value can be measured later rather than mixed into the first forward result.

## Trading state

Required production settings:

- EURUSD_AI_ENABLED=false
- EURUSD_AI_ENVIRONMENT_REQUIRED=false
- EURUSD_FORWARD_TEST_ENABLED=true
- EURUSD_EXECUTION_ENABLED=false
- EURUSD_LIVE_TRADING_APPROVED=false
- EURUSD_FORWARD_MAX_TRADES=1

The forward evaluator requires persistent Supabase access. It stores paper trades through the existing gold_orders table with mode=FORWARD_PAPER, and writes standardized results to gold_trade_results.

## Entry rules

A paper trade opens only when:

1. deterministic /api/eurusd/signal returns BUY or SELL
2. risk.approved=true
3. safety.newOrdersAllowed=true
4. there is no existing forward paper trade

The forward entry price is the same side-specific market price sent by MT4. Technical entry, stop, target and position sizing are not changed by the forward evaluator.

## Exit rules

For each subsequent completed M15 bar:

- BUY: if the bar low reaches stop, exit at stop. If stop and target are both touched in the same bar, assume stop first.
- BUY: otherwise if high reaches target, exit at target.
- SELL: mirror the same logic.
- If Safety Gate requests force-close, exit at the current side-specific market price.
- If holding time exceeds 3600 seconds, exit at the current side-specific market price and mark EXPIRED.

The SL-first same-bar rule is deliberately conservative because M15 OHLC does not reveal intrabar order of events.

## Metrics

The server reports:

- total signals/trades
- open/closed trades
- win rate
- net R
- profit factor
- expectancy R
- maximum drawdown R
- trades per week

The decision should be based on the fixed strategy version and a sufficiently long observation window, not on one or two trades.

## Promotion gate

Do not enable live execution based only on forward PF.

Minimum promotion sequence:

1. forward observation with AI disabled
2. verify Safety Gate behavior and feed freshness
3. verify no duplicate paper trades
4. verify SL/TP/hold-time accounting
5. compare forward results with the same deterministic backtest assumptions
6. only then run a separate AI-on A/B evaluation
7. only after both are stable consider a DEMO execution phase
8. live execution remains a separate approval step

The current target is validation quality, not trade frequency. EURUSD_TARGET_TRADES_PER_WEEK=1 is guidance only.

## Monitoring

GET /api/eurusd/forward-status returns the current paper portfolio and summary.

GET /api/eurusd/safety-status returns the cached high-impact event feed.

POST /api/eurusd/safety-check performs a current fail-closed safety evaluation using MT4 telemetry.

## Failure policy

Missing/stale news feed, invalid event payload, missing weekend-gap telemetry during the configured Monday window, or failed server safety checks must not create a new forward trade.

No real order should be executed in this stage.


## MT4 connection setup — 2026-10-08

Active Render service:
- URL: https://gold-ai-trader-1.onrender.com

For the AI-free forward stage, attach EURUSDAIMonitor.mq4 to an EURUSD M15 chart.

Required MT4 inputs:
- ApiBaseUrl = https://gold-ai-trader-1.onrender.com
- ApiKey = the same GOLD_API_KEY configured on Render
- EnableSignalRequests = true
- TimerSeconds = 5

The monitor submits one completed M15 bar per bar key and does not execute orders.

Do not enable the live executor for this stage. EURUSDLiveTrader.mq4 is retained for a later DEMO/live phase and its AllowAutoOrders default remains false.

MT4 must also allow WebRequest to:
- https://gold-ai-trader-1.onrender.com

Operational confirmation:
- Render service Gold-AI-Trader-1 is Live.
- Latest deployment contains commit f6de938cfc40960e6d5c79695a7d022e800475ab.
- No Render application errors were observed immediately after the deployment.
- EURUSDAIMonitor v1.2 performs a startup /health connectivity probe and immediately attempts the current completed M15 bar after a successful probe.\n- Forward status remains unverified until MT4 submits the first authenticated M15 request.
