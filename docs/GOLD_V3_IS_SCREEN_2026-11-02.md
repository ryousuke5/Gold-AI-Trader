# GOLD V3 — Initial IS Screen (2026-11-02)

## Decision

**REJECT the frozen V3 first-pass configuration for this IS screen. Do not proceed to OOS and do not merge/deploy V3 as a trading strategy.** The candidate frequency increased substantially, but the entry hypothesis did not produce positive expectancy even before modeled costs and deteriorated sharply under the observed-spread cost assumption.

This is a preliminary independent reproduction of the frozen V3 rules, not a CI result and not yet an execution of the checked-in Node replay command. Re-run the repository script below to reproduce before treating these figures as a formal release artifact.

## Dataset and period

- IS window: [2021-10-06 00:00 UTC, 2024-10-06 00:00 UTC).
- Reserved OOS: [2024-10-06 00:00 UTC, 2026-10-05 00:00 UTC). **Not evaluated.**
- Price source: Dukascopy Historical Data Feed, XAUUSD M1 BID aggregated to M5.
- Source dataset: 354,305 M5 rows, from 2021-10-06 through 2026-10-04.
- Data manifest reports 171,295 inactive zero-volume flat M5 rows removed and 1,290 non-weekend gaps greater than 15 minutes.
- H1 bars used for trend filters: only complete UTC hours containing twelve contiguous M5 bars.
- This is not XM GOLD# broker-native history. It is a price-history proxy for an initial hypothesis screen.

## Frequency

| Metric | GOLD V2 reference | GOLD V3 |
|---|---:|---:|
| Raw deterministic candidates | 4 | 3,472 |
| Executed trades in baseline simulation | — | 2,132 |
| Executed trades in stress simulation | — | 2,149 |

V2's candidate count is a read-only comparison using the current production V2 deterministic rules/defaults over the same IS bars. Candidate count is not performance. The V3 frequency objective was achieved on this proxy, but more trades did not translate into better expectancy.

## Performance

One open position per scenario; entry at the next M5 open; maximum hold 96 M5 bars; next-bar entry gap capped at 0.50 ATR; target recalculated to 2R from simulated fill; if stop and target are both touched within one M5 candle, stop is assumed first.

| Metric | Baseline | Stress |
|---|---:|---:|
| Assumed spread (price units) | 0.55 | 0.75 |
| Assumed slippage each side | 0.05 | 0.10 |
| Trades | 2,132 | 2,149 |
| Win rate | 23.31% | 19.87% |
| Profit factor | 0.400 | 0.288 |
| Expectancy (R/trade) | -0.552 | -0.741 |
| Net result | -1,176.4R | -1,591.7R |
| Max drawdown | 1,180.0R | 1,591.7R |
| Positive months | 0 / 37 | 0 / 37 |

Baseline exit counts: 1,548 STOP, 391 TARGET, 193 DATA_GAP. BUY expectancy was -0.277R/trade (1,055 trades); SELL expectancy was -0.820R/trade (1,077 trades).

### No-cost diagnostic

A diagnostic with spread=0 and slippage=0 produced 2,115 trades, 35.18% win rate, PF 0.993, expectancy -0.004R/trade, and net -9.36R. This is not a tradable scenario; it indicates that the fixed 2R exit and entry hypothesis were approximately breakeven before transaction costs, rather than showing a robust gross edge.

At the baseline cost assumptions, modeled round-trip spread plus two-sided slippage averaged approximately 0.374R per trade (median 0.325R). Under stress, it averaged 0.546R (median 0.476R).

As a simple risk illustration, compounding 0.25% current-equity risk per trade with no lockout, the baseline sequence first crossed a 5% peak-to-trough drawdown after 28 trades, on 2021-10-18 19:55 UTC. This is a diagnostic only; the replay did not simulate the production daily-loss/drawdown lockout, and those controls must remain enabled.

## Limitations

1. Dukascopy BID candles are not XM GOLD# quotes; intraday bid/ask path, broker feed differences, and real fills are not represented.
2. The assumed spread/slippage are fixed price-unit scenarios. The available XM quote observation sample is short and is not a full 2021–2024 time-aligned cost history.
3. The source preparation removed inactive flat zero-volume M5 bars. Complete-hour H1 aggregation excludes any hour with one or more missing M5 bars; this can bias which market hours enter the trend series.
4. OHLC replay cannot know intrabar ordering; conservative stop-first handling is used when both target and stop are touched.
5. Swap/financing and account-specific commissions are not modeled.
6. Results below are an independent local reproduction of the frozen V3 rules. The checked-in Node builder, tests, and report commands have not yet been executed in a GitHub runner in this task. GitHub reported no commit status checks for this PR at review time.

## Reproduction with the checked-in Node replay

Extract `xauusd-m5.json.gz` from the existing `gold-xauusd-m5-1825d.zip`, then from the repository root run:

PowerShell:

    $env:GOLD_V3_BACKTEST_DATA_FILE = "C:\path\to\xauusd-m5.json.gz"
    $env:GOLD_V3_START_UTC = "2021-10-06T00:00:00Z"
    $env:GOLD_V3_END_UTC = "2024-10-06T00:00:00Z"
    npm run research:gold:v3:build
    npm run research:gold:v3:report

The OOS period must remain untouched unless a future strategy hypothesis passes a separately frozen IS gate.

## Isolation

- GOLD V2 strategy source and production defaults unchanged.
- `server.js`, Render settings, Supabase, and MT4 V19 unchanged.
- Live 0.50 spread gate unchanged.
- No order execution or real-order permission enabled.
