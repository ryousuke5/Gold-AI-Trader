# MT4 V19 Portable Shadow Build

Status: regenerated from the V19 source supplied in chat; source-parity and repository CI PASS; MetaEditor compile/runtime validation pending.  
Branch: `refactor/v19-mt5-portability-foundation`

## Purpose

This folder contains a modular, **research-only shadow copy** of the V19 EA. The existing `mt4/GoldAITraderV19.mq4` is untouched. The shadow build was regenerated from the pre-startup-bar-skip V19 version matching the source pasted in chat. Its preserved baseline is `mt4/source-baselines/GoldAITraderV19_UserProvided_2026-11-20.mq4`, Git blob SHA:

`a65972bf15041d7ae34a001f6b079dcb8465b6ce`

The corresponding historical revision is commit `676ef7edfe7fc342cb9c8681ad8c6bec6ecf9379` (2026-11-03). This baseline does not contain the later `startup_current_completed_M5_bar_skipped` guard. The shadow code deliberately preserves that behavior rather than silently adding a logic change. Do not install over the active EA, merge to main, or deploy based solely on this shadow build.

## Files

- `GoldAITraderV19_Portable.mq4`: inputs, global state, include list and EA lifecycle.
- `include/GoldV19_Common.mqh`: string, symbol and JSON helpers.
- `include/GoldV19_MarketData.mqh`: symbol readiness, open positions, realized P/L and equity peak snapshot.
- `include/GoldV19_Time.mqh`: broker-server to UTC conversion and UTC epoch formatting.
- `include/GoldV19_MarketSafety.mqh`: persisted market safety state, reopen lock and abnormal-tick recovery.
- `include/GoldV19_Payload.mqh`: signal and heartbeat JSON payload construction.
- `include/GoldV19_Http.mqh`: authenticated HTTP POST.
- `include/GoldV19_Flow.mqh`: stale-bar rejection and timer signal flow.

All 24 function definitions were extracted verbatim from the supplied-source baseline. Only the EA description string was changed to identify the shadow build. The inputs and globals remain copied from that baseline.

## Verification

The test `tests/mt4_gold_v19_portable_parity.test.js` verifies:

1. All seven include modules exist and are included in the expected order.
2. Each original function body appears in the portable build exactly once.
3. Auto orders remain disabled and no MT4/MT5 order execution methods are present.

Run:

```powershell
npm test
```

Automated result: `V19 Portable Shadow Parity` workflow passed (run `44617804192`), and the full repository test workflow passed on commit `bd6b5431b83908e5dabe7f20d4e3448d0d2ff0e7` (run `44618194473`). These results prove source-text parity and repository tests only. They do not prove MetaEditor compilation, MT4 runtime equivalence, or MT5 correctness.

## Next required steps

1. The source pasted in chat is now preserved as a named baseline; verify byte-for-byte against the active MT4 Experts-folder copy when convenient.
2. Compile the shadow EA in MetaEditor with no order permission and record compiler output.
3. Run demo-only A/B forward tests against the unmodified EA before considering any MT5 port.
4. Build the MQL5 adapter independently against the unchanged Render JSON/API contract.

## Safety invariants

- `AllowAutoOrders=false`.
- No `OrderSend`, `OrderClose`, `OrderModify` or MQL5 `CTrade` calls.
- Preserve `gold-m5-h1-v2` and existing backend strategy thresholds.
- Preserve UTC closed-bar timestamps and quote-safety fail-closed behavior.
- No real orders, no live account test, no Render deployment as part of this refactor.
