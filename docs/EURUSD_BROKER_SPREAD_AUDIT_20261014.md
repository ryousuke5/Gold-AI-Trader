# EURUSD Broker Quote Spread Audit — 2026-10-14

**Research-only source audit.** Based on the user-uploaded one-day quote snapshot file `gold_broker_quotes_EURUSD_20261014(2).csv`. The raw file is not committed to the repository. No strategy, Render or real-order setting was changed.

## Data scope and integrity

- 89,321 EURUSD quote snapshots, broker/server wall time 2026-10-14 00:00:00–23:59:59.
- The terminal indicated UTC+3 on this date; converting server wall time with Europe/Nicosia gives 2026-10-13 21:00:00–2026-10-14 20:59:59 UTC.
- EURUSD is 5-digit quoted with point 0.00001, so 10 points = 1 pip.
- The source's 12 original columns have no null cells; Ask is never below Bid; spread_price matches Ask − Bid within floating precision; server timestamps are chronological.
- 52,144 rows share a server timestamp with another quote; repeated timestamps are expected for a quote stream, and rows are not independent, evenly time-weighted samples.
- 27 intervals between adjacent records exceed 60 seconds; the maximum interval is 486 seconds.

## Spread distribution

Spread pips were computed as the broker-reported spread_points / 10 to avoid binary floating-point edge errors.

| Statistic | Value |
|---|---:|
| Mean | 2.066 pips |
| Median | 2.1 pips |
| P90 | 2.2 pips |
| P95 | 2.2 pips |
| P99 | 2.3 pips |
| Minimum | 1.6 pips |
| Maximum | 14.4 pips |
| Observations above 5 pips | 146 (0.163%) |

### Captured quote rows that pass a maximum spread gate

| Gate | Passing rows | Share |
|---:|---:|---:|
| 1.2 pips | 0 / 89,321 | 0.00% |
| 2.0 pips | 42,026 / 89,321 | 47.05% |
| 2.1 pips | 71,887 / 89,321 | 80.48% |
| 2.2 pips | 85,875 / 89,321 | 96.14% |
| 2.3 pips | 88,650 / 89,321 | 99.25% |
| 2.5 pips | 88,650 / 89,321 | 99.25% |
| 3.0 pips | 88,940 / 89,321 | 99.57% |

The current EURUSD monitor threshold of 1.20 pips admits **0 of the 89,321 recorded quotes** in this one-day sample; the minimum observed spread is 1.6 pips. The uploaded data supports the diagnosis that the current spread filter is a hard blocker under these quote conditions. It does not prove what the correct long-run production threshold should be.

## Session notes (MT4 server hour)

| Server hour | Rows | Mean | Median | P90 | Maximum |
|---:|---:|---:|---:|---:|---:|
| 00:00–01:00 | 269 | 5.23 | 4.8 | 7.46 | 14.4 |
| 01:00–02:00 | 486 | 2.31 | 2.1 | 2.30 | 5.5 |
| 02:00–03:00 | 549 | 2.02 | 2.0 | 2.10 | 2.2 |
| 09:00–10:00 | 2,434 | 1.89 | 1.9 | 2.00 | 2.2 |
| 10:00–11:00 | 3,622 | 1.90 | 1.9 | 2.00 | 2.3 |
| 15:00–16:00 | 11,682 | 2.13 | 2.1 | 2.30 | 14.4 |
| 16:00–17:00 | 11,533 | 2.10 | 2.1 | 2.20 | 2.6 |
| 23:00–00:00 | 1,839 | 2.12 | 2.1 | 2.30 | 4.0 |

- Server hour 00: mean 5.23, median 4.8, P90 7.46 and maximum 14.4 pips; keep this around-rollover period analytically separate from regular-hour spread.
- Server hour 15 also has a 14.4-pip outlier, demonstrating that spikes are not confined to the first server hour.
- Excluding server hours 23, 00 and 01 leaves 86,727 rows with mean 2.054, median 2.1 and P90 2.2 pips. These are row-weighted stats, not the percent of wall-clock time available at each spread.

## Timestamp caveats

- `timestamp_server_epoch` equals the epoch representation of the server wall-clock text treated as though it were UTC. It is **not a genuine UTC timestamp** for this server-time export and must not be used directly in UTC backtests.
- `timestamp_utc_estimate` is close to a timezone-aware conversion on this date, but its difference from `timestamp_server` localized to Europe/Nicosia is between −2 and +1 seconds.
- `server_utc_offset_seconds` ranges from 10,799 to 10,802 seconds due second-resolution sampling jitter. That is not a true timezone change.
- Convert `timestamp_server` using Europe/Nicosia's date-aware timezone history; do not treat the noisy per-row offset as exact.
- `tick_sequence` resets within the recording and is not a unique global key.

## Decision

1. Keep real orders OFF and **do not change the live 1.20-pip setting from a one-day sample**.
2. In a separate, frozen research replay, compare 1.2 / 2.0 / 2.2 / 2.5 pips as scenarios and preserve the existing spread-to-ATR gate. Report trade count, PF, expectancy, drawdown, and baseline/conservative costs; a more permissive gate is not automatically a better strategy.
3. Collect 10–20 trading days (preferably more) including rollover and ordinary sessions, correcting the UTC timestamp export first. Keep spread outliers rather than deleting them.
4. This file is quote snapshots for one day, not a five-year M15 OHLC dataset, so it cannot establish strategy profitability.

## Reproducibility

- Analysis source: user-uploaded `gold_broker_quotes_EURUSD_20261014(2).csv` (not committed).
- Hourly data table for this one day: `EURUSD_Broker_Quote_Hourly_Spread_20261014.csv` (delivered separately in the conversation).
- No changes to production configuration, no Render deployment, and no live order execution.
