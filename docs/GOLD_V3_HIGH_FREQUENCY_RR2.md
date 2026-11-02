# GOLD V3 — High-Frequency H1 Trend / M5 Expanded Pullback / RR 1:2

## Scope and isolation

- Strategy ID: gold-h1-m5-expanded-pullback-reaccel-v3.
- Research-only implementation. It is not wired into the production /api/gold/signal endpoint.
- GOLD V2 source, defaults, Render environment variables, Supabase records, MT4 V19, and the live 0.50 spread gate remain unchanged.
- No AI calls, order submission, position modification, or live-trading toggle is used by this research pipeline.

## Frozen first-pass hypothesis

| Layer | Initial rule |
|---|---|
| Market | XAUUSD / GOLD |
| Direction | H1 |
| Entry timing | M5, completed candles only |
| BUY trend | H1 close > EMA50, EMA20 > EMA50, RSI 45–78 |
| SELL trend | H1 close < EMA50, EMA20 < EMA50, RSI 22–55 |
| Impulse | Confirmed M5 pivot pair, at least 0.8 M5 ATR, 3–30 bars |
| Pullback | 23.6%–61.8% of the latest confirmed impulse |
| Pullback window | Up to the 3 completed bars before the signal candle, after the impulse endpoint |
| Re-acceleration BUY | Bullish candle, close above previous M5 high, close above M5 EMA20 |
| Re-acceleration SELL | Bearish candle, close below previous M5 low, close below M5 EMA20 |
| Candle body | At least 0.20 M5 ATR |
| Stop | Recent post-impulse pullback/signal swing extreme plus 0.10 ATR buffer |
| Stop width | 0.25–1.80 M5 ATR |
| Target | Exactly 2R; replay re-anchors target to simulated fill |
| Session | 07:00–20:00 UTC |
| Volume | Not required in this frequency hypothesis |
| H1 EMA200 | Not required in this frequency hypothesis |

The wider pullback interval, one-bar pivot confirmation, relaxed H1 alignment, and removal of the volume requirement are deliberate frequency hypotheses, not claims that the strategy is profitable. Parameters are frozen for the first IS run; do not tune them against the same IS outcomes.

## Replay execution model

From the repository root, run:

    GOLD_V3_BACKTEST_DATA_FILE=/absolute/path/to/xauusd_m5_utc.json.gz npm run research:gold:v3:build
    npm run research:gold:v3:report

The input is a JSON array (or an object with bars/data) of M5 BID-price bars with UTC Unix epoch seconds in time and numeric open, high, low, close, and optional volume. Timestamps must be M5 bar-open epochs aligned to 300-second UTC boundaries. The replay builds up to 64 closed M5 bars for each V3 decision. The builder only uses fully closed H1 bars aggregated from twelve contiguous M5 bars. MT4 server-local timestamps must be normalized with the correct historical UTC+2/UTC+3 daylight-saving offsets before replay; they must not be relabelled as UTC.

Optional period bounds are GOLD_V3_START_UTC and GOLD_V3_END_UTC. Both must include an explicit Z or ISO-8601 offset. Supply adequate pre-period warm-up history so H1 EMA200 can be calculated before the first evaluated signal.

The same selected time window is evaluated for V2 candidate frequency with its production-default rules imported read-only. V2 is not rewritten, retuned, or executed by this V3 pipeline. V2 candidate count is a frequency reference only; the V3 baseline/stress outcomes are reported separately.

Two fixed-cost scenarios are recorded:

- Baseline: spread 0.55 price units, slippage 0.05 each side.
- Stress: spread 0.75 price units, slippage 0.10 each side.

These are sample-calibrated assumptions, not per-trade historical quote joins. The supporting XM quote sample was short (about three days; median spread 0.55, P95 0.57, P99 0.58) and cannot establish a full-market spread distribution. Swap/financing and any account-specific commission are not modeled in this first pass. The simulator permits only one open position per scenario, skips next-bar gaps above 0.50 ATR, holds up to 96 M5 bars, and resolves a same-candle stop/target collision as stop-first. The live 0.50 spread gate is not changed by this research run.

## Output and adoption gate

Outputs are written to gold-v3-replay/:

- gold_v3_frequency_replay.jsonl: individual V3 candidates and scenario outcomes.
- manifest.json: input fingerprint, period, frozen config, V2/V3 candidate counts, and isolation flags.
- report.json: baseline/stress trades, win rate, PF, expectancy, net R, max drawdown R, monthly outcomes, and skipped reasons.

Do not select or deploy V3 from candidate count or win rate alone. The first run is IS screening only. Require a meaningful number of trades, positive net expectancy after both cost scenarios, acceptable drawdown, stable monthly and BUY/SELL results, then freeze the configuration and test a previously untouched OOS period. No real orders before XM-native price/cost and demo-fill reconciliation.
