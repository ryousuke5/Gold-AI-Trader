/**
 * Platform-neutral contract checks for MT4/MT5 terminal adapters.
 *
 * This module is intentionally not imported by the production signal route.
 * It validates captured adapter payloads in tests/replay tools so both terminal
 * implementations can be checked against one wire contract without coupling
 * MQL4 and MQL5 APIs.
 */

export const GOLD_TERMINAL_CONTRACT_VERSION = 'gold-terminal-v1';

const isRecord = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = value =>
  typeof value === 'number' && Number.isFinite(value);

function requireRecord(value, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path}: expected_object`);
    return false;
  }
  return true;
}

function requireString(value, path, errors, { nonEmpty = true } = {}) {
  if (typeof value !== 'string' || (nonEmpty && value.trim().length === 0)) {
    errors.push(`${path}: expected_${nonEmpty ? 'non_empty_' : ''}string`);
    return false;
  }
  return true;
}

function requireNumber(value, path, errors, { min = -Infinity, integer = false } = {}) {
  if (!isFiniteNumber(value)) {
    errors.push(`${path}: expected_finite_number`);
    return false;
  }
  if (value < min) errors.push(`${path}: below_minimum_${min}`);
  if (integer && !Number.isInteger(value)) errors.push(`${path}: expected_integer`);
  return true;
}

function validateMarketSafety(snapshot, errors) {
  const path = 'market_safety';
  if (!requireRecord(snapshot, path, errors)) return;

  if (typeof snapshot.allowed !== 'boolean') errors.push(`${path}.allowed: expected_boolean`);
  requireString(snapshot.reason, `${path}.reason`, errors, { nonEmpty: false });
  requireNumber(snapshot.quote_time_utc, `${path}.quote_time_utc`, errors, { min: 1 });
  requireNumber(snapshot.mid_price, `${path}.mid_price`, errors, { min: 0.0000001 });
  requireNumber(snapshot.spread_price, `${path}.spread_price`, errors, { min: 0 });
  requireNumber(snapshot.stable_tick_count, `${path}.stable_tick_count`, errors, { min: 0, integer: true });
  if (typeof snapshot.anomaly_active !== 'boolean') {
    errors.push(`${path}.anomaly_active: expected_boolean`);
  }
  requireNumber(snapshot.reopen_lock_until_utc, `${path}.reopen_lock_until_utc`, errors, { min: 0 });
}

function validateQuoteFeatures(features, path, errors, { requireSignalFeatures = false } = {}) {
  if (!requireRecord(features, path, errors)) return;

  requireNumber(features.bid, `${path}.bid`, errors, { min: 0.0000001 });
  requireNumber(features.ask, `${path}.ask`, errors, { min: 0.0000001 });
  requireNumber(features.point, `${path}.point`, errors, { min: 0.0000001 });
  requireNumber(features.spread, `${path}.spread`, errors, { min: 0 });

  if (isFiniteNumber(features.bid) && isFiniteNumber(features.ask) && features.ask < features.bid) {
    errors.push(`${path}.ask: below_bid`);
  }
  if (requireSignalFeatures) {
    requireNumber(features.spread_points, `${path}.spread_points`, errors, { min: 0 });
    requireNumber(features.server_utc_offset_seconds, `${path}.server_utc_offset_seconds`, errors);
    requireNumber(features.bar_time, `${path}.bar_time`, errors, { min: 1 });
    validateIndicatorGroup(features.m5, `${path}.m5`, errors, [
      'ema20', 'ema50', 'rsi14', 'atr14', 'high20', 'low20'
    ]);
    validateIndicatorGroup(features.h1, `${path}.h1`, errors, [
      'close', 'ema20', 'ema50', 'ema200', 'rsi14', 'atr14'
    ]);
  }
}

function validateIndicatorGroup(group, path, errors, fields) {
  if (!requireRecord(group, path, errors)) return;
  for (const field of fields) requireNumber(group[field], `${path}.${field}`, errors);
}

function validateBars(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected_array`);
    return;
  }

  if (value.length > 24) errors.push(`${path}: exceeds_24_bars`);
  let previousTime = null;
  value.forEach((bar, index) => {
    const itemPath = `${path}[${index}]`;
    if (!requireRecord(bar, itemPath, errors)) return;
    for (const field of ['time', 'open', 'high', 'low', 'close', 'volume']) {
      requireNumber(bar[field], `${itemPath}.${field}`, errors, {
        min: field === 'time' ? 1 : 0
      });
    }

    if (isFiniteNumber(bar.time)) {
      if (previousTime !== null && bar.time <= previousTime) {
        errors.push(`${itemPath}.time: bars_not_strictly_ascending`);
      }
      previousTime = bar.time;
    }

    if ([bar.open, bar.high, bar.low, bar.close].every(isFiniteNumber)) {
      if (bar.high < Math.max(bar.open, bar.close, bar.low)) {
        errors.push(`${itemPath}.high: invalid_ohlc_relationship`);
      }
      if (bar.low > Math.min(bar.open, bar.close, bar.high)) {
        errors.push(`${itemPath}.low: invalid_ohlc_relationship`);
      }
    }
  });
}

