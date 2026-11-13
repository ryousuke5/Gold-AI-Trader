# GOLD EA Profitability and Promotion Gates

**Purpose:** build a broker-realistic, reproducible EA that has evidence of positive expectancy. Profit is a target, never a guarantee.

## Non-negotiable process

- Keep GOLD V2 Strict as the production reference. Pullback and Halfback remain research variants.
- Do not select a strategy based on candidate count, win rate alone, one good month, or a single backtest.
- Do not tune thresholds on the already-consulted 2024–2026 OOS sample. It is a historical robustness reference only.
- Freeze each candidate, configuration hash, data range, and cost model before evaluation.
- Preserve every rejected signal, blocked trade, executed trade, and exit with a reason code.
- A failed safety gate blocks trading; it is never bypassed to increase sample size.
- Research EA and production EA stay separated. No live-order path is enabled by default.

## Evidence gates

### Gate A — Research correctness
- Bid/Ask domains are explicit for every entry trigger, stop trigger, target trigger, and fill.
- Risk per trade uses the effective entry-to-stop fill distance, with spread/slippage/commission accounted for.
- Same-bar conflicts, gaps, weekend reopen, quote staleness, symbol digits, tick size/value, and DST are tested.
- Unit tests and fixed-data reruns pass. A backtest cannot proceed on malformed or insufficient data.

### Gate B — Historical candidate screen
Initial screen only; it does not authorize demo/live trading:
- At least 100 completed trades in IS; report BUY and SELL separately.
- Net expectancy after conservative costs > +0.10R per trade.
- Profit factor >= 1.20.
- Max drawdown <= 5% at 0.25% planned risk per trade.
- Positive expectancy in both IS halves and at least 3 calendar years with meaningful trade count.
- Include variable-spread sensitivity and a commission/swap model. If broker cost history is missing, mark the result incomplete, not passed.

### Gate C — Fresh forward paper / signal shadow
- Freeze the strategy before collecting new data. The paper window starts after the freeze date.
- Minimum 100 closed signal-trades and at least 6 calendar months; extend the window if frequency is too low.
- Require positive net expectancy after measured broker spread, commission, swaps, and slippage; PF >= 1.20; max drawdown <= 5%.
- Compare planned versus observed entry, stop and target execution by BUY/SELL. Explain any systematic mismatch.
- Publish a complete trade ledger and immutable config/version identifier.

### Gate D — MT4 demo execution
- Only after Gates A–C pass, enable a separate demo-only execution build with independent explicit permission.
- Verify broker symbol contract, tick value, tick size, lot step, minimum lot, stop/freeze levels, margin and account-currency conversion.
- Size down to the lot step. Never round risk upward; block if minimum lot exceeds the risk cap.
- Keep risk at or below 0.25% per trade, daily loss lock at 2%, equity drawdown lock at 5%, spread cap at 0.50 price units.
- No martingale, grid, averaging down, automatic recovery, or hidden retries.

### Gate E — Real-money release review
- Separate written approval after a further forward-demo sample and an independent review of the complete ledger, code hash, broker execution, recovery behavior, and kill switch.
- Real-order gate remains OFF until that explicit approval.
- Passing a historical backtest alone is never sufficient.

## Required report for every candidate

Include: fixed strategy parameters and source hash; data source and date coverage; bar-quality/gap checks; trade count by side; gross and net P/L; PF; expectancy in R; win rate; max equity drawdown; daily-loss locks; exit reason; spread/slippage/commission/swap sensitivity; monthly/yearly stability; and all rejected/blocked candidates.

## Current status

- Production baseline: GOLD V2 Strict; ANALYSIS; automatic trading disabled; real-order gate OFF.
- Alternative entry modules: research-only and not promoted.
- Execution-price contract: BID-based technical levels with executable-side fills.
- Historical cost scenarios currently model spread and slippage, but not broker commission/swap or time-varying spread. The current corrected rerun must not be described as fully broker-realistic until those are added.
