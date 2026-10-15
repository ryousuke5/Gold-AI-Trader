# XM MT4 GOLD history export (research only)

This script only exports the broker's locally available MT4 bar history to CSV. It contains no order-entry, order-modification, or order-closing calls.

## How to run

1. On XM MT4, open the regular **GOLD, M5** chart (not a separate GOLD24-7 product).
2. In MT4 select **File → Open Data Folder**, then open `MQL4\\Scripts`.
3. Copy `GOLD_MT4_History_Export.mq4` into that folder. Open MetaEditor with F4, open the script, and compile. If the compiler reports any errors or warnings, do not run it; send the messages for correction.
4. Before exporting five years, ensure MT4 has enough bars downloaded. In **Tools → Options → Charts**, set “Max bars in history” and “Max bars in chart” high enough. In History Center (F2), select the broker's **GOLD → M5** history and download if available. Reopen the GOLD M5 chart and scroll back toward the start of the requested range if necessary.
5. Run the script from the Navigator’s **Scripts** section on the GOLD chart. The default requested interval is 2021-10-06 through (but excluding) 2026-10-05 in the broker/server clock. You may edit these inputs. The script reports the number of bars copied and written, plus the first/last server timestamps, in the **Experts** or **Journal** tab.
6. The CSV is saved under **File → Open Data Folder → MQL4 → Files → GOLD_M5_XM_Broker_History.csv**. Compress the CSV (ZIP is fine) and share it with the research conversation. Include the final “XM HISTORY EXPORT COMPLETE” log line.

## What counts as usable data

- Do not assume that the requested date range was available merely because a CSV was created. Check the `written` bar count and first/last timestamps in the log.
- The exported `server_time` is broker/server wall time, not UTC. Historical conversion must account for XM's seasonal server offset; do not apply today's UTC offset to all past bars.
- Per-bar `spread_points` can be used only when the broker actually supplies historical spread values. Zero or missing values are not proof that real spread was zero. A M5 OHLC export cannot recover every historical bid/ask tick or guarantee the historical executable spread.
- Do not attach this file to a live-trading EA. The exporter is a standalone script and makes no trades.

## Research boundary

The export is for source/execution validation only. No strategy parameters are changed, no Render deployment is triggered, and real order execution stays OFF. First validate timestamp conversion, gap classification, historical coverage, and spread fields; only then rerun strategy comparisons on the broker-native sample.
