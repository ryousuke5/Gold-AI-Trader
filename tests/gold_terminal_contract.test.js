import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLD_TERMINAL_CONTRACT_VERSION,
  validateGoldSafetyHeartbeatPayload,
  validateGoldSignalPayload
} from '../src/gold_terminal_contract.js';

const baseTime = 1794960000;

function makeBars(count, intervalSeconds) {
  return Array.from({ length: count }, (_, index) => {
    const close = 3800 + index * 0.1;
    return {
      time: baseTime + index * intervalSeconds,
      open: close - 0.05,
      high: close + 0.10,
      low: close - 0.10,
      close,
      volume: 100 + index
    };
  });
}

function makeSafety() {
  return {
    allowed: true,
    reason: 'ok',
    quote_time_utc: baseTime,
    mid_price: 3800.1,
    spread_price: 0.2,
    stable_tick_count: 0,
    anomaly_active: false,
    reopen_lock_until_utc: 0
  };
}

function makeSignalPayload() {
  return {
    symbol: 'GOLD#',
    timeframe: 'M5',
    market_safety: makeSafety(),
    features: {
      bid: 3800.0,
      ask: 3800.2,
      point: 0.01,
      spread: 0.2,
      spread_points: 20,
      server_utc_offset_seconds: 7200,
      bar_time: baseTime + 300,
      m5: {
        ema20: 3799.8,
        ema50: 3799.2,
        rsi14: 58,
        atr14: 1.2,
        high20: 3801.0,
        low20: 3797.0
      },
      h1: {
        close: 3800.0,
        ema20: 3798.0,
        ema50: 3795.0,
        ema200: 3788.0,
        rsi14: 61,
        atr14: 5.4
      },
      recent_m5: makeBars(24, 300),
      recent_h1: makeBars(24, 3600)
    },
    account: {
      equity: 10000,
      balance: 10000,
      open_positions: 0,
      daily_pnl_pct: 0,
      drawdown_pct: 0,
      tick_size: 0.01,
      tick_value: 1,
      min_lot: 0.01,
      max_lot: 100,
      lot_step: 0.01,
      point: 0.01,
      digits: 2,
      stop_level_points: 0,
      freeze_level_points: 0,
      trade_allowed: 1,
      risk_data_ready: true
    }
  };
}

function makeHeartbeatPayload() {
  return {
    symbol: 'GOLD#',
    market_safety: makeSafety(),
    features: {
      bid: 3800.0,
      ask: 3800.2,
      point: 0.01,
      spread: 0.2
    },
    ea_runtime: {
      enable_signal_requests: true,
      run_ai_test_once: false,
      allow_auto_orders: false,
      timer_seconds: 1,
      safety_heartbeat_seconds: 15,
      flow_status: 'WAITING_FOR_NEW_M5_BAR',
      flow_reason: 'startup_current_completed_M5_bar_skipped',
      current_closed_m5_bar_open_utc: baseTime,
      last_handled_m5_bar_open_utc: baseTime,
      last_attempted_m5_bar_open_utc: 0,
      last_attempt_at_utc: 0
    }
  };
}

test('terminal adapter contract has an explicit version', () => {
  assert.equal(GOLD_TERMINAL_CONTRACT_VERSION, 'gold-terminal-v1');
});

test('valid GOLD M5 signal payload passes the shared MT4/MT5 contract', () => {
  const result = validateGoldSignalPayload(makeSignalPayload());
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('signal payload rejects missing safety and account fields', () => {
  const payload = makeSignalPayload();
  delete payload.market_safety.stable_tick_count;
  delete payload.account.risk_data_ready;

  const result = validateGoldSignalPayload(payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('market_safety.stable_tick_count: expected_finite_number'));
  assert.ok(result.errors.includes('account.risk_data_ready: expected_boolean'));
});

test('signal payload rejects out-of-order bars and invalid OHLC values', () => {
  const payload = makeSignalPayload();
  payload.features.recent_m5[5].time = payload.features.recent_m5[4].time;
  payload.features.recent_h1[3].high = payload.features.recent_h1[3].low - 1;

  const result = validateGoldSignalPayload(payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('bars_not_strictly_ascending')));
  assert.ok(result.errors.some(error => error.includes('invalid_ohlc_relationship')));
});

test('signal payload rejects the wrong symbol, timeframe and inverted quote', () => {
  const payload = makeSignalPayload();
  payload.symbol = 'EURUSD';
  payload.timeframe = 'H1';
  payload.features.ask = payload.features.bid - 0.1;

  const result = validateGoldSignalPayload(payload);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('symbol: not_gold'));
  assert.ok(result.errors.includes('timeframe: expected_M5'));
  assert.ok(result.errors.includes('features.ask: below_bid'));
});

test('valid safety heartbeat passes the shared MT4/MT5 contract', () => {
  const result = validateGoldSafetyHeartbeatPayload(makeHeartbeatPayload());
  assert.deepEqual(result, { ok: true, errors: [] });
});

test('safety heartbeat rejects order execution and malformed safety state', () => {
  const enabledOrders = makeHeartbeatPayload();
  enabledOrders.ea_runtime.allow_auto_orders = true;
  const enabledResult = validateGoldSafetyHeartbeatPayload(enabledOrders);
  assert.equal(enabledResult.ok, false);
  assert.ok(enabledResult.errors.includes('ea_runtime.allow_auto_orders: must_be_false_in_monitor_only_contract'));

  const malformed = makeHeartbeatPayload();
  malformed.ea_runtime.allow_auto_orders = 'false';
  malformed.market_safety.anomaly_active = 'false';
  const malformedResult = validateGoldSafetyHeartbeatPayload(malformed);
  assert.equal(malformedResult.ok, false);
  assert.ok(malformedResult.errors.includes('ea_runtime.allow_auto_orders: expected_boolean'));
  assert.ok(malformedResult.errors.includes('market_safety.anomaly_active: expected_boolean'));
});
