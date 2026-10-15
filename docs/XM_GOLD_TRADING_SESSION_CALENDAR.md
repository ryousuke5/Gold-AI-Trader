# XMTrading GOLD (MT4) session calendar and historical M5 gap policy

Status checked: 2026-10-15. Scope is the existing XMTrading MT4 instrument `GOLD` / XAUUSD used by Gold AI Trader. This is not the separate `GOLD24-7` product.

## Verified regular schedule

The XMTrading Labo gold-hours article contains a small internal inconsistency: its summary table lists 07:02–05:58 Japan time in summer and 08:02–06:58 in winter, while its explanatory paragraph elsewhere lists 07:05–05:55 and 08:05–06:55. Those values differ by a few minutes, so this guide does **not** assert minute-perfect order availability from the article alone.

XMTrading's separate trading-hours page says MetaTrader server time is GMT+3 in summer and GMT+2 in winter and shows the rollover at 23:59 server time. The robust conclusion is a recurring daily closure of roughly 60–70 minutes around the server-date rollover. For exact account-specific trading and quoting cutoffs, the MT4 Market Watch symbol specification and actual timestamped quotes must take precedence over rounded summaries.

Equivalent expected UTC windows around the server rollover:
- Summer / server GMT+3: rollover is approximately 20:59 UTC; a common hourly-bar-label gap is 21:00→22:00, but some data series can label it a few minutes earlier/later (roughly 20:55–22:05 around the two sides).
- Winter / server GMT+2: rollover is approximately 21:59 UTC; a common M5 label gap is 22:00→23:00, with similar few-minute label variation.
- Weekend: after the Friday close, regular GOLD remains closed until the Sunday reopen. The calendar-time gap is approximately 49 hours, with its UTC hour shifted by the broker's GMT+3/GMT+2 season.

Because the published gold-hour summaries differ by a few minutes, the research classifier requires a 45–90 minute weekday gap near the 23:59 server rollover after resolving Europe/Nicosia's offset; it does not require one exact M5 timestamp pair. This is a conservative **calendar heuristic**, not account-specific proof. The MT4 Market Watch symbol specification and actual timestamped quotes remain the final source of truth; do not treat rounded bar labels as executable cutoffs.

## Current holiday calendar check

XMTrading Labo published an “Important notice – October holidays '26” on 2026-10-01. Its publicly indexed schedule lists changes affecting selected Hong Kong/China, Canadian and Austrian instruments; no GOLD time change is visible in the indexed items for that bulletin. This means no GOLD-specific October change was found in that public notice, not that all unannounced interruptions are impossible.

As checked on 2026-10-15, the public news index's newest relevant holiday-hours notice is the 2026-10-01 October calendar; a November 2026 holiday-hours calendar was not found. The published October list does not visibly specify a GOLD special-hour change. This is a dated public-notice check—not access to the user's private XM mailbox or account-specific terminal. Do not pre-emptively hardcode Thanksgiving or other future special hours without the dated XM announcement. For every future month, use the current official XMTrading Labo notice and record, by symbol and date, any early close, late open, or full closure. If the notice does not specify GOLD, retain the normal session model but still honor observed trading and quote availability.

XM announced `GOLD24-7` on 2026-09-18 as a separate product available on MT5; the notice explicitly distinguishes it from the existing GOLD product. Its weekend hours must not be applied to the current MT4 XAUUSD/GOLD backtest.

## Finalized handling rule for the research backtest

1. **Scheduled daily maintenance** — A Monday–Thursday UTC M5 gap of about 45–90 minutes around the expected GOLD rollover, after resolving Europe/Nicosia's GMT+3/GMT+2 offset, is classified as the normal maintenance break. A few-minute candle-label discrepancy is allowed because the public XM gold-hours article itself differs by a few minutes between summary/explanatory text. Carry open simulated positions across it. At the next observed bar, test gap-through SL/TP at the first available open with conservative spread/slippage. Do not invent a close at the previous M5 close.
2. **Scheduled weekend closure** — A Friday-to-Sunday gap consistent with the normal ~49-hour closure is also expected. Carry open positions across the weekend and model the reopen gap against the first available open. Do not treat this as a missing-feed incident.
3. **Published special schedule** — If the dated XM monthly notice documents an early close/late reopen/holiday closure, record the exact server-time window and source URL in the calendar override ledger. Treat the gap as a planned closure and model reopening fills as above.
4. **Unverified long or irregular gap** — If a gap falls outside the published normal session and an explicit calendar override, classify it as `holiday_extended_or_feed_gap_unverified`, `dst_transition_window_review`, or `irregular_feed_gap_or_session_change`. Censor the primary outcome for an affected event rather than assigning an invented prior-close exit. Keep a separate hold-across-gap sensitivity only when the next observed bar and its prices are reliable.
5. **DST and server-time transition windows** — Around the last Sunday of March/October, and any one-week offset mismatch with the US calendar, do not infer a session exception solely from the hour-of-day. Verify the relevant dated XM notice and MT4 symbol schedule; absent verification, label the gap transition-review/uncertain.
6. **No hindsight closure inference** — The legacy “force close at previous candle close when the next timestamp has a gap” is retained only as a labelled historical sensitivity. It is not the primary model and must not be called executable strategy performance unless the trading rule actually issues a close before market closure.

The primary event-path analysis is therefore the gap-aware hold model for confirmed scheduled pauses/weekends and censored outcomes for unverified market-hours gaps. This still is not portfolio performance: isolated event paths may overlap, M5 OHLC cannot establish intrabar barrier order, and exact-engine non-overlapping simulations remain mandatory before any strategy change.

## Source links

- XMTrading Labo, “XMのゴールドが取引できない理由とは？原因や解決方法を徹底解説” (regular GOLD Japan-time hours): https://fxplus.xmtrading.com/media/2025110701.html
- XMTrading Labo, “取引時間・ロールオーバー” (server GMT+3/GMT+2, seasonal switch, rollover): https://fxplus.xmtrading.com/trading-hours/
- XMTrading Labo, “重要なお知らせ - 10月の祝日'26” (2026-10-01): https://fxplus.xmtrading.com/news/n2026100101.html
- XMTrading Labo, “GOLD24-7が新登場'26” (2026-09-18; separate MT5 product): https://fxplus.xmtrading.com/news/n2026091801.html
- Official XMTrading gold product page: https://www.xmtrading.com/jp/precious-metals
