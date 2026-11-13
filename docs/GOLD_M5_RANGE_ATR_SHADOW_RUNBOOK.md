# GOLD V2 M5 Range ATR Shadow Diagnosis Runbook

## Goal

Identify the first M5 condition that rejects each setup already rejected by the normal Range ATR compression gate. This is a diagnostic-only counterfactual evaluation.

## Method

1. Use the fixed Walk-Forward split artifact produced by run `43349812731`.
2. Evaluate IS (3 years) and OOS (2 years) separately.
3. Keep H1 in Strict mode and every production M5/risk setting fixed:
   - Range lookback 12
   - Range ATR 0.80–2.80
   - Body ATR >=0.40
   - Volume ratio >=1.10
   - Breakout distance >=0.10 ATR
   - Close location >=0.65 for BUY / <=0.35 for SELL
   - Session UTC 07:00–20:00
   - Risk 0.25%, spread 0.50, slippage 0.05
4. For each setup whose ordinary result is `WAIT / compression_filter`, run a second shadow-only evaluation with only the Range ATR min/max comparison bypassed. A non-positive range width is still rejected.
5. Record the first downstream rejection reason and technical measurements. A setup that passes every remaining filter is recorded as a potential candidate, but it is not simulated as a portfolio trade and is not sent to an order path.
6. For ordinary setups that pass Range ATR but first fail body ATR, volume ratio, or breakout distance, run a separate one-gate-only bypass for that first failed filter. All other strategy conditions remain unchanged. Record only the next rejection reason or a potential setup; do not simulate portfolio trades.

## Safeguards

- The original setup result remains unchanged.
- The shadow output is observational only; it does not change the actual candidate, risk ledger, trades, database, or order execution.
- No Render or MT4 configuration is changed.
- No live deployment or merge is performed.
- A potential candidate after bypass would still require separate entry-gap, overlap, drawdown, cost, and OOS validation.
- Bar-level counts are not independent trades. Always report sample counts with metrics.
- Do not change production thresholds based on a shadow count alone.

## Source data

Walk-Forward validation run `43349812731`, artifact `gold-v2-walkforward`, with separate `is_data.json.gz` and `oos_data.json.gz` slices.

## Outputs

- `gold_m5_range_shadow_report.md`
- `gold_m5_range_shadow_report.json`
- `gold_v2_range_shadow_IS_3Y.csv`
- `gold_v2_range_shadow_OOS_2Y.csv`\n- `gold_v2_m5_gate_shadow_IS_3Y.csv`\n- `gold_v2_m5_gate_shadow_OOS_2Y.csv`

Production remains GOLD V2 Strict, Mode ANALYSIS, `auto_trading_enabled=false`, and real-order gate OFF.
