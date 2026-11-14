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

It uses the existing `x-gold-api-key` authentication middleware. The MT4 research EA has `EnableForwardShadowTelemetry=false` by default and requires a separate HTTPS research host (`ForwardShadowApiBaseUrl`) and a separate key (`ForwardShadowApiKey`). Its initialization guard refuses to use the same host or key as the production signal API. The production endpoint must not be used for this branch. Persisted rows are append-only observations keyed by `event_key`; repeated ENTRY, BAR, GAP, or EXIT posts with the same key are idempotent no-ops.

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
    "bar_time": 1794639600,
    "recent_h1": [
      { "time": 1794628800, "open": 2495.0, "high": 2500.0, "low": 2493.0, "close": 2499.0, "ema20": 2497.0, "ema50": 2496.0, "ema200": 2494.0, "atr14": 8.0 },
      { "time": 1794632400, "open": 2499.0, "high": 2504.0, "low": 2497.0, "close": 2503.0, "ema20": 2499.0, "ema50": 2497.0, "ema200": 2494.5, "atr14": 8.0 },
      { "time": 1794636000, "open": 2503.0, "high": 2506.0, "low": 2500.0, "close": 2505.0, "ema20": 2501.0, "ema50": 2498.0, "ema200": 2495.0, "atr14": 8.0 },
      { "time": 1794639600, "open": 2505.0, "high": 2508.0, "low": 2502.0, "close": 2507.0, "ema20": 2503.0, "ema50": 2499.0, "ema200": 2495.5, "atr14": 8.0 }
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

The ENTRY fill price is executable-side: BUY uses Ask; SELL uses Bid. `signal_reference_bid`, `stop_price`, and `target_price` are BID-chart values. The server checks that `spread_price` equals `entry_ask - entry_bid`. The caller supplies the expected stop-side fill and the frozen cost model inputs: for BUY, `expected_stop_fill_price = stop_price - expected_stop_slippage_price`; for SELL, `expected_stop_fill_price = stop_price + expected_stop_spread_price + expected_stop_slippage_price`. All expected costs must be nonnegative and the expected stop fill must be on the loss side of the entry. The server calculates `effective_risk_distance_price = abs(entry_price - expected_stop_fill_price)`. It separately calculates `raw_stop_distance_bid = abs(signal_reference_bid - stop_price)`. Never use the raw BID distance as the R denominator. `entry_slippage_price_signed` is reconstructed from the actual executable entry price and the observed entry quote. `cost_model_version` is mandatory so different cost conventions cannot be mixed.

The server calculates and saves entry-time H1 context from `features.recent_h1` (or `recentH1`). Each H1 row must be a completed candle and include its UTC candle-close timestamp, close, EMA20, EMA50, EMA200, and ATR14. H1 EMA20 slope is reported over 1 and 3 completed bars, normalized by H1 ATR; EMA alignment age is the consecutive aligned-bar count at entry.

If there are fewer than four contiguous completed H1 bars, telemetry records an explicit insufficient-history or H1-gap quality status. It does not substitute the current, possibly unfinished H1 candle.

### BAR

Send one BAR event for each completed M5 candle after the virtual entry. Include all bars, not only the 3rd and 6th. The first interval after entry may be shorter than five minutes; mark it `is_partial: true` and report the observed `bar_duration_seconds`. A final intra-candle stop/target exit is also sent as a partial BAR before EXIT. Normal completed bars use `is_partial: false` and 300 seconds. The stored sequence is later used to reconstruct cumulative MFE/MAE, close progress in R, first +0.25R / -0.50R threshold, 3-/6-segment snapshots, and the first observations at or after 15/30 elapsed minutes.

```json
{
  "event_type": "BAR",
  "entry_id": "paper-gold-v2-20261114-070500-buy",
  "symbol": "GOLD#",
  "strategy_version": "gold-m5-h1-v2",
  "side": "BUY",
  "payload": {
    "segments_since_entry": 1,
    "bar_time_utc": "2026-11-14T07:05:00.000Z",
    "is_partial": true,
    "bar_duration_seconds": 297,
    "bid_ohlc": { "open": 2500.30, "high": 2501.10, "low": 2499.80, "close": 2500.90 },
    "ask_ohlc": { "open": 2500.40, "high": 2501.25, "low": 2499.90, "close": 2501.02 },
    "spread_price": 0.12,
    "quote_age_seconds": 1,
    "tick_data_quality": "BID_ASK_TICK_AGGREGATED"
  }
}
```

V19 sends candle-close timestamps in UTC (`bar_time` and each recent bar `time`), not candle-open timestamps. `signal_time_utc` must match the completed M5 `features.bar_time`. M5 candle times must be ascending and must not be replaced by repeated candles. Both `bid_ohlc` and `ask_ohlc` are mandatory; the server rejects one-sided bars. They must be independently aggregated from Bid and Ask tick streams. Do not synthesize Ask OHLC by adding one fixed spread to Bid OHLC: the spread varies and Bid/Ask extrema may occur at different ticks. BUY MFE/MAE uses BID exit OHLC; SELL MFE/MAE uses ASK exit OHLC. Logical stop/target touches use BID OHLC for both sides. A gap in timestamps is measured in the analysis layer and must also be sent as GAP when the disconnect / missing-data interval is known.

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

Send EXIT once the virtual position is resolved. `cost_completeness` must explicitly distinguish quote-side-only R from a result that includes commission and swap. The shadow EA initially reports `QUOTE_SIDE_ONLY_EXCLUDES_COMMISSION_SWAP`; do not present that as fully cost-adjusted expectancy. `exit_price` is the actual executable close fill: BUY closes on BID; SELL closes on ASK. Submit both exit quotes and a spread matching `exit_ask - exit_bid`; the server records the quote side and reconstructs signed adverse slippage (positive means adverse). Net R must use the ENTRY event's `effective_risk_distance_price` and include the same cost convention, commission and swap; retain gross R separately where available.

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
    "cost_completeness": "QUOTE_SIDE_ONLY_EXCLUDES_COMMISSION_SWAP",
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

The pure helper `buildGoldForwardPathMetrics` consumes a chronologically ordered list of completed Bid/Ask OHLC candles, executable virtual entry fill, BID logical stop/target, expected executable stop fill, effective risk distance, and ENTRY UTC timestamp. It calculates elapsed seconds and snapshots at/after 15 and 30 minutes in addition to bar-count snapshots. Each bar must be explicitly tagged `BID_ASK_TICK_AGGREGATED`; missing ASK bars or unverified one-sided OHLC are rejected. It returns:

- Cumulative MFE_R and MAE_R after every bar.
- Close progress in R after each bar.
- The first observed +0.25R favourable or -0.50R adverse threshold.
- An explicit `AMBIGUOUS_SAME_BAR` label when both thresholds occur within one candle.
- 3-segment and 6-segment snapshots, plus the first recorded observations at/after 15 and 30 elapsed minutes.
- Missing-bar count and maximum gap duration.
- An ambiguous SL/TP label when both barriers fall inside the same OHLC candle.

This OHLC method cannot determine intrabar sequence. If a candle reaches both a threshold or both BID stop and target, keep the ambiguity label; do not choose a sequence from OHLC. Tick-aggregated Ask/Bid bars provide quote-side extrema, but they still do not reveal the order in which extrema occurred. Preserve raw tick ordering separately when available.

## Current implementation boundary and EA status

The research-only MT4 implementation is present in `mt4/GoldAITraderV19.mq4` on this branch. It is not enabled by default and has not been compiled in MetaEditor or connected to a research service as part of this change.

### EA controls and entry eligibility

- `EnableForwardShadowTelemetry=false` by default.
- `ForwardShadowApiBaseUrl=""` and `ForwardShadowApiKey=""` by default.
- The EA refuses initialization if telemetry is enabled while `AllowAutoOrders=true`, if the shadow URL is not HTTPS, if the shadow host matches `ApiBaseUrl`, or if the shadow key is missing / reused from `ApiKey`.
- A virtual ENTRY is considered only when the API candidate and deterministic decision agree on BUY/SELL, risk is approved, market safety is allowed, remote mode is exactly `ANALYSIS`, remote `auto_trading_enabled=false`, and `order_allowed=false`.
- The existing signal request is still sent to `ApiBaseUrl`; only the research ENTRY/BAR/GAP/EXIT event stream is posted to the distinct `ForwardShadowApiBaseUrl` with `ForwardShadowApiKey`. Keep the signal endpoint in ANALYSIS mode with automatic trading disabled.
- The EA contains no `OrderSend`, `OrderClose`, or `OrderModify` calls. The shadow state is a virtual observation and cannot submit, close, or modify a broker order.

### Data collection behavior

- The signal payload includes up to 24 completed H1 bars with EMA20/50/200 and ATR14 calculated at the matching completed bar shift, plus the existing completed M5 series.
- One virtual position is tracked at a time. New BUY/SELL candidates that arrive while one shadow position remains active are not opened as a second virtual position; this limits overlap and must be considered when comparing the collected sample to multi-position backtests.
- The virtual entry is priced at Ask for BUY and Bid for SELL. The EA records the observed entry Bid/Ask and uses the current spread as the expected stop-side spread proxy for SELL. The configured stop-slippage assumption defaults to 0.05 price units. This is a documented cost-model assumption, not a claim of measured stop-fill slippage.
- On each MT4 tick, Bid and Ask OHLC are independently aggregated from actual quote ticks. Ask OHLC is not synthesized by adding a fixed spread to Bid OHLC.
- Every M5 interval is sent as a BAR event. Initial partial intervals and exit-truncated intervals are tagged partial and have an explicit duration. Stale tick / missing interval conditions send GAP. A recovered active virtual position is restored from terminal Global Variables and attempts to write the prior partial bar and a GAP before resuming.
- Logical SL/TP touches are evaluated from BID quotes for both directions; the recorded close fill is BID for BUY and ASK for SELL.
- The current EA resolves a virtual position on logical STOP or TARGET. It does not currently impose an independent TIME exit. A position that reaches neither barrier can remain active and suppress new virtual entries; monitor this behavior during the test.
- EXIT reports `QUOTE_SIDE_ONLY_EXCLUDES_COMMISSION_SWAP`. It is not fully net-of-commission/swap expectancy. Keep this field visible in any report and do not compare it directly to fully cost-adjusted backtest returns.

### Activation sequence — do not skip

1. Compile the branch's `mt4/GoldAITraderV19.mq4` in MetaEditor and inspect all compiler warnings/errors. The GitHub tests are static-source and Node.js tests; they do not replace an actual MT4 compile.
2. Create/use a dedicated research Render service for the API endpoint and a dedicated research Supabase project. Do not use the production Render service or production Supabase for this branch's event table.
3. Configure the research API service with its own `GOLD_API_KEY` and apply only `supabase/migrations/202611140001_gold_forward_shadow_events.sql` to the research database. Confirm the table exists, RLS is enabled, and the API can persist a synthetic event.
4. On a separate demo / analysis MT4 terminal, leave `AllowAutoOrders=false`. Keep `EnableForwardShadowTelemetry=false` until the dedicated API and schema checks pass. Then configure a distinct HTTPS `ForwardShadowApiBaseUrl` and a separate `ForwardShadowApiKey`.
5. Add both API hosts to MT4's WebRequest allowed list. Check Experts logs for `[GOLD SHADOW]` and confirm ENTRY/BAR/GAP/EXIT rows in the research table.
6. Run at least one synthetic BUY and SELL path through ENTRY/BAR/GAP/EXIT and verify idempotency, data-gap handling, executable quote-side calculations, and same-candle ambiguity.
7. Only after all above checks should telemetry be enabled for a small, monitored Forward/Paper collection window. Do not change the production EA, production strategy settings, runtime state, order gate, or the production service.

## Known limitations before real collection

- The +0.25R / -0.50R early movement labels are descriptive thresholds only. They do not manage positions.
- M5 tick-aggregated OHLC provides accurate quote-side extrema but not the intrabar order of those extrema. Same-bar thresholds or SL/TP touches remain ambiguous; do not infer which occurred first.
- The expected stop-slippage input and SELL stop-spread proxy are model assumptions. A later comparison should separate observed entry spread, assumed stop spread, assumed stop slippage, actual virtual exit quote, and any commission/swap not included.
- One virtual position at a time and no TIME exit can create selection / holding-period differences versus historical backtests. Report ignored overlapping candidates and still-open positions before drawing conclusions.
- An MT4 terminal restart creates an explicit GAP; data across that interval is incomplete and must not be treated as a complete price path.
- No research service has been deployed and no SQL migration has been applied as part of this branch work. Forward/Paper collection has therefore not started.
