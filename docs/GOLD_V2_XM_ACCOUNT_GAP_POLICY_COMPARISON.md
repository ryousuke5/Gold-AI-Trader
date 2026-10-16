# GOLD V2 — XM MT4 Account-Aware Gap Policy Comparison

**Status:** research only; generated from the successful five-year run on 2026-10-15.  
**Scope:** compare the legacy prior-close DATA_GAP exit against scheduled XM MT4 GOLD maintenance/weekend carry-forward, on the same historical OHLC dataset. No strategy parameter or live execution setting was changed.

## Account session source

Source: user-provided XM MT4 GOLD Symbol Specification screenshot dated 2026-10-15 and terminal diagnostic log.

| Day | Quote hours (MT4 server time) | Trade hours (MT4 server time) |
|---|---|---|
| Monday–Thursday | 01:00–23:59 | 01:02–23:58 |
| Friday | 01:00–23:58 | 01:02–23:58 |
| Saturday–Sunday | Closed | Closed |

The terminal diagnostic reported server_utc_offset_seconds=10800 (UTC+3) on 2026-10-15. Historical UTC conversion uses Europe/Nicosia to handle the seasonal UTC+3/UTC+2 change. The schedule-aware classifier allows small timestamp-label tolerance because the underlying historical OHLC source is Dukascopy, not the user's XM quote feed.

## Method and limitations

- Both policies use the same prepared Dukascopy XAUUSD M5 dataset: 354,305 bars from 2021-10-06 00:00 UTC through 2026-10-04 23:55 UTC.
- All entry filters, signal decisions, stop/target levels, effective-RR floor, risk, spread assumptions, slippage assumptions, and holding-bar limit are held unchanged.
- Legacy policy force-closes at the last observed candle close after any timestamp gap over 15 minutes.
- XM-aware policy carries a position through only recognized scheduled daily maintenance and Friday-to-Sunday closures. Stop gap-through is filled using the first observed reopening price plus modeled slippage; a target crossed by the reopen is credited conservatively at the target less modeled costs.
- Unverified/off-schedule gaps censor the schedule-aware portfolio path; the run is not reported as a complete five-year result if such a gap occurs during an open simulated trade.
- These are modeled results, not a reconstruction of actual XM executions. Dukascopy OHLC is not the actual XM bid/ask stream. The fixed spread/slippage model does not reproduce variable spreads, actual order fills, swaps/rollover financing, or any execution-provider differences. The account specification displays swap terms, but this backtest does not include swap charges/credits.

## Five-year results — baseline costs

| Metric | Legacy prior-close exit | XM schedule-aware | Difference (XM-aware minus legacy) |
|---|---:|---:|---:|
| Closed trades | 4 | 4 | 0 |
| Wins / losses | 1 / 3 | 1 / 3 | — |
| Net profit on 100,000 starting equity | -798.10 | -460.09 | +338.02 |
| Return | -0.798% | -0.460% | +0.338 percentage points |
| Profit factor | 0.038 | 0.446 | +0.409 |
| Expectancy | -0.800 R/trade | -0.459 R/trade | +0.341 R/trade |
| Total R | -3.201 R | -1.837 R | +1.363 R |
| Maximum drawdown | 0.798% | 0.539% | -0.259 percentage points |
| Existing strategy quality gate | FAIL | FAIL | — |

The same four signal/side identities appear under both policies and their portfolio paths were complete under the current censor rule. No unverified gap occurred during those simulated trades.

### Trade that changed

The BUY signal occurred at 2024-03-08 20:50 UTC and entry at 20:55 UTC.

- **Legacy:** forces the position closed at the last pre-weekend candle (21:55 UTC) and reports DATA_GAP, approximately **+0.125 R**.
- **XM schedule-aware:** treats the observed Friday-to-Sunday interval as the scheduled weekend closure; after market data resumes, the model reaches target at 2024-03-10 23:40 UTC and reports **+1.489 R**. Modeled holding time becomes 3,045 minutes (50.75 hours).

This one changed trade explains essentially all the difference between the two baseline portfolios. The later modeled target is not proof that an actual XM account would have received that exact fill; actual XM reopening quotes, spread, and applicable rollover financing were not present in the Dukascopy dataset.

The other three trades are SELL stop-outs and are unchanged by the gap policy.

## Conservative-cost results

| Metric | Legacy prior-close exit | XM schedule-aware |
|---|---:|---:|
| Closed trades | 3 | 3 |
| Wins / losses | 0 / 3 | 0 / 3 |
| Net profit | -871.98 | -871.98 |
| Return | -0.872% | -0.872% |
| Profit factor | 0.000 | 0.000 |
| Expectancy | -1.166 R/trade | -1.166 R/trade |
| Existing strategy quality gate | FAIL | FAIL |

Under conservative costs, the BUY does not pass the effective-RR entry floor, so the two gap policies result in the same three SELL losses.

## Decision

1. The legacy DATA_GAP exit is not a suitable primary assumption for confirmed broker maintenance/weekend closures. Keep it only as a labelled legacy sensitivity.
2. Keep the XM schedule-aware approach as the **research policy**, with the strict rule that undocumented gaps are censored rather than fabricated as exits.
3. **Do not enable live orders, do not deploy a changed strategy, and do not optimize thresholds around this result.** Four baseline trades in five years are nowhere near the 30-trade minimum in the existing quality gate; PF and expectancy also fail that gate.
4. Next meaningful validation should come from forward/paper records using the actual XM MT4 quotes, timestamps, modeled versus observed fills, and applicable swaps. Accumulate a meaningful sample before reconsidering strategy quality.

## Reproducibility

- Five-year workflow: https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38717550878
- Diagnostic tests: https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38717550871
- Artifact: https://github.com/ryousuke5/Gold-AI-Trader/actions/runs/38717550878/artifacts/11963228020
- Draft PR (not merged): https://github.com/ryousuke5/Gold-AI-Trader/pull/49
