# EURUSD Strategy B — Live Trading Gate

EURUSD Trend Pullback v1 is not eligible for live trading until the quantitative approval gate passes.

## Required backtest conditions

The balanced baseline must satisfy all of the following on the configured historical test:

- Profit factor >= 1.25.
- Expectancy >= 0.10R per trade.
- Maximum drawdown <= 12R.
- Last 365 days: at least 40 trades.
- Last 365 days profit factor >= 1.10.
- Last 365 days expectancy >= 0.05R.
- Last 365 days maximum drawdown <= 6R.

Trade frequency is a guideline only. A lower frequency can be acceptable when the statistical quality is stronger; a higher frequency does not compensate for weak expectancy, PF, drawdown, or recent stability.

Bootstrapによる期待値95%レンジも参考情報として記録します。これは合否条件ではありません。

These are engineering acceptance gates, not a guarantee of future profitability.

## Execution safety

Live execution requires both:

- `EURUSD_EXECUTION_ENABLED=true`
- `EURUSD_LIVE_TRADING_APPROVED=true`

Both default to `false`.

Therefore enabling execution alone is insufficient. The approval gate must be deliberately enabled only after the backtest, 直近365日検証 review, and forward/demo validation have been reviewed.

Strategy B remains monitor-only until that point.
## Strategy B V2 research status

Strategy B V2 (TREND_PULLBACK_V2) is a research-only variant. It is intentionally not wired to the live /api/eurusd/pullback-signal execution path. V2 must first pass 5-year historical testing, recent-365-day validation, direction/year consistency review, and execution-cost stress testing. Trade frequency remains a guideline, not an approval criterion.

The V2 backtester reports separate development-period and recent-365-day validation statistics. The recent-365-day segment is treated as a fixed-parameter validation segment; parameters are not fitted inside the backtester.

Live approval remains blocked unless the explicit EURUSD live approval flag is enabled after the quantitative review and forward/demo validation.
