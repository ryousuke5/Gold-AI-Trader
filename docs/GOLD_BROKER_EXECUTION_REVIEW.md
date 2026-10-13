# GOLD / EURUSD broker execution data collection and review

This is a research-only data collection path. It does not place, modify, or close orders and it does not change the production strategy or any order gate.

## Why this is needed

The connected Supabase project currently has no rows in `gold_orders` or `gold_trade_results`. Prior strategy studies used assumed fixed spread/slippage and did not have broker-specific historical Ask/spread, actual fill deviations, commission, or swap for each trade.

This recorder exports two raw CSV types from the MT4 terminal:
- Daily quote files containing each distinct observed Bid/Ask tick and the spread for the attached chart symbol.
- A closed-order history file containing actual MT4 open/close prices and broker-reported profit, commission and swap, for the chart symbol.

Do not treat recorder output as historical quotes before the EA was installed.

## Install the read-only recorder in MT4

1. Download `mt4/GoldBrokerExecutionRecorder.mq4` from this branch and copy it into the terminal data folder at `MQL4/Experts/`.
2. Open MetaEditor from MT4, open the file, and compile it. Check the MetaEditor error list; this repository's Linux CI cannot compile MQL4 bytecode.
3. Attach `GoldBrokerExecutionRecorder` to the broker's GOLD/XAUUSD chart. To collect EURUSD too, attach another instance to the EURUSD chart. Leave `RecordOnlyChartSymbol=true`.
4. **Do not turn AutoTrading on just for this recorder.** This EA contains no trade functions; it is intended only to write files.
5. For historic fills, set the MT4 Account History tab to **All History** before starting the recorder. The EA writes closed trades available to the terminal on startup, then adds newly closed trades once. It deduplicates using terminal Global Variables; do not delete the CSV logs while keeping those variables.
6. Keep MT4 running and the chart receiving quotes. Files are written under the terminal's `MQL4/Files/` folder:
   - `gold_broker_quotes_<SYMBOL>_<YYYYMMDD>.csv`
   - `gold_broker_orders_<SYMBOL>.csv`

If the broker uses a symbol suffix (for example `XAUUSD.a`), keep that exact symbol on the chart. The quote and order symbols must match to join.

### Data privacy and storage

The CSV exports contain timestamps, prices, ticket numbers, trade sizes, realized profit, commission/swap, account currency and order comments. The account number itself is not written to the CSV. Treat these as private financial records and do not commit them to the public GitHub repository. Archive them locally before sharing a copy for analysis. Daily quote files can grow while the terminal receives ticks; monitor disk usage.

## Run the offline review

Install Node.js 20 or newer. From the repository root, use:

```bash
node scripts/review-gold-broker-execution.mjs \
  --orders "C:/path/to/gold_broker_orders_GOLD.csv" \
  --quotes-dir "C:/path/to/MT4/MQL4/Files" \
  --outdir "broker-execution-review"
```

The quote directory is scanned for `*_quotes_*.csv`. To select explicit quote files instead, use a comma-separated `--quotes "file1.csv,file2.csv"` and omit `--quotes-dir`. The default quote match tolerance is 10 seconds; override with `--max-quote-distance-sec 2` only when the timestamp precision and feed cadence support it.

Outputs:
- `execution_cost_summary.md`: overall and BUY/SELL-by-symbol summary.
- `execution_cost_summary.json`: full counts and data-quality diagnostics.
- `executions_reconciled.csv`: one audit row for each valid closed trade.
- `summary_by_symbol_side.csv` and `summary_by_server_month_side.csv`: grouped summaries.
- `quote_spread_summary_by_symbol.csv`: mean, median, P90 and maximum of the observed Bid/Ask spread in price and symbol-specific points.

## How costs are calculated

- Actual gross PnL, commission and swap come from MT4 closed-order history. Net PnL is `OrderProfit + OrderCommission + OrderSwap`, as recorded by MT4.
- Entry spread is the matched quote's `Ask - Bid`. Exit spread is measured separately at close.
- The entry executable reference is Ask for BUY and Bid for SELL. At exit it is Bid for closing BUY and Ask for closing SELL.
- The estimated adverse fill deviation is calculated from actual fill price versus the nearest saved executable-side quote. Positive means adverse, negative means favorable.
- The quote time and MT4 order-history time are second-level broker-server timestamps. This match is **only a slippage proxy**, not the exact pre-OrderSend quote. Exact slippage requires the active order-sending EA to log Bid/Ask immediately before sending and to record the returned fill price at the same event.
- Point counts use the MT4 `Point` value for that symbol. They are not assumed to be FX pips.
- `price_based_realized_R` is price movement divided by stop distance. It excludes monetary commission/swap and therefore is not the same as account-currency net R.

Trades whose quotes are missing or outside the timestamp tolerance remain in realized PnL totals but are marked as unmatched for spread/slippage. Missing commission or swap is not silently converted into a known zero.

## Important boundary: live recorder vs historic backtest

The recorder begins collecting Bid/Ask when it is installed. It may still export older closed trades from MT4 Account History, but those old trades will not have matched historical Bid/Ask unless the terminal has a separate broker tick archive for the same period.

This tool verifies **actual account execution history**. It does not claim to be a five-year strategy backtest with variable spread. That second test requires broker tick Bid/Ask coverage over the full research window, aligned to the same strategy bars, and a replay that models fill rules, commission schedules, swaps, contract size and stop-level behavior. A single current spread snapshot is not a historical cost series.

## Current result state

Until the CSV files are collected and ingested, there is no actual-fill result to report. The current Supabase order/trade tables were empty when checked. Keep real-order execution OFF while collecting and reviewing the data.
