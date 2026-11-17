# GOLD backtest summary synchronization (Phase 1)

## Scope

This phase adds an authenticated, idempotent upload for the existing Node.js historical GOLD backtest report.

The upload contains aggregate results only:
- Strategy version, symbol, timeframe, and test period
- Cost scenario names and spread/slippage assumptions
- Trade count, win rate, profit factor, expectancy, total R, return, and maximum drawdown
- IS/OOS and recent-period aggregate metrics
- Candidate and rejection counters
- Compact strategy parameters and backtest assumptions

The upload does **not** contain OHLCV bars, bid/ask time series, individual trades, entry/exit prices, or CSV contents. The API applies a strict whitelist and rejects payloads whose idempotency digest does not match the normalized content.

## Enable automatic upload

The automatic upload is opt-in and remains disabled unless the following environment variables are set in the environment that runs `scripts/backtest-gold-v2.mjs`:

- `GOLD_BACKTEST_AUTO_UPLOAD=true`
- `GOLD_BACKTEST_API_URL=https://gold-ai-trader-1.onrender.com`
- `GOLD_API_KEY=<the existing GOLD API key>`

Keep the key in a local environment variable or an approved secret store. Do not put it in source code, command history, screenshots, or committed `.env` files.

Run the existing backtest as usual. It writes the full report and trade CSVs locally; only the compact, whitelisted summary is sent to:

`POST /api/gold/backtest-summary`

The server uses the existing `X-Gold-API-Key` authentication and stores the summary in `public.gold_backtest_runs`. A SHA-256 key makes retries idempotent. The table is RLS-enabled and accessible only through the server-side Supabase service role.

If upload is enabled but fails, the backtest command returns an error after retaining its local outputs. This prevents an unnoticed failed synchronization.

## Important distinction: Node historical backtest vs. MT4 Strategy Tester

The current `GoldAITraderV19.mq4` is a monitor/analysis bridge with `AllowAutoOrders=false`; it does not place orders. The existing GOLD V2 historical performance engine is `scripts/backtest-gold-v2.mjs`, which replays historical XAUUSD M5 data and computes the metrics above.

Therefore Phase 1 synchronizes the existing Node historical backtest report. It does not claim to upload actual MT4 Strategy Tester execution statistics. A separate MT4 tester summary adapter can be added when an order-capable test EA or a verified MT4 report format is available.

## Staged data policy

Phase 1 does not add a new raw-market-data upload. However, the existing V2 signal-request payload still sends its required completed M5/H1 bars to the Render signal API so that the current V2 setup logic can continue to run unchanged. That existing signal input path is intentionally left alone during Phase 1.

The next phase can move the deterministic V2 feature calculations to MT4 and verify signal-by-signal parity before removing that existing bar payload. Do not disable or remove the current signal input until that parity check passes.

## Safety invariants

- V2 strategy conditions, thresholds, and candidate decisions are unchanged.
- No order-execution code is added.
- Keep `Mode=ANALYSIS`, `auto_trading_enabled=false`, and the real-order gate OFF.
- The new endpoint stores research results only; it cannot create or approve orders.
- No Render deploy or MT4 EA installation is required to run repository unit tests.
