function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedString(value, maxLength = 120) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, maxLength) : null;
}

function failureComponents(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map(item => String(item).slice(0, 80));
}

/**
 * Create a privacy-safe structured log payload for a persisted Gold signal.
 * Intentionally excludes raw prices, account balances, request bodies, and secrets.
 */
export function buildGoldSignalDiagnosticLog({
  requestId,
  signal = {},
  setup = {},
  risk = {},
  state = {},
  serverUtcOffsetSeconds = null
} = {}) {
  const diagnostics = setup && typeof setup === 'object' && setup.diagnostics && typeof setup.diagnostics === 'object'
    ? setup.diagnostics
    : {};
  const hasH1Diagnostics = Number(diagnostics.h1_diagnostics_version) === 1;
  const h1 = hasH1Diagnostics ? {
    diagnostics_version: 1,
    close_vs_ema20_atr: numberOrNull(diagnostics.h1_close_vs_ema20_atr),
    ema20_vs_ema50_atr: numberOrNull(diagnostics.h1_ema20_vs_ema50_atr),
    ema50_vs_ema200_atr: numberOrNull(diagnostics.h1_ema50_vs_ema200_atr),
    rsi14: numberOrNull(diagnostics.h1_rsi14),
    rsi_buy_min: numberOrNull(diagnostics.h1_min_rsi_buy),
    rsi_buy_max: numberOrNull(diagnostics.h1_max_rsi_buy),
    rsi_sell_min: numberOrNull(diagnostics.h1_min_rsi_sell),
    rsi_sell_max: numberOrNull(diagnostics.h1_max_rsi_sell),
    up_checks: {
      close_above_ema20: diagnostics.h1_up_close_above_ema20 === true,
      ema20_above_ema50: diagnostics.h1_up_ema20_above_ema50 === true,
      ema50_above_ema200: diagnostics.h1_up_ema50_above_ema200 === true,
      rsi_in_band: diagnostics.h1_up_rsi_in_band === true
    },
    down_checks: {
      close_below_ema20: diagnostics.h1_down_close_below_ema20 === true,
      ema20_below_ema50: diagnostics.h1_down_ema20_below_ema50 === true,
      ema50_below_ema200: diagnostics.h1_down_ema50_below_ema200 === true,
      rsi_in_band: diagnostics.h1_down_rsi_in_band === true
    },
    up_failure_components: failureComponents(diagnostics.h1_up_failure_components),
    down_failure_components: failureComponents(diagnostics.h1_down_failure_components)
  } : null;

  return {
    event: 'gold_signal_evaluated',
    request_id: boundedString(requestId, 100),
    signal_id: boundedString(signal.id, 100),
    symbol: boundedString(signal.symbol, 24),
    timeframe: boundedString(signal.timeframe, 12),
    bar_time: boundedString(signal.bar_time, 40),
    server_utc_offset_seconds: numberOrNull(serverUtcOffsetSeconds),
    strategy_version: boundedString(signal.strategy_version, 60),
    candidate: boundedString(signal.candidate, 8),
    decision: boundedString(signal.decision, 8),
    reason: boundedString(signal.reason || setup?.reason, 120),
    risk_approved: risk.approved === true,
    runtime_mode: boundedString(state.mode || 'ANALYSIS', 16),
    auto_trading_enabled: state.auto_trading_enabled === true,
    emergency_stopped: Boolean(state.emergency_stopped_at),
    h1,
    range_atr: numberOrNull(diagnostics.range_atr),
    range_min_atr: numberOrNull(diagnostics.min_range_atr),
    range_max_atr: numberOrNull(diagnostics.max_range_atr)
  };
}
