# GOLD V2 Alternative M5 Entry Structures Runbook

## Purpose

Compare the existing GOLD V2 Strict breakout reference with two structurally different M5 entry ideas. This is research-only. No production settings are changed.

## Strategies fixed before execution

### A. Strict breakout reference
- Existing GOLD V2 Strict, unchanged.
- H1 close/EMA20 + EMA20/EMA50/EMA200 stack + H1 RSI bands.
- Existing M5 compression, body, volume, breakout, close-location, RSI, EMA alignment, extension and stop-distance filters.

### B. Pullback / retest
- Existing module: `src/gold_pullback_retest_research.js`.
- Same Strict H1 trend and RSI gates.
- Previous completed M5 bar must touch EMA20 within 0.15 ATR and close within 0.35 ATR of EMA20.
- Current completed M5 bar must reconfirm in trend direction beyond the previous candle extreme, with directional close, M5 RSI and close-location checks.
- Maximum extension 1.5 ATR; swing-based stop 0.8–2.0 ATR; target 2R.

### C. Halfback V1
- Existing module: `src/gold_h1_m5_halfback_v1.js`.
- Strict H1 trend and RSI bands.
- Uses only confirmed pivots (2 bars left / 2 bars right), with a 5–40 bar impulse of at least 1.5 ATR.
- Requires 45–55% retracement and continuation reconfirmation.
- Confirmation body at least 0.25 ATR; close location BUY >=0.60 / SELL <=0.40.
- Stop 0.5–2.5 ATR; target 2R.

No parameters are optimized in this run.

## Common backtest controls

- Data source: prepared XAUUSD M5 data from Walk-Forward run `43349812731`.
- Fixed IS: 3 years; fixed OOS: 2 years, run separately.
- H1 mode: Strict for every variant.
- Initial equity: 100,000.
- Risk per trade: 0.25%.
- Baseline transaction costs: spread 0.50, slippage 0.05.
- Conservative scenario: spread >=0.75, slippage >=0.10 (backtester's built-in cost scenario).
- Maximum daily loss 2%; maximum drawdown lock 5%; maximum holding 96 M5 bars; maximum entry gap 0.50 ATR.
- Strategy-specific documented parameters are held constant.

## Interpretation

- Report both candidate counts and actual simulated trade counts.
- PF/expectancy with tiny samples are unstable. A larger candidate count is not evidence of an edge.
- IS is used to understand historical fit; OOS is reported only as a repeated robustness check. The 2024–2026 OOS period has already been consulted in prior research and is not a fresh blind holdout.
- No winner is automatically selected. Do not tune using this OOS period.
- A future candidate would need a pre-registered forward-paper evaluation on new data, with adequate sample size and costs, before any promotion discussion.

## Safety

- Production remains GOLD V2 Strict.
- Mode remains ANALYSIS.
- `auto_trading_enabled=false`.
- Real-order gate remains OFF.
- This workflow does not modify Render, MT4, Supabase, production configuration, or the main branch.
- Do not merge this branch or deploy any variant based on this report alone.
