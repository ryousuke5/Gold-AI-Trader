# GOLD Forward/Paper Shadow Telemetry v2

Status: research-only implementation on `research/gold-forward-loss-telemetry-20261114`.

## Purpose

Capture the context and price path of virtual GOLD trades so the pre-registered H1-trend and M5-first-move hypotheses can be tested on prospective Forward/Paper observations.

This is an observation pipeline only. It does not select a strategy, approve risk, change SL/TP, create an order, or call `OrderSend`. Do not merge or deploy this branch as part of this task.

## Safety boundaries

- Production remains on `GOLD V2 Strict`.
- Runtime remains `ANALYSIS`; `auto_trading_enabled=false`; the real-order gate and V19 `AllowAutoOrders` remain OFF.
- Events describe virtual/shadow entries, not live broker orders.
- H1 metrics use completed H1 candles only. M5 path metrics require completed BID and ASK M5 OHLC derived from ticks.
- BUY entries and exits use ASK and BID respectively; SELL entries and exits use BID and ASK respectively.
- Strategy SL/TP triggers remain BID logical levels for both directions.
- R is the executable entry-fill to expected executable stop-fill distance. Raw BID stop geometry is recorded separately.
- The +0.25R / -0.50R early-path labels are fixed in telemetry v2 and are never used to manage a position.
- If the same candle reaches both thresholds, or both SL and TP, label the sequence ambiguous. Do not guess intrabar order from OHLC alone.
- DATA_GAP is a separate event and must not be converted to a win or loss.

## Event storage and API

Apply `supabase/migrations/202611140001_gold_forward_shadow_events.sql` to the intended Supabase project before enabling this API in any deployed service. The endpoint is:

`POST /api/gold/forward-shadow/event`

It uses the existing `x-gold-api-key` authentication middleware. Persisted rows are append-only observations keyed by `event_key`; repeated ENTRY, BAR, GAP, or EXIT posts with the same key are idempotent no-ops.

### ENTRY

Send one ENTRY event when a research strategy creates a virtual entry. Define virtual entry consistently before collecting data: for example, the first executable quote after the completed signal bar, using Ask for BUY and Bid for SELL. Do not mix signal-close fills and next-quote fills in one dataset.

```json
{
  "event_type": "ENTRY",
  "entry_id": "paper-gold-v2-20261114-070500-buy",
  "symbol": "GOLD#",
  "strategy_version": "gold-m5-h1-v2",
  "side": "BUY",
  "features": {
    "bar_time": 1794639300,
    "recent_h1": [
      { "time": 1794625200, "open": 2495.0, "high": 2500.0, "low": 2493.0, "close": 2499.0, "ema20": 2497.0, "ema50": 2496.0, "ema200": 2494.0, "atr14": 8.0 },
      { "time": 1794628800, "open": 2499.0, "high": 2504.0, "low": 2497.0, "close": 2503.0, "ema20": 2499.0, "ema50": 2497.0, "ema200": 2494.5, "atr14": 8.0 },
      { "time": 1794632400, "open": 2503.0, "high": 2506.0, "low": 2500.0, "close": 2505.0, "ema20": 2501.0, "ema50": 2498.0, "ema200": 2495.0, "atr14": 8.0 },
      { "time": 1794636000, "open": 2505.0, "high": 2508.0, "low": 2502.0, "close": 2507.0, "ema20": 2503.0, "ema50": 2499.0, "ema200": 2495.5, "atr14": 8.0 }
    ]
  },
  "payload": {
    "signal_time_utc": "2026-11-14T07:00:00.000Z",
    "entry_time_utc": "2026-11-14T07:00:03.000Z",
    "expected_entry_price": 2500.28,
    "entry_price": 2500.32,
    "signal_reference_bid": 2500.15,
    "stop_price": 2498.30,
    "target_price": 2504.30,
    "expected_stop_fill_price": 2498.25,
    "expected_stop_spread_price": 0.00,
    "expected_stop_slippage_price": 0.05,
    "cost_model_version": "XM_KIWAMI_BID_ASK_SLIPPAGE_V1",
    "entry_bid": 2500.20,
    "entry_ask": 2500.30,
    "spread_price": 0.10,
    "quote_age_seconds": 0,
    "setup_diagnostics": {},
    "market_safety": {}
  }
}
```

