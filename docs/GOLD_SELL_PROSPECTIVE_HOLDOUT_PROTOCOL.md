# GOLD SELL execution audit and prospective holdout protocol

Status: research-only, preregistered for future data. Do not use this protocol to enable live orders.

## Broker-session source of truth

The evaluated instrument is the existing XMTrading MT4 `GOLD` / XAUUSD, not `GOLD24-7`. XMTrading Labo publishes regular GOLD trading hours as 07:02–05:58 Japan time during summer time and 08:02–06:58 during winter time; the MetaTrader server clock switches between GMT+3 and GMT+2. This implies a daily server-time pause from about 23:58 to 01:02 and a normal Friday-close-to-Sunday-reopen interval of about 49 hours. See `docs/XM_GOLD_TRADING_SESSION_CALENDAR.md` for conversions and official sources.

The 2026-10-01 XM October holiday notice did not show a GOLD-specific schedule adjustment in the published/indexed list. No November 2026 holiday-hours notice was found in the public news index as of 2026-10-15, so future special hours must be entered only when XM publishes the dated notice. Do not apply the separate MT5 `GOLD24-7` calendar to MT4 GOLD.

## Finalized gap-handling protocol

- A same-weekday 45–90-minute gap matching the regular XM GOLD maintenance window after accounting for Europe/Nicosia GMT+3/GMT+2 is `scheduled_daily_maintenance`; it is not a feed outage.
- A Friday-to-Sunday gap of approximately 46–54 hours is `scheduled_weekend_closure`.
- A gap documented by the dated XM holiday bulletin is a planned special closure, with the schedule URL recorded in the calendar override ledger.
- Extended gaps, DST-transition mismatches, and non-recurring gaps not explained by the published schedule are classified as unverified and censored in the primary event outcome. Do not assume the event was closed at the previous candle close just because the next timestamp has a gap.
- For confirmed daily/weekend pauses, keep the simulated position open across the closure and test the first observed reopen price against SL/TP, including conservative spread and slippage. An adverse SELL gap through SL is filled at the first observed open plus spread/slippage; a gap through TP is filled at TP plus spread/slippage, without price improvement. Keep prior-close forced exit only as a labelled legacy sensitivity.
- The 60-minute outcome is a 60-minute clock-time outcome, not 12 bars of active trading; when the interval intersects a planned closure, the elapsed wall-clock interval must be used or the outcome censored. Do not count the closure as live price evolution.

## Historical audit result (dataset through 2026-10-04 UTC)

The historical five-year window and its recent subperiods have already been inspected in prior reports. None of them is an untouched holdout now.

The five-year expanded SELL-breakdown universe contains 1,897 isolated event paths. The stop-distance calculation from signal close to stop price reconciles with the stored `stop_atr` values with zero numerical discrepancy. Only 54/1,897 events (2.85%) pass the current 0.8–2.0 ATR reference stop-distance gate; 1,843/1,897 (97.15%) have a reference stop distance above 2.0 ATR. This is a restrictive gate, not a detected arithmetic bug.

There are 1,291 M5 timestamp gaps longer than 15 minutes in the dataset:
- 990 repeat at commonly recurring UTC time pairs (schedule-like, not proof of an official market-session calendar);
- 265 are long weekend/holiday-like closures;
- 36 are irregular or uncertain.

The current historical event model exits at the prior candle close whenever the next observed M5 bar is more than 15 minutes later. For the 1,897 isolated events at baseline costs, that model produces mean -0.156R and PF 0.731. A conservative hold-across-gap sensitivity model that checks the first available reopen price produces mean -0.269R and PF 0.637. In the 517 events whose first gap was in a recurring schedule-like time window, prior-close exit produced +0.142R / PF 1.919, while the gap-aware hold model produced -0.253R / PF 0.600. These are isolated, overlapping event paths—not portfolio performance—but they show that gap handling is a major source of model sensitivity.

## Holdout boundary

Begin observing only complete new data after this protocol is committed. Do not reuse any bars up to and including 2026-10-04 for confirmation. Partial data already accrued between the historical data end and the protocol commit must be excluded from confirmatory scoring; it may be shown separately as a development check.

