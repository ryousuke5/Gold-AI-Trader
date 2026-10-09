# GOLD V2 live forward-monitor diagnostic checkpoint

Snapshot timestamp: 2026-10-09 16:25:03 (Asia/Tokyo)
Symbol/timeframe: GOLD / M5
Strategy version: gold-m5-h1-v2
Runtime: ANALYSIS; auto trading OFF; DB ok; AI only on candidate YES.

## Monitor results

- Total signals: 252.
- BUY 0, SELL 0, WAIT 252.
- Latest candidate/decision: WAIT.
- Filter table covers latest 200 signals, not all 252.

| Stage | Reached / prior pass | Rejected | Pass rate |
|---|---:|---:|---:|
| Session | 200 | 108 | 46.0% passed |
| H1 trend | 92 | 78 | 15.2% passed |
| M5 range continuity | 14 | 0 reported | 100% of reached rows |
| Range compression | 14 | 13 | 7.1% passed |
| Breakout width | 1 | 1 | 0% passed |
| Later gates | 0 | — | not reached |

## Range ATR distribution

Sample count 12; configured interval 0.80–2.80; observed min 2.63, median 4.85, max 5.36, mean 4.50. Eleven of twelve observations exceed the upper bound. Treat this as a diagnostic signal, not a statistically adequate calibration sample.

## Source cross-check

- render.yaml configures GOLD_RANGE_LOOKBACK=12, GOLD_MIN_RANGE_ATR=0.80, and GOLD_MAX_RANGE_ATR=2.80.
- src/gold_strategy_v2.js computes rangeAtr = (range.high - range.low) / m5.atr14 from the preceding range bars and rejects it when outside the configured bounds.
- server.js uses gold-m5-h1-v2 and persists the setup reason/diagnostics. With AI only on candidate enabled, WAIT skips the AI call; this is not an AI rejection.
- H1 trend requires aligned close/EMA20/EMA50/EMA200 ordering and H1 RSI in a directional band.

## Decision and next action

Do not change production settings or deploy threshold edits based only on this live snapshot. Inspect the latest GOLD V2 Five-Year Research run and compare research-only variants range_max_4, range_max_4_5, range_max_5, range_max_5_5, and loose. Compare five-year, fixed IS/OOS, recent, conservative-cost and drawdown results. Check whether a run is active before dispatching a new one.

Keep auto-trading OFF. Any promising variant must pass independent OOS and conservative-cost checks before promotion.
