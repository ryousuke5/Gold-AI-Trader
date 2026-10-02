# EURUSD Fundamental Replay

The EURUSD backtester evaluates the technical core from M15 price data and H1 trend data. It can optionally apply a timestamped historical fundamental mask without calling the live OpenAI web-search layer.

## Required mask schema

    timestamp,bias,confidence,freshness,event_risk_next_24h

Allowed values:
- bias: BULLISH_EURUSD, BEARISH_EURUSD, NEUTRAL, INSUFFICIENT
- confidence: 0.0 to 1.0
- freshness: CURRENT, MIXED, STALE, INSUFFICIENT
- event_risk_next_24h: LOW, MEDIUM, HIGH, UNKNOWN

## Look-ahead prevention

Each row must be timestamped at the moment the information became available to the trading system, not at the time an article was later edited or at the time an outcome became known.

The backtester only uses the latest mask row whose timestamp is less than or equal to the M15 signal timestamp. It rejects rows older than the configured maximum age, stale/insufficient freshness, low confidence, HIGH event risk, and directionally mismatched bias.

Example (illustrative only; do not use as real historical evidence):

    timestamp,bias,confidence,freshness,event_risk_next_24h
    2026-09-25T08:00:00Z,BULLISH_EURUSD,0.78,CURRENT,LOW

## Running a replay

Set BACKTEST_FUNDAMENTAL_SOURCE to a public CSV URL, then optionally set:

    BACKTEST_MIN_FUNDAMENTAL_CONFIDENCE=0.65
    BACKTEST_MAX_FUNDAMENTAL_AGE_HOURS=48

The report then contains:
- summary: technical-only result
- fundamental_filtered_summary: result after the timestamped fundamental gate
- fundamental_filter_stats: candidate/rejection counts and reasons

A replay with no mask explicitly reports fundamental_backtest_status=NOT_RUN.

## Candle timestamp convention

EURUSD signal timing uses the **completed candle close timestamp** end-to-end. The backtest source data is documented as using bar-open timestamps, so the backtester adds one M15 bar (900 seconds) or one H1 bar (3600 seconds) before evaluating a completed signal. This keeps the live API expiry window and the historical replay on the same time basis.

At an M15 signal close, the H1 filter uses the latest H1 candle whose close timestamp is less than or equal to that M15 close. The next M15 bar is the earliest simulated execution bar.

## Data provenance

For the currently configured technical backtests, the project uses public EURUSD M15/H1 CSV sources in GitHub Actions. See the workflow files for exact source URLs and date windows. The CSV parser accepts `volume`, `tick_volume`, and `real_volume`; when multiple are present it prefers `volume`. MT4 monitoring uses `iVolume`, so `tick_volume` is the matching historical proxy when that is the source column.

## Deterministic macro proxy

The repository also contains `scripts/build-eurusd-fundamental-proxy.mjs`. This is **not an AI result**. It classifies EURUSD direction from point-in-time US-minus-EUR policy-rate levels and 20-day changes, and marks central-bank meeting dates as high event risk. It is used only as a baseline control to measure whether a simple causal fundamental filter changes the technical-core backtest.

The current 2020-03-04 to 2022-03-04 replay produced 7 filtered trades: PF 1.40, expectancy +1.62 pips/trade, net +$413.74, max drawdown 0.76%. The small sample size means this result is exploratory and not evidence of stable profitability.


## Proxy sensitivity (2020-03-04 to 2022-03-04)

All runs use the same EURUSD M15/H1 prices, 0.25% risk/trade, 0.8 pip spread, 0.1 pip slippage per side, next-M15-open execution, and 2R target. Only the deterministic policy-rate proxy thresholds differ.

| Profile | Filtered trades | PF | Expectancy (pips) | Net P&L | Max DD |
|---|---:|---:|---:|---:|---:|
| strict | 7 | 1.40 | +1.62 | +$413.74 | 0.76% |
| medium | 9 | 1.48 | +2.90 | +$627.08 | 0.76% |
| loose | 10 | 1.23 | +1.78 | +$359.31 | 0.76% |
| momentum-only | 6 | 0.95 | -0.08 | -$54.04 | 0.76% |

The sample remains too small to establish stable profitability. In particular, the proxy is a control experiment, not the live AI/web-search fundamental layer.

## Historical-data caution

FRED documents that current FRED data can differ from what was known at a past date because economic observations can be revised; ALFRED preserves real-time periods and vintage dates for point-in-time reconstruction. For future macro replay expansion beyond non-revised policy-rate series, use ALFRED-style vintages rather than current revised observations to avoid look-ahead bias. citeturn677807search1turn677807search4turn677807search6

## AI replay stability

The AI historical replay now processes the macro snapshots in configurable chunks (default 90 days) with up to three retries. This avoids a single oversized structured-output response for the full history.