Do not choose bins, session windows, stop levels, or RR thresholds after viewing new holdout outcomes. Do not revise the strategy or environment variables during the holdout.

## Frozen SELL event universe

An event is the first M5 close below the preceding 12-bar rolling range low after the immediately preceding close was at or above its own prior rolling range low, provided that:
- the prior range width is 0.8–2.8 times M5 ATR;
- completed H1 close is below H1 EMA20;
- completed H1 RSI14 is 28–50;
- signal hour is within 07:00–20:59 UTC;
- signal and next M5 entry bars are contiguous.

To reduce overlap, keep the first eligible event and suppress a further event for the same direction until 96 M5 bars have elapsed. Preserve every skipped event in the event ledger with its suppression reason. This broader event universe is not itself the production strategy and is never sent to MT4.

## Frozen features and primary outcome

Primary outcome: 60-minute close movement after the modeled next-M5-open entry, expressed in R using the reference stop distance determined at the signal. Report both ATR-normalized price movement and R-normalized movement; they are descriptive price-path metrics, not realized trade PnL.

Secondary outcomes: 15/30/90/120-minute close movement, MFE/MAE, first stop/target touch within 96 bars, and isolated barrier result using stop-first intrabar convention. Do not infer intrabar order from M5 OHLC when both barriers fall within one candle.

Pre-fixed feature bins:
- H1 close below EMA20 distance, absolute value in H1 ATR: <0.50, 0.50–0.99, and >=1.00.
- H1 EMA50 minus EMA200, signed in H1 ATR: <=-1.00, -1.00 to -0.25, -0.25 to 0, and >=0.
- M5 downside breakout width / ATR: <0.15, 0.15–0.249, and >=0.25.
- Absolute M5 body / ATR: <0.60, 0.60–0.799, and >=0.80.
- M5 volume / preceding 12-bar average: <1.15, 1.15–1.349, and >=1.35.
- UTC entry hour: 07–11, 12–15, 16–19, and 20.

These are fixed exploratory bins based on historical discovery; any claims from them must be called prospective replication, not wholly novel hypotheses.

## Frozen execution and cost assumptions

Run two cost scenarios only:
- Baseline: spread 0.50 and slippage 0.05 price units.
- Conservative: spread at least 0.75 and slippage at least 0.10 price units.

Use the gap-aware hold simulation as the primary conservative event-path scenario: an adverse SELL open beyond the stop is filled at the first observed open plus spread and slippage; an open through target is filled at target plus spread and slippage, without price improvement. Use the prior-close forced-exit model only as a labelled sensitivity. If an irregular gap is not classifiable, separately censor affected outcomes; do not silently price them at the prior close.

These isolated event paths can overlap across features and must not be reported as a strategy-level PF, expectancy, or drawdown. Any promising result must be re-run in a non-overlapping exact-engine trade sequence before it can be considered a strategy candidate.

## Minimum data and decision rule

- Collect at least 100 non-overlapping SELL events overall, with at least 30 events in each feature group used for a comparison. If those sample sizes are not reached within 180 calendar days, call the holdout inconclusive; do not lower thresholds or pool in previously inspected data.
- Primary comparison is the mean 60-minute close-move R difference between a pre-named feature group and its pre-named comparator. Compute a week-block bootstrap 95% confidence interval to reduce dependence from clustered market days.
- A feature may be retained for a *separate research candidate* only if its direction is consistent in each of two sequential halves, the 95% block-bootstrap interval for the primary difference excludes zero, and the conservative gap-aware result does not reverse the sign.
- Do not change production filters based on a favourable subgroup alone. After this event-study gate, any candidate must pass a separate exact-engine backtest, untouched forward paper monitoring, trade-count/PF/expectancy/drawdown gates, and manual review.

## Safety / deployment boundary

This document and the associated scripts are research-only. Keep PR #49 in Draft, keep Render deployment untouched, and keep real orders OFF. No result in this audit authorizes a production parameter change.
