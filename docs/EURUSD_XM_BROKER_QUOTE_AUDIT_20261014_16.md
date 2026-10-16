# EURUSD XM Broker Quote Audit — 2026-10-14 and 2026-10-16

Status: research-only audit of two user-supplied broker quote CSVs. The raw quote files are not committed to the repository; only aggregate counts and diagnostics are recorded here. No production configuration was changed.

## Data integrity

- Files observed: server-date exports for 2026-10-14 and 2026-10-16.
- Total quote observations: 175,725 (89,321 + 86,404).
- One symbol in both files: EURUSD; 5-digit price, point 0.00001.
- Server-time coverage: 2026-10-14 00:00:00–23:59:59 and 2026-10-16 00:00:00–23:57:00.
- Invalid quotes (bid/ask non-positive or ask below bid): 0.
- Duplicate full rows: 0.
- Spread-price and spread-point columns agree with ask minus bid: 0 mismatches.
- Server timestamps stay chronological within each file. The 2026-10-14 tick_sequence counter resets twice, so sequence IDs should not be treated as globally unique for that file.
- server_utc_offset_seconds varies from 10,799 to 10,802 in the 2026-10-14 file and 10,800–10,801 on 2026-10-16. timestamp_utc_estimate is suitable for coarse hour buckets, not sub-second precision.

Pip conversion: EURUSD 1 pip = 0.0001 price; in the supplied 5-digit quotes, 10 points = 1 pip. Spread was independently computed as (ask − bid) × 10,000.

## Observed spread

| Server date | Observations | Mean | Median | P90 | P95 | P99 | Min | Max | At/below 1.20 pips |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-10-14 | 89,321 | 2.07 | 2.10 | 2.20 | 2.20 | 2.30 | 1.60 | 14.40 | 0.00% |
| 2026-10-16 | 86,404 | 2.13 | 2.10 | 2.20 | 2.30 | 2.90 | 1.60 | 14.40 | 0.00% |
| Combined | 175,725 | 2.10 | 2.10 | 2.20 | 2.20 | 2.60 | 1.60 | 14.40 | 0.00% |

## Quote-observation shares by hypothetical gate

The shares below describe quote observations only. They are not trade-candidate pass rates, backtest PnL, or a recommendation to change the live gate.

| Max spread gate | Observations at/below gate | Share |
|---:|---:|---:|
| 1.20 pips (current monitor setting) | 0 | 0.00% |
| 1.80 pips | 2,938 | 1.67% |
| 1.90 pips | 10,960 | 6.24% |
| 2.00 pips | 61,066 | 34.75% |
| 2.10 pips | 79,241 | 45.09% |
| 2.20 pips | 149,663 | 85.17% |
| 2.30 pips | 172,365 | 98.09% |
| 2.50 pips | 173,888 | 98.95% |

## Intraday observation

Using the supplied UTC estimate:
- UTC 21:00–21:59: 620 observations, median 6.10 pips, P90 8.50 pips, maximum 14.40 pips.
- UTC 22:00–22:59: 2,027 observations, median 2.30 pips, P90 3.40 pips.
- Most other UTC hours were around 2.00–2.20 pips median.

UTC 21:00 corresponds approximately to the server-day rollover in this UTC+3 sample. This short two-date sample suggests a pronounced rollover widening, but it is not enough to establish a durable calendar/session filter. The sample is event/quote weighted; counts can reflect quote-update frequency and should not be treated as independent observations.

## Interpretation and next action

1. The dashboard's 1.20-pip cap is below every observed spread in these two files, matching the report that spread filtering rejected all 200 recent EURUSD diagnostics. Under the current gate, the monitor is expected to remain WAIT for spread reasons when quotes resemble these samples.
2. Do not raise the production/live gate just to produce signals. The EURUSD strategy has not yet demonstrated positive net expectancy, and a more permissive spread gate can admit trades whose edge is still weaker than their transaction costs.
3. Keep real orders OFF. Research a one-factor spread policy only after obtaining a longer broker-native quote sample (multiple weeks and varied weekday/session regimes). Candidate thresholds should be evaluated with historical signal timestamps, cost and spread/ATR constraints, and both baseline and conservative costs.
4. Consider a separate explicit rollover exclusion window in research, but do not hardcode it based only on two days. Use server-time/UTC conversion consistently and classify the timezone estimate as approximate.
5. Keep raw quote snapshots out of the repository. The two source CSVs remain user-provided conversation files; only aggregate statistics are stored here.

No strategy parameters, Render config, or live-order settings were changed by this audit.
