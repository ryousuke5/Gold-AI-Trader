import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getGoldMarketSafetyTelemetrySnapshot,
  recordGoldMarketSafetyHeartbeat,
  resetGoldMarketSafetyTelemetryForTests
} from '../src/gold_market_safety_telemetry.js';

const nowMs = Date.UTC(2026, 10, 2, 2, 0, 0);
const features = { bid: 4097.08, ask: 4097.36, spread: 0.28, point: 0.01 };

function marketSafety(overrides = {}) {
  return {
    allowed: true,
    reason: 'ok',
    quote_time_utc: nowMs / 1000 - 5,
    mid_price: 4097.22,
    spread_price: 0.28,
    stable_tick_count: 0,
    anomaly_active: false,
    reopen_lock_until_utc: 0,
    ...overrides
  };
}

test('reports NO_REPORT until V19 sends its first heartbeat', () => {
  resetGoldMarketSafetyTelemetryForTests();
  const result = getGoldMarketSafetyTelemetrySnapshot({ nowMs });
  assert.equal(result.available, false);
  assert.equal(result.status, 'NO_REPORT');
});

test('records a fresh, valid V19 safety heartbeat as ALLOWED', () => {
  resetGoldMarketSafetyTelemetryForTests();
  const accepted = recordGoldMarketSafetyHeartbeat({
    symbol: 'GOLD#',
    marketSafety: marketSafety(),
    features,
    nowMs
  });
  const result = getGoldMarketSafetyTelemetrySnapshot({ nowMs: nowMs + 1000 });
  assert.equal(accepted.status, 'ALLOWED');
  assert.equal(result.status, 'ALLOWED');
  assert.equal(result.freshness, 'FRESH');
  assert.equal(result.display_allowed, true);
  assert.equal(result.spread_price, 0.28);
  assert.equal(accepted.state_changed, true);
  const repeated = recordGoldMarketSafetyHeartbeat({
    symbol: 'GOLD#', marketSafety: marketSafety(), features, nowMs: nowMs + 10_000
  });
  assert.equal(repeated.state_changed, false);
});

test('stores V19 signal request switches and current M5 flow in the safety heartbeat', () => {
  resetGoldMarketSafetyTelemetryForTests();
  const eaRuntime = {
    enable_signal_requests: false,
    run_ai_test_once: true,
    allow_auto_orders: false,
    timer_seconds: 1,
    safety_heartbeat_seconds: 15,
    flow_status: 'DISABLED',
    flow_reason: 'EnableSignalRequests=false',
    current_closed_m5_bar_open_utc: nowMs / 1000 - 60,
    last_handled_m5_bar_open_utc: nowMs / 1000 - 360,
    last_attempted_m5_bar_open_utc: null,
    last_attempt_at_utc: null
  };
  const accepted = recordGoldMarketSafetyHeartbeat({
    symbol: 'GOLD#',
    marketSafety: marketSafety(),
    features,
    eaRuntime,
    nowMs
  });
  const result = getGoldMarketSafetyTelemetrySnapshot({ nowMs });
  assert.equal(accepted.ea_runtime_received, true);
  assert.equal(result.ea_runtime.enable_signal_requests, false);
  assert.equal(result.ea_runtime.run_ai_test_once, true);
  assert.equal(result.ea_runtime.allow_auto_orders, false);
  assert.equal(result.ea_runtime.flow_status, 'DISABLED');
  assert.equal(result.ea_runtime.flow_reason, 'EnableSignalRequests=false');
  assert.equal(result.ea_runtime.current_closed_m5_bar_open_utc, nowMs / 1000 - 60);
  assert.equal(result.ea_runtime.last_attempt_at_utc, null);

  const changed = recordGoldMarketSafetyHeartbeat({
    symbol: 'GOLD#',
    marketSafety: marketSafety(),
    features,
    eaRuntime: { ...eaRuntime, enable_signal_requests: true },
    nowMs: nowMs + 15_000
  });
  assert.equal(changed.state_changed, true);
});

test('shows a valid local market lock as BLOCKED rather than a telemetry failure', () => {
  resetGoldMarketSafetyTelemetryForTests();
  const accepted = recordGoldMarketSafetyHeartbeat({
    symbol: 'GOLD#',
    marketSafety: marketSafety({
      allowed: false,
      reason: 'market_reopen_lock',
      reopen_lock_until_utc: nowMs / 1000 + 900
    }),
    features,
    nowMs
  });
  const result = getGoldMarketSafetyTelemetrySnapshot({ nowMs });
  assert.equal(accepted.status, 'BLOCKED');
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.reason, 'market_reopen_lock');
  assert.equal(result.display_allowed, false);
});

test('fails API revalidation when the V19 quote snapshot does not match the signal quote', () => {
  resetGoldMarketSafetyTelemetryForTests();
  recordGoldMarketSafetyHeartbeat({
    symbol: 'GOLD#',
    marketSafety: marketSafety({ mid_price: 4100 }),
    features,
    nowMs
  });
  const result = getGoldMarketSafetyTelemetrySnapshot({ nowMs });
  assert.equal(result.status, 'API_CHECK_FAILED');
  assert.ok(result.api_validation_reasons.includes('market_safety_quote_mismatch'));
  assert.equal(result.display_allowed, false);
});

test('marks the heartbeat STALE when more than 45 seconds have passed', () => {
  resetGoldMarketSafetyTelemetryForTests();
  recordGoldMarketSafetyHeartbeat({
    symbol: 'GOLD#',
    marketSafety: marketSafety(),
    features,
    nowMs
  });
  const result = getGoldMarketSafetyTelemetrySnapshot({ nowMs: nowMs + 46_000 });
  assert.equal(result.status, 'STALE');
  assert.equal(result.freshness, 'STALE');
  assert.equal(result.display_allowed, false);
});

test('rejects non-GOLD telemetry symbols', () => {
  resetGoldMarketSafetyTelemetryForTests();
  assert.throws(() => recordGoldMarketSafetyHeartbeat({
    symbol: 'EURUSD#',
    marketSafety: marketSafety(),
    features,
    nowMs
  }), /symbol_not_gold/);
});
