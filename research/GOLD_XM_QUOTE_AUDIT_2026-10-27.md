# XM Quote Spread Audit — 2026-10-27 Exports

Status: read-only quote analysis. No production settings, Render, Supabase, MT4 EA configuration, or order gates were changed.

## Source files and methods

- `gold_broker_quotes_GOLD__20261027.csv`: 256,920 GOLD# quote observations.
- `gold_broker_quotes_EURUSD__20261027.csv`: 63,822 EURUSD# quote observations.
- Comparison files: `gold_broker_quotes_GOLD__20261023.csv` (253,950 rows) and `gold_broker_quotes_EURUSD__20261026.csv` (25,096 rows).
- Bid, Ask and spread fields were cross-checked. Spread was independently calculated as Ask − Bid; EURUSD pips are `(Ask − Bid) × 10,000` (5-digit symbol; 1 pip = 0.0001).

Important limitation: the broker_quotes files do not contain account server/company fields, so the specific account provenance is not established by these files alone.

## GOLD# — 2026-10-27

- Coverage (UTC estimate): 2026-10-26 22:00:02 to 2026-10-27 20:58:59; this is not a full 24-hour continuous market session.
- Rows: 256,920; invalid Bid/Ask rows: 0; spread arithmetic discrepancies greater than half a point: 0; exact duplicate rows: 0; duplicate tick-sequence IDs: 0.
- Spread-price mean 0.2551; median 0.26; P90 0.27; P95 0.28; P99 0.29; P99.9 0.29; min 0.20; max 0.41.
- Quote observations at or below spread 0.30: 99.950%; at or below 0.50: 100%.
- Most hourly medians were 0.25–0.27. UTC hour 22 was median 0.27 / P95 0.29 / max 0.41; UTC hour 0 was median 0.28 / P95 0.29.
- The configured GOLD spread cap of 0.50 would admit all observations in this file. This is only a snapshot quote-count statistic, not proof that entries or trades would be profitable.

## GOLD# — cross-source consistency check

The 2026-10-27 export was compared with the previously uploaded `GOLD_KIWAMI_SpreadLog.csv` and the 2026-10-23 quote export over their overlapping time interval **2026-10-22 22:00:02 to 2026-10-23 05:44:02 UTC**:

- KIWAMI logger: 89,259 observations in overlap; median 0.26, mean 0.2606, P95 0.29, max 0.41.
- 2026-10-23 broker quote export: 88,982 observations in overlap; median 0.26, mean 0.2606, P95 0.29, max 0.41.
- On 24,795 matching UTC-second groups, the median spread was exactly equal in 99.69% of groups; median absolute difference was 0.00 and P95 absolute difference was 0.00 price units.

This provides strong consistency between those two captured streams during the overlap. It does **not** establish that the data represents all days, all account types, or fills.

## EURUSD# — 2026-10-27

- Coverage (UTC estimate): 2026-10-26 22:00:00 to 2026-10-27 21:57:35.
- Rows: 63,822; invalid Bid/Ask rows: 0; spread arithmetic discrepancies greater than half a point: 0; exact duplicate rows: 0; duplicate tick-sequence IDs: 0.
- Spread mean 1.1095 pips; median 1.1; P90 1.2; P95 1.2; P99 1.5; P99.9 4.9; min 0.8; max 10.8 pips.
- Quotes at or below 1.2 pips: 88.427%; at or below 1.5 pips: 98.916%; above 5 pips: approximately 0.097%.
- UTC hour 21: 490 observations, median 3.6 pips, P90 4.6, P95 5.41, max 8.9.
- UTC hour 22: 662 observations, median 1.3 pips, P95 4.79, max 10.8.
- Most hours from UTC 00–20 had median around 1.0–1.2 pips. The wider spreads and outliers around UTC 21–22 should remain visible in spread/time filters rather than be averaged away.

The 2026-10-26 file is a partial sample: 25,096 rows from estimated UTC 2026-10-25 22:00:01 through 2026-10-26 09:25:27; median 1.1 pips, P95 1.3, max 7.5. It does not cover a full server day.

## Important comparability caveat

An earlier 2026-10-14/16 EURUSD audit found median spreads around 2.1 pips, whereas these 2026-10-26/27 exports show 1.1 pips. Because current broker_quotes files lack account-server/company identity and the samples are from different dates, do not assume the cause; reconcile terminal/account provenance before changing a strategy threshold.

Likewise, a separate earlier short GOLD sample (2026-10-13–16) was summarized with median near 0.55, while the 2026-10-22–27 captured streams above center near 0.26. This newer stream is consistent across files over the checked overlap, but the account/source provenance and cross-period difference still need to be explicitly reconciled.

## Decision and next steps

1. Do not raise or lower production spread caps from these quote snapshots alone. Keep production and real-order gates unchanged.
2. Repeat quote captures over several full trading weeks and make sure each file retains account company/server, symbol, timestamp, and capture method.
3. Compile and smoke-test `GOLD_DemoExecutionCostLogger.mq4` in MetaEditor and an XM **demo** terminal with `EnableDemoProbeOrders=false` first.
4. Only after the non-order logger/account guard is validated should separate, manual demo probe orders be considered. Measure requested versus filled prices and close price, and read commission/swap from closed demo history. These records will estimate fills/costs; they do not validate strategy profitability.
5. Re-test any candidate only with a frozen strategy and pre-registered IS/OOS gates; no tuning of rejected hypotheses on their old IS window.

No live orders, production spread-cap changes, deployment, or strategy promotion was performed.
