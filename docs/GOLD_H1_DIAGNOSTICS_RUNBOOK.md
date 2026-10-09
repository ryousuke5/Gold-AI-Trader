# Gold H1 Runtime Diagnostics Runbook

## Purpose

The Gold V2 runtime must keep real orders disabled while the deterministic rule filter is evaluated. The H1 gate currently rejects all in-session candidates in the reported sample, so the next step is to identify which exact H1 conditions fail—not to relax thresholds by guesswork.

## Render log event

After a Gold signal and its risk record have been persisted successfully, the server emits one compact JSON line with the prefix:

[GOLD SIGNAL DIAG]

The line includes signal ID, completed M5 bar time, strategy version, candidate, decision, setup reason, risk approval, runtime mode, and H1 diagnostic values. H1 diagnostics include normalized price/EMA distances in H1 ATR units, RSI and its configured bands, directional condition booleans, and lists of failed components. Range ATR values are included when they are available.

The log intentionally excludes the raw request body, raw market prices, account balance/equity, and API/database secrets. Requests that fail before both signal and risk persistence do not produce a success diagnostic line.

## Interpreting the H1 fields

- up_failure_components shows why a BUY trend is not eligible.
- down_failure_components shows why a SELL trend is not eligible.
- A given signal may fail several components on both sides. These are overlapping blockers, not additive sequential counts.
- close_vs_ema20_atr, ema20_vs_ema50_atr, and ema50_vs_ema200_atr reveal how far price/EMA relations are from their required direction, normalized by H1 ATR.
- A missing h1 object is expected for session-filter rejects or invalid setup inputs; it is not by itself proof of a trend bug.

## Safe decision process

1. Collect a sample containing enough in-session H1 rejections.
2. Aggregate each up_failure_components / down_failure_components value and inspect the normalized distance distributions.
3. Verify that the dominant blocker is consistent with the actual completed H1 market structure.
4. Only then build a research-only candidate variant and compare it on a fixed 3-year in-sample / 2-year out-of-sample split, including conservative transaction costs and drawdown.
5. Do not change production H1 thresholds or enable real orders based solely on this runtime sample.

## Operational safety

Current mode remains ANALYSIS and auto trading remains OFF. This logging change does not alter candidate generation, AI invocation rules, risk controls, database writes, or order execution.