function validateSignalAccount(account, errors) {
  const path = 'account';
  if (!requireRecord(account, path, errors)) return;

  const numericFields = [
    'equity', 'balance', 'open_positions', 'daily_pnl_pct', 'drawdown_pct',
    'tick_size', 'tick_value', 'min_lot', 'max_lot', 'lot_step', 'point',
    'digits', 'stop_level_points', 'freeze_level_points', 'trade_allowed'
  ];
  for (const field of numericFields) {
    requireNumber(account[field], `${path}.${field}`, errors, {
      min: field === 'open_positions' || field === 'digits' ||
        field === 'stop_level_points' || field === 'freeze_level_points' ||
        field === 'trade_allowed' ? 0 : -Infinity,
      integer: ['open_positions', 'digits', 'stop_level_points', 'freeze_level_points', 'trade_allowed'].includes(field)
    });
  }
  if (typeof account.risk_data_ready !== 'boolean') {
    errors.push(`${path}.risk_data_ready: expected_boolean`);
  }
}

export function validateGoldSignalPayload(payload) {
  const errors = [];
  if (!requireRecord(payload, 'payload', errors)) return { ok: false, errors };

  requireString(payload.symbol, 'symbol', errors);
  if (typeof payload.symbol === 'string' && !/(XAU|GOLD)/i.test(payload.symbol)) {
    errors.push('symbol: not_gold');
  }
  if (payload.timeframe !== 'M5') errors.push('timeframe: expected_M5');

  validateMarketSafety(payload.market_safety, errors);
  validateQuoteFeatures(payload.features, 'features', errors, { requireSignalFeatures: true });
  validateBars(payload.recent_m5, 'recent_m5', errors);
  validateBars(payload.recent_h1, 'recent_h1', errors);
  validateSignalAccount(payload.account, errors);

  return { ok: errors.length === 0, errors };
}

export function validateGoldSafetyHeartbeatPayload(payload) {
  const errors = [];
  if (!requireRecord(payload, 'payload', errors)) return { ok: false, errors };

  requireString(payload.symbol, 'symbol', errors);
  if (typeof payload.symbol === 'string' && !/(XAU|GOLD)/i.test(payload.symbol)) {
    errors.push('symbol: not_gold');
  }

  validateMarketSafety(payload.market_safety, errors);
  validateQuoteFeatures(payload.features, 'features', errors);

  const runtime = payload.ea_runtime;
  if (!requireRecord(runtime, 'ea_runtime', errors)) {
    return { ok: false, errors };
  }
  for (const field of ['enable_signal_requests', 'run_ai_test_once', 'allow_auto_orders']) {
    if (typeof runtime[field] !== 'boolean') errors.push(`ea_runtime.${field}: expected_boolean`);
  }
  for (const field of [
    'timer_seconds', 'safety_heartbeat_seconds', 'current_closed_m5_bar_open_utc',
    'last_handled_m5_bar_open_utc', 'last_attempted_m5_bar_open_utc', 'last_attempt_at_utc'
  ]) {
    requireNumber(runtime[field], `ea_runtime.${field}`, errors, { min: 0 });
  }
  requireString(runtime.flow_status, 'ea_runtime.flow_status', errors, { nonEmpty: false });
  requireString(runtime.flow_reason, 'ea_runtime.flow_reason', errors, { nonEmpty: false });

  return { ok: errors.length === 0, errors };
}