The ENTRY fill price is executable-side: BUY uses Ask; SELL uses Bid. `signal_reference_bid`, `stop_price`, and `target_price` are BID-chart values. The server checks that `spread_price` equals `entry_ask - entry_bid`. The caller supplies the expected stop-side fill and the frozen cost model inputs: for BUY, `expected_stop_fill_price = stop_price - expected_stop_slippage_price`; for SELL, `expected_stop_fill_price = stop_price + expected_stop_spread_price + expected_stop_slippage_price`. All expected costs must be nonnegative and the expected stop fill must be on the loss side of the entry. The server calculates `effective_risk_distance_price = abs(entry_price - expected_stop_fill_price)`. It separately calculates `raw_stop_distance_bid = abs(signal_reference_bid - stop_price)`. Never use the raw BID distance as the R denominator. `entry_slippage_price_signed` is reconstructed from the actual executable entry price and the observed entry quote. `cost_model_version` is mandatory so different cost conventions cannot be mixed.\n\nThe server calculates and saves entry-time H1 context from `features.recent_h1` (or `recentH1`). Each H1 row must be a completed candle and include its open timestamp, close, EMA20, EMA50, EMA200, and ATR14. H1 EMA20 slope is reported over 1 and 3 completed bars, normalized by H1 ATR; EMA alignment age is the consecutive aligned-bar count at entry.

If there are fewer than four contiguous completed H1 bars, telemetry records an explicit insufficient-history or H1-gap quality status. It does not substitute the current, possibly unfinished H1 candle.

### BAR

Send one BAR event for each completed M5 candle after the virtual entry. Include all bars, not only the 3rd and 6th. The stored sequence is later used to reconstruct cumulative MFE/MAE, close progress in R, first +0.25R / -0.50R threshold, and 3-bar/6-bar snapshots.

```json
{
  "event_type": "BAR",
  "entry_id": "paper-gold-v2-20261114-070500-buy",
  "symbol": "GOLD#",
  "strategy_version": "gold-m5-h1-v2",
  "side": "BUY",
  "payload": {
    "bars_since_entry": 1,
    "bar_time_utc": "2026-11-14T07:05:00.000Z",
    "bid_ohlc": { "open": 2500.30, "high": 2501.10, "low": 2499.80, "close": 2500.90 },
    "ask_ohlc": { "open": 2500.40, "high": 2501.25, "low": 2499.90, "close": 2501.02 },
    "spread_price": 0.12,
    "quote_age_seconds": 1,
    "tick_data_quality": "BID_ASK_TICK_AGGREGATED"
  }
}
```

M5 candle times must be ascending and must not be replaced by repeated candles. Both `bid_ohlc` and `ask_ohlc` are mandatory; the server rejects one-sided bars. They must be independently aggregated from Bid and Ask tick streams. Do not synthesize Ask OHLC by adding one fixed spread to Bid OHLC: the spread varies and Bid/Ask extrema may occur at different ticks. BUY MFE/MAE uses BID exit OHLC; SELL MFE/MAE uses ASK exit OHLC. Logical stop/target touches use BID OHLC for both sides. A gap in timestamps is measured in the analysis layer and must also be sent as GAP when the disconnect / missing-data interval is known.

### GAP

```json
{
  "event_type": "GAP",
  "entry_id": "paper-gold-v2-20261114-070500-buy",
  "symbol": "GOLD#",
  "strategy_version": "gold-m5-h1-v2",
  "side": "BUY",
  "payload": {
    "from_time_utc": "2026-11-14T07:10:00.000Z",
    "to_time_utc": "2026-11-14T07:25:00.000Z",
    "gap_seconds": 900,
    "reason": "mt4_disconnected"
  }
}
```

### EXIT

