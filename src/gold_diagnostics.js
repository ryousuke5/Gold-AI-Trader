import { validateUtcBarTimestamp } from './market_time.js';

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ageSeconds(nowMs, isoTime) {
  const timeMs = Date.parse(isoTime || '');
  return Number.isFinite(timeMs) ? Math.max(0, (nowMs - timeMs) / 1000) : null;
}

/**
 * Process-local diagnostics for the GOLD signal route.
 * Counters reset whenever the Node process restarts; they are intentionally
 * observability-only and do not influence signal decisions or order execution.
 */
export function createGoldDiagnosticsTracker({ startedAtMs = Date.now() } = {}) {
  const processStartedAt = new Date(startedAtMs).toISOString();
  const counters = {
    requests_received: 0,
    time_rejections: 0,
    stale_bar_rejections: 0,
    future_bar_rejections: 0,
    invalid_bar_rejections: 0,
    duplicate_bar_responses: 0,
    invalid_feature_responses: 0,
    signal_evaluations: 0,
    server_errors: 0,
    spread_warnings: 0
  };
  let latestRequest = null;
  let latestSignal = null;
  let latestTimeRejection = null;

  function recordRequest({
    requestId = null,
    symbol = null,
    timeframe = null,
    features = {},
    serverUtcOffsetSeconds = null,
    maxAgeSeconds = 90,
    maxSpreadPrice = 0.5,
    nowMs = Date.now()
  } = {}) {
    const receivedAtMs = Number(nowMs);
    const receivedAt = new Date(receivedAtMs).toISOString();
    const barEpoch = nullableNumber(features?.barTime ?? features?.bar_time);
    const spread = nullableNumber(features?.spread);
    const spreadLimit = nullableNumber(maxSpreadPrice);
    const timeCheck = validateUtcBarTimestamp(barEpoch, {
      nowMs: receivedAtMs,
      futureToleranceSeconds: 30,
      maxAgeSeconds
    });
    const offset = nullableNumber(serverUtcOffsetSeconds);

    counters.requests_received += 1;
    if (spread !== null && spreadLimit !== null && spread > spreadLimit) {
      counters.spread_warnings += 1;
    }

    latestRequest = {
      request_id: requestId === null ? null : String(requestId).slice(0, 100),
      received_at: receivedAt,
      symbol: symbol === null ? null : String(symbol).slice(0, 24),
      timeframe: timeframe === null ? null : String(timeframe).slice(0, 12),
      bar_time_epoch: barEpoch !== null && barEpoch > 0 ? barEpoch : null,
      bar_time_utc: barEpoch !== null && barEpoch > 0 ? new Date(barEpoch * 1000).toISOString() : null,
      server_utc_offset_seconds: offset !== null && Math.abs(offset) <= 14 * 3600 ? offset : null,
      spread,
      spread_limit_price: spreadLimit,
      timestamp_valid_at_receipt: timeCheck.ok,
      timestamp_reason_at_receipt: timeCheck.reason,
      outcome: 'RECEIVED',
      outcome_reason: null,
      decision: null,
      risk_approved: null,
      runtime_mode: null,
      auto_trading_enabled: null
    };
    return timeCheck;
  }

  function recordTimeRejection({
    requestId = null,
    reason = 'invalid_bar_time',
    ageSeconds: rejectedAgeSeconds = null,
    futureSeconds = null,
    nowMs = Date.now()
  } = {}) {
    const normalizedReason = String(reason || 'invalid_bar_time');
    counters.time_rejections += 1;
    if (normalizedReason === 'bar_time_too_old') counters.stale_bar_rejections += 1;
    else if (normalizedReason === 'bar_time_in_future') counters.future_bar_rejections += 1;
    else counters.invalid_bar_rejections += 1;
    latestTimeRejection = {
      at: new Date(nowMs).toISOString(),
      request_id: requestId === null ? null : String(requestId).slice(0, 100),
      reason: normalizedReason,
      age_seconds: nullableNumber(rejectedAgeSeconds),
      future_seconds: nullableNumber(futureSeconds)
    };
    if (latestRequest && (requestId === null || latestRequest.request_id === String(requestId))) {
      latestRequest.outcome = 'TIME_REJECTED';
      latestRequest.outcome_reason = normalizedReason;
    }
  }

  function recordOutcome({
    requestId = null,
    outcome = 'UNKNOWN',
    reason = null,
    decision = null,
    riskApproved = null,
    runtimeMode = null,
    autoTradingEnabled = null
  } = {}) {
    const normalizedOutcome = String(outcome || 'UNKNOWN').toUpperCase();
    if (normalizedOutcome === 'DUPLICATE_BAR') counters.duplicate_bar_responses += 1;
    else if (normalizedOutcome === 'INVALID_FEATURES') counters.invalid_feature_responses += 1;
    else if (normalizedOutcome === 'SERVER_ERROR') counters.server_errors += 1;

    if (latestRequest && (requestId === null || latestRequest.request_id === String(requestId))) {
      latestRequest.outcome = normalizedOutcome;
      latestRequest.outcome_reason = reason === null ? null : String(reason).slice(0, 120);
      latestRequest.decision = decision === null ? latestRequest.decision : String(decision).slice(0, 8);
      latestRequest.risk_approved = typeof riskApproved === 'boolean' ? riskApproved : latestRequest.risk_approved;
      latestRequest.runtime_mode = runtimeMode === null ? latestRequest.runtime_mode : String(runtimeMode).slice(0, 16);
      latestRequest.auto_trading_enabled = typeof autoTradingEnabled === 'boolean'
        ? autoTradingEnabled
        : latestRequest.auto_trading_enabled;
    }
  }

  function recordEvaluated({
    requestId = null,
    signal = {},
    risk = {},
    state = {},
    nowMs = Date.now()
  } = {}) {
    counters.signal_evaluations += 1;
    latestSignal = {
      signal_id: signal.id === undefined ? null : String(signal.id),
      request_id: requestId === null ? null : String(requestId).slice(0, 100),
      created_at: signal.created_at || new Date(nowMs).toISOString(),
      bar_time: signal.bar_time || null,
      candidate: String(signal.candidate || 'WAIT').toUpperCase(),
      decision: String(signal.decision || 'WAIT').toUpperCase(),
      reason: String(signal.reason || '').slice(0, 120),
      risk_approved: risk.approved === true,
      runtime_mode: String(state.mode || 'ANALYSIS').slice(0, 16),
      auto_trading_enabled: state.auto_trading_enabled === true,
      emergency_stopped: Boolean(state.emergency_stopped_at)
    };
    recordOutcome({
      requestId,
      outcome: 'SIGNAL_EVALUATED',
      reason: signal.reason || null,
      decision: signal.decision || 'WAIT',
      riskApproved: risk.approved === true,
      runtimeMode: state.mode || 'ANALYSIS',
      autoTradingEnabled: state.auto_trading_enabled === true
    });
  }

  function getSnapshot(nowMs = Date.now()) {
    const now = Number(nowMs);
    const snapshot = {
      process_started_at: processStartedAt,
      uptime_seconds: Math.max(0, Math.floor((now - startedAtMs) / 1000)),
      counters: { ...counters },
      latest_request: latestRequest ? {
        ...latestRequest,
        age_seconds: ageSeconds(now, latestRequest.received_at),
        bar_age_seconds: latestRequest.bar_time_epoch === null
          ? null
          : (now - latestRequest.bar_time_epoch * 1000) / 1000
      } : null,
      latest_signal: latestSignal ? {
        ...latestSignal,
        age_seconds: ageSeconds(now, latestSignal.created_at)
      } : null,
      latest_time_rejection: latestTimeRejection ? { ...latestTimeRejection } : null,
      counter_scope: 'process_lifetime'
    };
    return snapshot;
  }

  return { recordRequest, recordTimeRejection, recordOutcome, recordEvaluated, getSnapshot };
}

const liveTracker = createGoldDiagnosticsTracker();
export const recordGoldSignalRequest = liveTracker.recordRequest;
export const recordGoldSignalTimeRejection = liveTracker.recordTimeRejection;
export const recordGoldSignalOutcome = liveTracker.recordOutcome;
export const recordGoldSignalEvaluated = liveTracker.recordEvaluated;
export const getGoldDiagnosticSnapshot = liveTracker.getSnapshot;
