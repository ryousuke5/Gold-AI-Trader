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

## Data provenance

For the currently configured technical backtests, the project uses public EURUSD M15/H1 CSV sources in GitHub Actions. See the workflow files for exact source URLs and date windows.