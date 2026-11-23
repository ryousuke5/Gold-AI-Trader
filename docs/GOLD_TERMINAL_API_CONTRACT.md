# GOLD Terminal API Contract — MT4 / MT5

Status: draft contract for the monitor-only V19 adapter  
Contract identifier: gold-terminal-v1  
Scope: data collection, market-safety heartbeat, signal analysis request only

## Purpose

MT4 and MT5 use different terminal APIs, but they must send equivalent observations to the existing Render backend. This contract is the stable boundary between those platform-specific adapters and the shared Node.js strategy / risk services.

The contract does not add an execution API and does not authorize orders.

## Endpoints

| Endpoint | Purpose | Frequency |
|---|---|---|
| POST /api/gold/market-safety | Report current quote and local safety-gate state, even when signal generation is blocked | Every 15 seconds by default |
| POST /api/gold/signal | Submit one completed M5 candle and its M5/H1 features for deterministic strategy evaluation | Once per newly completed M5 bar |

Both endpoints require the X-Gold-API-Key header and Content-Type: application/json. Each POST should include a unique X-Request-Id.

## Signal request fields

Top level:
- symbol: broker symbol, e.g. GOLD# or XAUUSD
- timeframe: M5
- market_safety: local safety-gate snapshot
- features: quote, UTC conversion, M5 and H1 indicator data
- account: account / instrument capability snapshot

The recent_m5 and recent_h1 arrays are nested inside features, alongside the quote, M5 and H1 fields.

market_safety fields:
- allowed: boolean
- reason: string
- quote_time_utc: UTC Unix epoch seconds
- mid_price: positive number
- spread_price: non-negative price difference
- stable_tick_count: integer >= 0
- anomaly_active: boolean
- reopen_lock_until_utc: UTC Unix epoch seconds or 0

features fields:
- bid, ask, point, spread, spread_points
- server_utc_offset_seconds
- bar_time: completed M5 close time in UTC epoch seconds
- m5: ema20, ema50, rsi14, atr14, high20, low20
- h1: close, ema20, ema50, ema200, rsi14, atr14
- recent_m5: completed M5 bars, oldest-to-newest
- recent_h1: completed H1 bars, oldest-to-newest

Each recent bar contains:
- time: completed candle close time in UTC epoch seconds
- open, high, low, close, volume

account fields:
- equity, balance, open_positions
- daily_pnl_pct, drawdown_pct
- tick_size, tick_value, min_lot, max_lot, lot_step
- point, digits, stop_level_points, freeze_level_points, trade_allowed
- risk_data_ready: boolean

The current MT4 V19 adapter serializes up to 24 M5 bars and 24 H1 bars. Missing bars must not be invented or interpolated.

## Safety heartbeat fields

The heartbeat contains:
- symbol
- market_safety: same structure as the signal request
- features: bid, ask, point, spread
- ea_runtime: enable_signal_requests, run_ai_test_once, allow_auto_orders, timer_seconds, safety_heartbeat_seconds, flow_status, flow_reason, current_closed_m5_bar_open_utc, last_handled_m5_bar_open_utc, last_attempted_m5_bar_open_utc, last_attempt_at_utc

For this monitor-only contract, ea_runtime.allow_auto_orders must be false. A future trading adapter requires a separate contract, authorization, review and test plan.

## Timestamp rules

1. All wire timestamps are Unix epoch seconds in UTC.
2. M5 bar_time is the completed M5 candle close time: broker-server candle open + 300 seconds - broker-server UTC offset.
3. Each recent_m5[].time is that completed M5 candle's close time, using the same conversion.
4. Each recent_h1[].time is that completed H1 candle's close time: broker-server candle open + 3600 seconds - broker-server UTC offset.
5. Never include the forming candle.
6. Arrays are oldest-to-newest. If bars are missing, do not invent, interpolate or reorder data. Let the strategy/backend fail closed on insufficient or non-contiguous history.

MT5 must use CopyRates() and indicator handles / CopyBuffer() while reproducing these semantic rules; it must not copy MT4 shift/index assumptions blindly.

## Strategy and safety invariants

- Keep strategy_version=gold-m5-h1-v2 on the existing server configuration.
- Do not move V2 candidate generation into MQL5. The canonical strategy remains src/gold_strategy_v2.js.
- Do not change V2 thresholds as part of the adapter migration.
- Preserve the local market-safety gate and the API-side independent validation.
- On missing, stale or invalid quotes; bad UTC conversion; excessive spread; reopen lock; tick anomaly; missing indicator data; or invalid history, fail closed.
- Send the market-safety heartbeat independently of signal eligibility so the monitor continues to show a blocked state.
- Keep the MT4 and MT5 implementations monitor-only. Do not add MQL4 OrderSend or MQL5 CTrade order calls in this phase.

## Contract test helper

src/gold_terminal_contract.js validates captured payload objects without importing terminal-specific logic into the production server. It is intended for:
- fixtures captured from MT4 demo runs
- fixtures captured from MT5 demo runs
- comparing both adapters against the same required fields and types
- rejecting a heartbeat that attempts to set allow_auto_orders=true

Tests live in tests/gold_terminal_contract.test.js.

## Acceptance criteria before MT5 demo

1. Latest local V19 source is synchronized and its hash recorded.
2. Existing MT4 implementation is refactored without changing its request/heartbeat payload semantics.
3. MT4 and MT5 payload fixtures both pass the shared contract tests.
4. With identical input history, both adapters return identical closed-bar UTC timestamps and equivalent normalized M5/H1 data (within a documented floating-point / price-precision tolerance).
5. Tick-safety state transitions match: stale quote, wide spread, weekly reopen, jump detection, recovery samples, and restart persistence.
6. MetaEditor compiles both EAs without errors; warnings are reviewed.
7. FXTF MT5 demo confirms broker-specific symbol, tick size/value, volume minimum/step, spread and quote behavior.
8. Auto trading remains OFF. No production deployment or live order is part of this work.

## Current limitation

The latest source file used in the November 18 XM MT4 run has not yet been supplied as an .mq4 attachment or synchronized to GitHub. The audited GitHub file is an earlier V19 baseline (last modified November 3, 2026). Do not extract or replace the local EA until the current source is checked in and compared.
