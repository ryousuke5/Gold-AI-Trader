# GOLD Market Safety Guard — V19

## Scope

This is an independent pre-entry safety layer for the existing GOLD M5/H1 V2 signal path. It does not alter the V2 setup generator, indicator values, Range ATR bounds, breakout distance, BUY/SELL rules, risk percentage, or the existing spread ceiling of 0.50.

The V18 EA remains unchanged. V19 is a separate monitor-only EA and still contains no order-send/close/modify functions.

## Initial safeguards

- Existing maximum spread remains 0.50 price units.
- A market-data gap of at least 7,200 seconds starts a 30-minute new-entry lock from the first new quote.
- If no prior terminal-global tick timestamp exists, Sunday UTC 20:00–23:59 is treated conservatively as a possible first-observation reopen window.
- A single mid-price change greater than 1.50 price units starts tick-anomaly recovery.
- Recovery requires three consecutive new quote timestamps, each within 0.50 of the prior recovery quote, and each with spread at or below 0.50.
- Quotes older than 30 seconds, invalid quotes, UTC offset failures, and reversed tick timestamps fail closed.
- Tick timestamps, last accepted mid, reopen lock, and anomaly recovery state are persisted in MT4 terminal Global Variables so EA restarts do not silently clear the guard.

## API-side validation

The EA sends a market_safety snapshot with the exact bid/ask quote used in the request. The API checks:
- snapshot presence and completeness
- quote age and future timestamps
- snapshot mid/spread consistency with the signal's bid/ask
- spread ceiling 0.50
- explicit MT4 lock/anomaly state

If any check fails, API returns/persists a WAIT decision for that request, skips OpenAI analysis, and forces risk.approved=false. The deterministic strategy candidate is still retained for diagnostics; it cannot become order-eligible while the safety gate is blocked.

## Validation notes

- Node unit tests cover fresh quotes, missing snapshots, reopen locks, anomaly recovery flags, >0.50 spread, stale/future quotes, and mismatched quote snapshots.
- Static source tests ensure V19 remains monitor-only and the API gate is wired before AI evaluation.
- MT4 compilation and broker-side forward observation still need to be completed in MetaEditor on the user's terminal.
- Render auto-deploy is OFF. This branch is not deployed to either Render Gold service.
- Do not turn on auto trading or real-order execution as part of this safety update.
