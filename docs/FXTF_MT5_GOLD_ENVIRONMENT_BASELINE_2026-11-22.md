# FXTF MT5 GOLD Environment Baseline — 2026-11-22

Capture source: user-provided MT5 Experts log from 2026-11-22.
Capture was made on the FXTF MT5 account already logged in by the operator.
No account login number, password, API key or other credential is recorded here.

## 1. Result

The one-shot `FXTF_GOLD_EnvironmentProbe` script ran successfully on XAUUSD charts with both H1 and M5 timeframes. The output is consistent across the shown runs.

| Field | Observed value |
|---|---:|
| Company | Goldenway Japan Co., Ltd. |
| Server | FXTF-MT5 |
| Deposit currency | JPY |
| Account leverage | 20 |
| Terminal symbol | XAUUSD |
| Description | Gold (one troy ounce) vs United States Dollar |
| Base / profit / margin currency | XAU / USD / XAU |
| Digits | 2 |
| Point | 0.01 |
| Contract size | 1 |
| Tick size | 0.01 |
| Tick value / profit / loss | 1.58565 (JPY account currency) |
| Volume min / step / max | 1 / 1 / 500 lots |
| Volume limit | 10,000 |
| Trade mode enum | 4 |
| Calculation mode enum | 0 |
| Order mode flags | 63 |
| Filling mode enum | 1 |
| Stops level | 50 points = 0.50 price |
| Freeze level | 0 |
| Floating spread flag | true |
| Observed bid / ask | 3535.01 / 3535.20 |
| Observed spread | 0.19 price = 19 points |
| Swap long / short | -60.125 / +35.073 |
| Swap mode enum | 1 = points |
| Server UTC offset | +7,200 seconds (UTC+2) |
| M5 history bars | 62,786 |
| H1 history bars | 5,271 |

The trade session query returned days 1-5 with broker-time raw values 3,900 to 86,100 seconds, i.e. 01:05 through 23:55 server time.

## 2. Timestamp interpretation

At probe time, `TimeTradeServer()` was 2026-11-22 06:46:51 and `TimeGMT()` was 2026-11-22 04:46:51, giving +7,200 seconds. The terminal current/last quote time and the symbol's last tick were still 2026-11-20 23:54:59 server time.

The probe ran on Sunday while the gold CFD market was closed. The stale last quote is therefore consistent with the weekend trading closure; it is not proof that the local PC clock is wrong. The V19 Research EA log also reported quote_stale and tick_time_reversed while no new quote had arrived. Recheck those guards during the next active FXTF market session before diagnosing a code defect.

## 3. Costs that must be modelled separately

The retrieved MT5 symbol metadata reports `SYMBOL_SWAP_MODE=1`, which means swap values are points, not JPY cash amounts. The broker's published conversion formula for one-day XAU/USD swap is:

`swap points × trade quantity × trade unit × minimum price unit × USD/JPY close rate`.

Use the FXTF published formula and the correct rollover-day multiplier; do not treat -60.125 or +35.073 as a direct JPY cash amount.

The broker's current individual MT5 commodity CFD disclosure lists XAU/USD opening-side position-linked fees:
- Same-side combined position plus new-order quantity 0–1 lots: JPY 0 per lot.
- 2–200 lots: JPY 24 per new order lot.
- 201–1,000 lots: JPY 32 per new order lot.
- 1,001–2,000 lots: JPY 36 per new order lot.
- 2,001–3,000 lots: JPY 40 per new order lot.
- 3,001 lots and above: JPY 44 per new order lot.

For MT5, the new-trade-side fee is deducted at entry; no fee is charged on the closing transaction. The amount is tiered according to the same-symbol, same-direction open position quantity plus the new order quantity. Always re-check the broker's live schedule before execution because fees may change.

## 4. Implications for Gold AI Trader

1. The FXTF symbol must be configured as `XAUUSD`; do not reuse XM's `GOLD#` literal.
2. Do not copy XM volume rules. FXTF's observed minimum and step are both 1 lot; sizing must explicitly reject sub-1-lot proposals.
3. Keep Tick Value dynamic and account-currency denominated. The observed value is JPY, not USD.
4. Preserve UTC+2 / UTC+3 seasonal validation, but do not accept this single winter sample as proof of summer DST behavior.
5. Spread threshold and spread-cost treatment must use FXTF prices; sample 0.19 is a single closed-market last quote, not a live-session distribution.
6. Model opening commission and point-based swap separately from spread. Do not estimate FXTF net expectancy from XM costs.
7. The existing MT5 adapter's `DailyRealizedPnl()` currently filters for closing deal entries before adding `DEAL_COMMISSION`. Because FXTF charges the position-linked fee on the opening deal, the adapter would omit that entry-side commission from its realized daily P/L calculation. Fix and test this accounting path before using the account metrics for any risk or execution decision.
8. MT5 V19 Research was also present in the supplied log. Its network switches were false and its API key validation failed, so it remained in local-only mode; no network routes were enabled. It contains no order-execution implementation. Keep all network flags and execution gates disabled throughout the migration.

## 5. Remaining validation

- Re-run the probe during an active market session and capture a live spread sample.
- Verify symbol specification in Market Watch > Specification, particularly the swap and fee details.
- Confirm the FXTF daily trading break and weekly reopen with real ticks.
- Compile the V19 MT5 EA in MetaEditor 5; this probe result does not prove the EA compiles.
- Fix entry-side commission accounting and test with controlled fixtures / broker-provided history. No live trade should be opened for this test.
- Compare closed M5/H1 bar timestamps and payload values with the existing backend contract.
- Keep signal requests disabled, safety heartbeat disabled, and all order-execution gates OFF.

This baseline records environment discovery only. It does not authorize live trading, order entry, or production deployment.
