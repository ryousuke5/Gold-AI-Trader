# GOLD Forward/Paper Loss Telemetry — Research Only

## Purpose
Capture candidate context at entry and fixed-horizon MFE/MAE at +15m and +30m.
This is evidence collection only: it does not alter a candidate, veto, risk check,
order gate, MT4 order path, or the frozen GOLD V2 Strict parameters.

## Isolation and safety
- Branch: `research/gold-forward-loss-telemetry-20261114`.
- Runtime feature flag: `GOLD_FORWARD_RESEARCH_TELEMETRY_ENABLED=false` by default.
- Enable only on a dedicated research API instance connected to a dedicated research Supabase project.
- Apply `supabase/migrations/202611140001_gold_forward_research_telemetry.sql` only to that research project.
- Do not deploy this branch to the production Render service.
- Do not change the production EA, Supabase project, strategy config, or any real-order control as part of this work.
- Existing V19 requests already carry the last 24 completed M5 and H1 bars; no EA change is required for this first telemetry version.

## What is captured
One observation is created for each deterministic GOLD V2 BUY/SELL setup where the API market-safety check passed, regardless of whether AI later agrees or risk approves. That makes AI vetoes and risk blocks visible rather than silently excluding them.
- Candidate, entry reference, stop, target, initial risk distance, entry ATR and spread.
- Setup diagnostics: range ATR, body ATR, close location, volume ratio, breakout ATR, stop ATR.
- H1: close/EMA20, EMA20/EMA50, EMA50/EMA200 distances in ATR, EMA stack state, side-adjusted 3h/6h close momentum, 6h close consistency and body efficiency, age of the last 12-bar directional close breakout.
- M5: RSI, ATR, EMA20 distance in ATR.
- Context flags: market safety allowed, AI decision, risk approved, runtime mode, auto-trading flag; `orders_executed=false` is always recorded.
- At +15m (3 completed M5 bars) and +30m (6 completed M5 bars): gross MFE/MAE in price, R and ATR; stop/target touch flags; first-touch classification. If both stop and target are touched in the same candle, the path is marked ambiguous.
- A missing expected M5 candle is explicitly recorded as `DATA_GAP`; it is not converted into zero movement.

## Important limitations
- V19 currently sends current H1 EMA values but not historical H1 EMA values. Therefore exact EMA slope and EMA-stack duration are intentionally null/not available. 3h/6h close momentum is a clearly named proxy, not mislabeled as EMA slope.
- MFE/MAE use completed M5 OHLC bars, so intrabar path and tick-level slippage are unknown. Same-candle stop/target touches are explicitly ambiguous.
- MFE/MAE are gross price excursion measures. Spread is captured separately; they are not a promise of executable net P&L.
- This first version measures the frozen deterministic V2 Strict candidate, not the rejected research variants. Future strategy candidates require explicit separate strategy-version labels.
- Candidates may overlap in time. These are independent hypothetical observations, not a portfolio simulation with one-position-at-a-time constraints.

## Dedicated research instance setup
1. Create/use an isolated research Render service and research Supabase project.
2. Apply the migration to the research Supabase database only.
3. Configure the research service with the same API secrets appropriate to that isolated instance and:
   `GOLD_FORWARD_RESEARCH_TELEMETRY_ENABLED=true`.
4. Keep `GOLD_LIVE_TRADING_APPROVED=false`, `auto_trading_enabled=false`, and the MT4 `AllowAutoOrders=false`. No live trading is part of this research.
5. Attach a copy of the current V19 analysis EA to a demo/monitor terminal pointed at the research endpoint only after validating URL/API key and the market-safety status. Keep production V19 attached to the production endpoint.
6. Confirm the research endpoint log reports `[GOLD FORWARD RESEARCH]` and that rows arrive in the research table.

## Review SQL
```sql
select
  side, count(*) as observations,
  count(*) filter (where outcome_15m->>'data_quality_status' = 'COMPLETE') as complete_15m,
  count(*) filter (where outcome_30m->>'data_quality_status' = 'COMPLETE') as complete_30m,
  round(avg((outcome_15m->>'mfe_r')::numeric), 3) as avg_mfe_15m_r,
  round(avg((outcome_15m->>'mae_r')::numeric), 3) as avg_mae_15m_r,
  round(avg((outcome_30m->>'mfe_r')::numeric), 3) as avg_mfe_30m_r,
  round(avg((outcome_30m->>'mae_r')::numeric), 3) as avg_mae_30m_r
from public.gold_forward_research_observations
group by side
order by side;
```

## Pre-registered hypotheses
- H1 (trend strength/freshness): side-adjusted H1 3h/6h momentum, close consistency, body efficiency, EMA-stack gaps, and recent directional-breakout age are associated with 15m/30m adverse excursion and target progress.
- H2 (early follow-through): weak or adverse 15m MFE/MAE is associated with weak 30m progress and later stop-side pressure. First report distributions; do not use 15m as a stop signal.
- Analyze by side, UTC session, spread/ATR band, and data-quality status. Do not create bins after looking at the outcomes without clearly labeling them exploratory.
- Do not tune a threshold from this first sample. Require a preregistered confirmation window and a minimum sample before any rule change is considered.

## Completion criteria
The first telemetry cycle is usable only after the research instance persists candidate rows and produces both complete 15m/30m snapshots with no silent data gaps, while the production instance and all execution gates remain unchanged.
