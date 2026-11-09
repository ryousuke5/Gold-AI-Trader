# GOLD data collection and CSV export

## What is captured

This change uses the existing `public.gold_system_events` table; it does not add a table or alter GOLD V2 rules.

- `gold_market_safety_heartbeat`: every V19 safety heartbeat (normally every 15 seconds), including local/API gate state, quote age, bid/ask/spread, stable tick count, reopen lock, and EA flow switches.
- `research_snapshot`: attached to the first successful heartbeat after each new completed M5 candle. Contains up to 24 completed M5 bars and 24 completed H1 bars, OHLC, Tick Volume, EMA/RSI/ATR context, and quote values. It is collected even when the local safety gate blocks signal requests.
- `gold_signal_feature_snapshot`: every accepted GOLD signal bar, including normalized inputs, recent bars, deterministic setup diagnostics, and the effective V2 configuration.
- Existing `gold_ai_signals` and `gold_trade_results` remain the source of signal history and recorded trade results.

The heartbeat request is acknowledged even if database persistence fails. The response includes `persistence.heartbeat_saved` and `persistence.research_snapshot_saved`; MT4 advances its research-bar checkpoint only when the snapshot was persisted.

## CSV endpoints

All endpoints require the `X-Gold-API-Key` header. The default time window is the last seven days. Supply `from` and `to` as ISO-8601 timestamps to select another range. Maximum query limit is 50,000 rows.

| Dataset | Endpoint |
|---|---|
| Safety heartbeat | `GET /api/gold/export/market-safety` |
| M5/H1 OHLC + indicator context | `GET /api/gold/export/m5-h1` |
| BUY/SELL/WAIT history | `GET /api/gold/export/signals` |
| Paper trade results only | `GET /api/gold/export/paper-trades` |

The Forward Monitor includes buttons for downloading each dataset. CSV output is UTF-8 with BOM for spreadsheet compatibility. M5/H1 rows are deduplicated by symbol, timeframe, bar time, and strategy version. CSV cells are escaped and formula-like text is neutralized.

## MT4 installation

1. Open the updated `mt4/GoldAITraderV19.mq4` in MetaEditor.
2. Compile it and verify there are no compile errors.
3. Attach the compiled EA to the same GOLD chart only after the Render server update is confirmed.
4. Keep `EnableResearchDataCollection=true` and `ResearchBarsToCapture=24`.
5. Keep `EnableSignalRequests`, `RunAITestOnce`, `AllowAutoOrders`, and all market-safety parameters at their existing values.

The new research payload is informational only. It does not call the signal endpoint, alter a candidate, bypass a market-safety block, or place an order.

## Paper trade limitation

V19 is a market-safety/monitor EA and does not create Paper positions. `GOLD_Paper_Trades.csv` intentionally includes only rows explicitly tagged with `PAPER`, `FORWARD_PAPER`, or `ANALYSIS_PAPER` in trade-result metadata. It can therefore be empty until a separate Paper simulator sends its trade lifecycle and execution details. Live/real trade rows are not relabeled as Paper.

For complete Paper metrics, the reporting EA/simulator must send `idempotency_key`, an explicit `mode` (`PAPER`, `FORWARD_PAPER`, or `ANALYSIS_PAPER`), symbol, result, strategy version, entry/exit, SL/TP, spread, slippage, commission, swap, MFE-R, MAE-R, and holding duration to `/api/gold/trade-result`. Paper results may omit `mt4_ticket`; non-Paper results still require it. Store the detailed measurements in the request body or `metadata.capture`.

## Safety invariants

- GOLD V2 strategy conditions and thresholds are unchanged.
- V3 remains a separate strategy.
- No change enables auto trading or real orders.
- Keep `Mode=ANALYSIS`, `auto_trading_enabled=false`, and the real-order gate OFF.
- This feature branch is not deployed. Render deployment and MT4 installation must be completed separately after the target Render workspace is confirmed.
