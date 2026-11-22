# FXTF MT5 GOLD Migration Runbook

Status: environment discovery first; no production-order authorization.
Target: FXTF MT5 Product CFD, GOLD (FXTF describes the instrument as XAU/USD).
Source platform: XM MT4.
Repository branch: feat/fxtf-mt5-gold-migration
Base: refactor/v19-mt5-portability-foundation

## Non-negotiable safety

- The FXTF account currently logged in by the operator is a live account.
- Do not attach an order-capable EA during migration.
- Keep MT5 Algo Trading OFF while first collecting environment data.
- The environment probe in mt5/tools/FXTF_GOLD_EnvironmentProbe.mq5 is a one-shot Script. It contains no order APIs, no CTrade, no WebRequest and no external network calls.
- Do not enable the existing V19 adapter's signal requests or safety heartbeat until symbol, time, quote, API contract and cost handling have been reviewed.
- Keep auto_trading_enabled=false, execution gates OFF, and no CTrade/order implementation in this migration branch.
- Prefer a separate FXTF demo account for any recurring Forward test. A live-account read-only quote probe is not permission to trade.

## Broker facts to validate against terminal output

Official FXTF MT5 Product CFD information currently states:
- Gold is XAU/USD.
- 1 lot is 1 troy ounce; minimum order size is 1 lot.
- Individual-account margin rate is 5% (20x).
- Gold is not in the zero-spread category.
- The chart time zone is GMT+2 in winter and GMT+3 in summer.
- The trading week is Monday 08:05 to Saturday 06:55 JST in winter, and Monday 07:05 to Saturday 05:55 JST in summer, with weekday maintenance breaks; Saturday maintenance may disconnect the terminal.
- MT5 Product CFD charges an opening-side position-linked fee; the platform History/Deals view is the source to reconcile actual charged commission.

The EA must not hardcode these as a substitute for the active account's symbol specification. Read the actual symbol, digits, point, contract size, tick size/value, volume min/step/max, spread, swap, trade mode, sessions and server UTC offset from the logged-in terminal.

## Phase 1 — one-shot environment probe

1. Fetch this branch in the local repository:
   git fetch origin
   git switch --track -c feat/fxtf-mt5-gold-migration origin/feat/fxtf-mt5-gold-migration
   If the local branch already exists, use git switch feat/fxtf-mt5-gold-migration then git pull.
2. In FXTF MT5, use View > Symbols (or Ctrl+U), locate the Gold/XAUUSD instrument and open its chart.
3. In MT5 choose File > Open Data Folder. Copy mt5/tools/FXTF_GOLD_EnvironmentProbe.mq5 into MQL5/Scripts/GoldAITrader/.
4. Open MetaEditor (F4), open the copied script, compile with F7, and check for 0 errors.
5. In MT5 Navigator > Scripts, Refresh, then drag FXTF_GOLD_EnvironmentProbe onto the XAU/USD chart. This is a one-shot, read-only script; it does not place orders or call Render.
6. In Toolbox > Experts, copy the lines between FXTF MT5 GOLD ENVIRONMENT PROBE BEGIN/END. Do not share login IDs, passwords, API keys or account screenshots showing private account numbers.

If the symbol is not visible, do not guess its name. Use the Market Watch/Specification dialog and report the exact display name and symbol code.

## Phase 2 — parameter freeze and data parity

Do not tune the strategy yet. First record:
- Exact symbol code on FXTF.
- digits, point, contract size, tick size, tick value (profit/loss), volume min/step/max.
- server UTC offset in seconds and M5/H1 completed-bar timestamps.
- bid, ask, spread in both price and points during active market hours.
- broker trade sessions and FXTF maintenance windows.
- opening fee as actually shown in MT5 History > Deals; reconcile whether the deal commission is expressed in account currency per 1 lot or scaled by requested volume.
- swap long/short and rollover behavior.

Then adapt the terminal connector only. Keep the backend strategy gold-m5-h1-v2 and its thresholds unchanged until a broker-specific cost study is complete.

The XM GOLD# history must remain a separate dataset. Never concatenate XM and FXTF bars as if they were one continuous broker feed. Tag all datasets and events with broker, server, exact symbol and account environment class (demo/live; never store account number).

## Phase 3 — MT5 adapter validation

Existing mt5/GoldAITraderV19_MT5_Research.mq5 is a first-pass read-only port. Before it is used:
1. Compile the EA and all includes in MetaEditor 5.
2. Correct compile warnings/errors and add a compile log to the runbook.
3. Validate live terminal UTC conversion against FXTF's GMT+2/GMT+3 published chart timezone. TimeGMT() depends on the PC clock and a Strategy Tester pass alone is insufficient.
4. Compare MT5 and API payload fixtures: closed M5/H1 bars, UTC epoch, chronological order, features, quote snapshot, account currency, contract size, tick value, positions and daily realized P/L.
5. Audit position/deal logic for MT5 netting/hedging and FXTF-specific opening-side commission. The existing generic deal aggregation is not accepted as cost parity until reconciled with MT5 History.
6. Verify quote freshness, spread, weekly reopen / maintenance lock, abnormal tick detection, stable-tick recovery, stale-bar rejection, retry/backoff and duplicate-bar handling.
7. Keep EnableSignalRequests=false and EnableSafetyHeartbeat=false until all local checks pass.

## Phase 4 — controlled forward test and cutover

- Use a dedicated FXTF demo account for any recurring forward/heartbeat testing where possible.
- Ensure the API knows the terminal as broker FXTF and the symbol exactly as supplied by the terminal. No secrets belong in source control.
- The existing API service's market-safety and signal routes must be checked for FXTF's contract/cost model before any network submission.
- Compare the frozen strategy on FXTF-native history and forward ticks. Recalculate spread + opening fee + swap assumptions; don't transfer XM PF/expectancy/DD as FXTF evidence.
- Require an agreed minimum sample, positive expectancy after costs, acceptable max DD, no safety bypass, and stable telemetry before considering a separately reviewed execution feature.
- Retire MT4 only after a documented rollback checkpoint and verified replacement of every required research/data/monitoring function.

## Rollback

Keep the XM MT4 terminal and source/data archive intact until FXTF MT5 has passed:
- successful compilation,
- exact symbol/specification verification,
- UTC and closed-bar parity,
- API payload parity,
- safety-state/restart tests,
- cost-aware IS/OOS results,
- demo Forward verification.

A green GitHub static test is not proof of MetaEditor compilation, broker execution quality, or profitability.
