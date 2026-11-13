# GOLD XM Empirical Spread Cost Replay — Results

Updated: 2026-11-13 (JST)  
Workflow: [43392452756](https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/43392452756)  
Artifact: `gold-xm-empirical-cost-research` (ID `14020813137`)

## Decision

**The XM server-hour empirical spread model is implemented and its CI/backtest replay succeeded. Neither tested strategy is eligible for promotion.**

This is a spread-model milestone, not a complete all-in cost model. Slippage remains assumed, and commission, swap and financing remain unmodeled until actual Demo execution records and account-history costs are verified.

## Cost scenarios

- `baseline`: fixed spread 0.50 / slippage 0.05 per side.
- `conservative`: fixed spread 0.75 / slippage 0.10 per side.
- `xm_demo_p50`: XMTrading-Demo 6 hourly P50 spread / slippage 0.05.
- `xm_demo_p90`: XMTrading-Demo 6 hourly P90 spread / slippage 0.05.
- `xm_demo_p95_stress`: XMTrading-Demo 6 hourly P95 spread / slippage 0.10.
- `xm_real_p90`: XMTrading-Real 11 hourly P90 spread / slippage 0.05.

The UTC bar timestamp is mapped to `Europe/Nicosia` server-local hour with DST. Entry and exit use their own timestamp's hourly spread estimate. The entry estimate is used for planned risk sizing; actual exit spread is independently applied to realized P/L. The research-only entry spread gate remains 0.50.

## Momentum Pullback V1

| Period | Scenario | Trades | Win % | PF | Expectancy R | Max DD % |
|---|---|---:|---:|---:|---:|---:|
| IS 3Y | Fixed baseline | 121 | 35.54 | 0.8267 | -0.1025 | 5.1512 |
| IS 3Y | Fixed conservative | 99 | 35.35 | 0.6479 | -0.2085 | 5.0605 |
| IS 3Y | XM Demo P50 | 167 | 35.93 | 0.9451 | -0.0315 | 5.1173 |
| IS 3Y | XM Demo P90 | 165 | 35.76 | 0.9303 | -0.0406 | 5.1766 |
| IS 3Y | XM Demo P95 stress | 131 | 35.88 | 0.8672 | -0.0788 | 5.1023 |
| IS 3Y | XM Real P90 | 165 | 35.76 | 0.9332 | -0.0388 | 5.1481 |
| OOS 2Y | Fixed baseline | 63 | 26.98 | 0.5647 | -0.2950 | 5.0121 |
| OOS 2Y | Fixed conservative | 48 | 20.83 | 0.4467 | -0.3828 | 5.0288 |
| OOS 2Y | XM Demo P50 | 103 | 30.10 | 0.7159 | -0.1855 | 5.2105 |
| OOS 2Y | XM Demo P90 | 102 | 30.39 | 0.7164 | -0.1841 | 5.1259 |
| OOS 2Y | XM Demo P95 stress | 66 | 27.27 | 0.5723 | -0.2889 | 5.1495 |
| OOS 2Y | XM Real P90 | 102 | 30.39 | 0.7177 | -0.1833 | 5.1078 |

The empirical spread scenarios improve on the prior fixed 0.50 spread baseline in this comparison, but PF remains below 1.00 and expectancy remains negative in both periods. P50 is not a usable trading-cost assumption by itself; P90/P95 are more cautious reference cases. No parameter selection or tuning was performed against OOS. The OOS window has been consulted previously and is not a fresh blind holdout.

## GOLD V2 Strict reference

| Period | Scenario | Trades | PF | Expectancy R |
|---|---|---:|---:|---:|
| IS 3Y | XM Demo P50 | 4 | 0.9165 | -0.0402 |
| IS 3Y | XM Demo P90 | 4 | 0.8971 | -0.0500 |
| IS 3Y | XM Demo P95 stress | 4 | 0.8226 | -0.0873 |
| OOS 2Y | All tested scenarios | 2 | 0.0000 | -1.0000 |

The Strict baseline sample is too small to support a profitability conclusion. Its configuration remains frozen.

## Ledger audit

Trade-level CSVs confirm that the empirical scenario fields are populated:
- IS Momentum Pullback / Demo P90: 165 closed trades; entry spread estimate 0.28–0.30; exit spread estimate 0.28–0.30; all entry/exit observations used the hourly profile; slippage assumption 0.05 per side.
- OOS Momentum Pullback / Demo P90: 102 closed trades; entry/exit spread estimate 0.28–0.30; all used the hourly profile.
- The 0.50 research entry gate rejected zero candidates in these runs. The strategy's UTC 07–20 session mapped outside the abnormal server-local reopen buckets in this fixed sample.

## Remaining work before calling costs fully calibrated

1. Measure signed adverse slippage from actual Demo 6 order fills; current 0.05/0.10 values are assumptions.
2. Verify account-currency commission and swap/financing from closed Demo history.
3. If a supervised Demo probe is needed, obtain explicit approval first; no orders were placed as part of this model work.
4. Accumulate more continuous quote history across multiple full weekly cycles and market regimes. The current quote sample is only October-November 2026 and is not five-year historical XM spread data.

## Safety

- Research branch only: `research/xm-empirical-cost-model-20261113`.
- GOLD V2 Strict production rules unchanged.
- V19 remains signal/telemetry-only.
- Render, Supabase and production service were not changed.
- ANALYSIS mode; auto trading OFF; real-order gate OFF; MT4 AllowAutoOrders OFF.