Send EXIT once the virtual position is resolved. `exit_price` is the actual executable close fill: BUY closes on BID; SELL closes on ASK. Submit both exit quotes and a spread matching `exit_ask - exit_bid`; the server records the quote side and reconstructs signed adverse slippage (positive means adverse). Net R must use the ENTRY event's `effective_risk_distance_price` and include the same cost convention, commission and swap; retain gross R separately where available.

```json
{
  "event_type": "EXIT",
  "entry_id": "paper-gold-v2-20261114-070500-buy",
  "symbol": "GOLD#",
  "strategy_version": "gold-m5-h1-v2",
  "side": "BUY",
  "payload": {
    "exit_time_utc": "2026-11-14T07:35:00.000Z",
    "exit_price": 2498.28,
    "exit_bid": 2498.30,
    "exit_ask": 2498.42,
    "exit_reason": "STOP",
    "gross_r": -1.0,
    "net_r": -1.06,
    "holding_seconds": 2100,
    "exit_spread_price": 0.12,
    "commission_account_currency": 0,
    "swap_account_currency": 0,
    "data_gap_seconds": 0
  }
}
```

## M5 path metric calculation

The pure helper `buildGoldForwardPathMetrics` consumes a chronologically ordered list of completed Bid/Ask OHLC candles, executable virtual entry fill, BID logical stop/target, expected executable stop fill, and effective risk distance. Each bar must be explicitly tagged `BID_ASK_TICK_AGGREGATED`; missing ASK bars or unverified one-sided OHLC are rejected. It returns:

- Cumulative MFE_R and MAE_R after every bar.
- Close progress in R after each bar.
- The first observed +0.25R favourable or -0.50R adverse threshold.
- An explicit `AMBIGUOUS_SAME_BAR` label when both thresholds occur within one candle.
- 3-bar (15-minute) and 6-bar (30-minute) snapshots.
- Missing-bar count and maximum gap duration.
- An ambiguous SL/TP label when both barriers fall inside the same OHLC candle.

This OHLC method cannot determine intrabar sequence. If a candle reaches both a threshold or both BID stop and target, keep the ambiguity label; do not choose a sequence from OHLC. Tick-aggregated Ask/Bid bars provide quote-side extrema, but they still do not reveal the order in which extrema occurred. Preserve raw tick ordering separately when available.

## Current implementation boundary / EA handoff

The repository copy used for this branch contains the Node.js API and research strategy modules, but no GOLD V19 MQL4 source file was located. Therefore this commit adds the API, data table migration, validation, metrics, and tests; it does not claim that MT4 is already sending these events.

Before any Forward/Paper observation starts, the EA integration must:
1. Generate a stable `entry_id` per virtual setup and submit ENTRY once.
2. Include only completed H1 bars in `recent_h1`, with EMA20/50/200 and ATR14 calculated at each bar close.
3. Submit every completed M5 candle as BAR, preserving UTC candle-open time and independently tick-aggregated Bid OHLC and Ask OHLC.
4. Submit GAP on disconnect or missing history and EXIT when the virtual position resolves.
5. Record actual XM Bid/Ask, virtual executable entry fill, expected stop spread/slippage, actual entry spread, and a frozen `cost_model_version`. Calculate R from the actual entry fill to expected executable stop fill; also store raw BID stop geometry.
6. Never call OrderSend from this telemetry path and never use the telemetry response to authorize orders.

## Validation and activation order

1. Run `npm test` on this research branch.
2. Apply the SQL migration only to the intended test / research Supabase project.
3. Exercise ENTRY/BAR/GAP/EXIT with synthetic events; verify duplicate posts do not create duplicate rows.
4. Verify the dashboard / query can reconstruct one complete path and flags missing bars.
5. Only then wire the MT4 EA to this endpoint in Forward/Paper monitor-only mode.
6. Keep the telemetry collecting until the pre-registered comparison groups have enough completed observations. Small samples remain `UNDETERMINED`.

Do not modify GOLD V2 Strict filters, stop/target logic, risk percentage, session window, spread cap, runtime mode, auto-trading, or V19 order permission as part of this research.
