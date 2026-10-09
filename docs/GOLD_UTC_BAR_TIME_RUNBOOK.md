# Gold UTC Bar-Time Correction Runbook

## Purpose

Render accepted a GOLD M5 signal whose `bar_time` was approximately three hours ahead of the request receipt time. Unix epoch timestamps must represent UTC; broker-server candle times must not be sent as though they were UTC.

This change does not alter H1 trend filters, breakout/retest rules, risk sizing, or execution settings.

## Code changes in this branch

- The MT4 EA estimates the trade-server UTC offset from `TimeCurrent() - TimeGMT()`, rounds to a 15-minute increment, and stops sending a request when the offset is implausible.
- `bar_time`, `recent_m5[].time`, and `recent_h1[].time` are converted to UTC epoch seconds consistently.
- The payload includes `server_utc_offset_seconds` for diagnostics.
- The MT4 Experts log prints `[GOLD UTC DIAG]` with the detected offset, broker server time, terminal GMT time, corrected UTC bar time, and UTC epoch seconds, so the time conversion can be checked before the API guard is deployed.
- The API rejects an invalid, more-than-30-second-future, or stale M5 `bar_time`; the maximum age uses `MAX_SIGNAL_AGE_SECONDS` (default 90 seconds).
- Rejections emit a `[GOLD TIME DIAG]` line with timestamp diagnostics and no credentials.

## Safe rollout order

**Do not deploy the API guard while the old EA is still sending broker-local timestamps.** Those requests will correctly receive HTTP 400 and will not be saved as signals.

1. Keep trading mode at `ANALYSIS` and `auto_trading_enabled=false`. Do not enable live/demo order execution as part of this fix.
2. Open `mt4/GoldAITraderV18.mq4` from this branch in MetaEditor and compile it. A Node.js CI pass does not replace an MQL4 compile.
3. Install the compiled EA on the existing GOLD/XAUUSD M5 chart. Do not run both old and new copies simultaneously.
4. In MT4's **Experts** tab, copy one `[GOLD UTC DIAG]` line. Check that `bar_time_utc` matches the just-closed M5 candle close in UTC and that `bar_time_epoch` is the Unix epoch for that same instant. Compare with a trusted UTC clock; `terminal_gmt` should be close to that clock. The bar close should be near the current time (normally only a few seconds old), not hours ahead.
5. If the offset is wrong, the bar is still in the future by more than 30 seconds, or the terminal clock is not synchronized, stop here and do not merge/deploy. Share the `[GOLD UTC DIAG]` line for diagnosis.
6. Only after the UTC line is verified, merge PR #41 and manually deploy to Render service `Gold-AI-Trader-1`. Auto-deploy is disabled for that service, so an explicit manual deploy is required.
7. Confirm fresh `[GOLD SIGNAL DIAG]` lines resume and no unexpected `[GOLD TIME DIAG]` rejections occur. Keep real orders off while collecting evidence.

## Expected API response for a bad bar time

The API returns HTTP 400 with `error: "invalid_bar_time"` and one of `bar_time_in_future`, `bar_time_too_old`, or `invalid_bar_time`. Correct the timestamp source rather than weakening the validation or the H1 strategy filters.
