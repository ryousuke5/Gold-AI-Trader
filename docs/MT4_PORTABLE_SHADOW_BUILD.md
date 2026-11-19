# MT4 V19 Portable Shadow Build

Status: initial extraction complete; compile/parity validation pending.  
Branch: `refactor/v19-mt5-portability-foundation`

## Purpose

This folder contains a modular, **research-only shadow copy** of the V19 EA. The existing `mt4/GoldAITraderV19.mq4` is untouched. The shadow build was extracted verbatim from the repository baseline whose source blob SHA is:

`5461cb91ff339acc99af54caa63764aca835aa7f`

That source file was last changed on 2026-11-03. The local MetaEditor source used for V19 runtime logs on 2026-11-18 has not yet been synchronized and verified against this baseline. Do not compile for live use, install over the active EA, merge to main, or deploy based solely on this shadow build.

## Files

- `GoldAITraderV19_Portable.mq4`: inputs, global state, include list and EA lifecycle.
- `include/GoldV19_Common.mqh`: string, symbol and JSON helpers.
- `include/GoldV19_MarketData.mqh`: symbol readiness, open positions, realized P/L and equity peak snapshot.
- `include/GoldV19_Time.mqh`: broker-server to UTC conversion and UTC epoch formatting.
- `include/GoldV19_MarketSafety.mqh`: persisted market safety state, reopen lock and abnormal-tick recovery.
- `include/GoldV19_Payload.mqh`: signal and heartbeat JSON payload construction.
- `include/GoldV19_Http.mqh`: authenticated HTTP POST.
- `include/GoldV19_Flow.mqh`: stale-bar rejection and timer signal flow.

All 24 function definitions were extracted verbatim. Only the EA description string was changed to identify the shadow build. The inputs and globals remain copied from the repository V19 file.

## Verification

The test `tests/mt4_gold_v19_portable_parity.test.js` verifies:

1. All seven include modules exist and are included in the expected order.
2. Each original function body appears in the portable build exactly once.
3. Auto orders remain disabled and no MT4/MT5 order execution methods are present.

Run:

```powershell
npm test
```

This Node test proves source-text parity only. It does not prove MetaEditor compilation, MT4 runtime equivalence, or MT5 correctness.

## Next required steps

1. Obtain the latest local `GoldAITraderV19.mq4` from MetaEditor / the active MT4 Experts folder.
2. Compare its SHA-256 and source diff to the repository baseline and the shadow build.
3. If the local source contains newer safety or telemetry changes, regenerate the shadow modules from that exact source and update parity tests.
4. Compile the shadow EA in MetaEditor with no order permission and record compiler output.
5. Run demo-only A/B forward tests against the unmodified EA before considering any MT5 port.
6. Build the MQL5 adapter independently against the unchanged Render JSON/API contract.

## Safety invariants

- `AllowAutoOrders=false`.
- No `OrderSend`, `OrderClose`, `OrderModify` or MQL5 `CTrade` calls.
- Preserve `gold-m5-h1-v2` and existing backend strategy thresholds.
- Preserve UTC closed-bar timestamps and quote-safety fail-closed behavior.
- No real orders, no live account test, no Render deployment as part of this refactor.
