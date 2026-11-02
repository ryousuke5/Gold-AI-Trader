import { evaluateGoldMarketSafety } from './gold_market_safety.js';

export const GOLD_MARKET_SAFETY_HEARTBEAT_FRESH_SECONDS = 45;

let latestSnapshot = null;

const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function recordGoldMarketSafetyHeartbeat({
  symbol,
  marketSafety,
  features,
  nowMs = Date.now()
} = {}) {
  const safeSymbol = String(symbol || '').trim();
  if (!/(XAU|GOLD)/i.test(safeSymbol)) {
    throw new Error('symbol_not_gold');
  }
  if (!Number.isFinite(Number(nowMs)) || Number(nowMs) <= 0) {
    throw new Error('invalid_heartbeat_time');
  }

  const snapshot = marketSafety && typeof marketSafety === 'object' && !Array.isArray(marketSafety)
    ? marketSafety
    : null;
  const quoteFeatures = features && typeof features === 'object' && !Array.isArray(features)
    ? features
    : {};
  const validation = evaluateGoldMarketSafety(snapshot, quoteFeatures, {
    nowMs,
    maxSpreadPrice: 0.50,
    maxQuoteAgeSeconds: 30
  });

  const reportedAllowed = snapshot?.allowed === true;
  const status = reportedAllowed
    ? (validation.allowed ? 'ALLOWED' : 'API_CHECK_FAILED')
    : 'BLOCKED';
  const reason = String(snapshot?.reason || (snapshot ? 'unknown' : 'market_safety_missing'));
  const anomalyActive = typeof snapshot?.anomaly_active === 'boolean' ? snapshot.anomaly_active : null;
  const stableTickCount = Number.isInteger(Number(snapshot?.stable_tick_count))
    ? Number(snapshot.stable_tick_count)
    : null;
  const stateChanged = !latestSnapshot || latestSnapshot.status !== status ||
    latestSnapshot.reason !== reason || latestSnapshot.reported_allowed !== reportedAllowed ||
    latestSnapshot.anomaly_active !== anomalyActive || latestSnapshot.stable_tick_count !== stableTickCount;

  latestSnapshot = {
    symbol: safeSymbol,
    received_at: new Date(nowMs).toISOString(),
    received_at_epoch: Math.floor(nowMs / 1000),
    status,
    reported_allowed: reportedAllowed,
    api_validation_allowed: validation.allowed,
    reason,
    quote_time_utc: numberOrNull(snapshot?.quote_time_utc),
    quote_age_seconds: validation.quoteAgeSeconds,
    mid_price: numberOrNull(snapshot?.mid_price),
    spread_price: numberOrNull(snapshot?.spread_price),
    bid: numberOrNull(quoteFeatures.bid),
    ask: numberOrNull(quoteFeatures.ask),
    stable_tick_count: stableTickCount,
    anomaly_active: anomalyActive,
    reopen_lock_until_utc: numberOrNull(snapshot?.reopen_lock_until_utc),
    api_validation_reasons: validation.reasons
  };

  return {
    ok: true,
    status,
    state_changed: stateChanged,
    reported_allowed: reportedAllowed,
    api_validation_allowed: validation.allowed,
    api_validation_reasons: validation.reasons
  };
}

export function getGoldMarketSafetyTelemetrySnapshot({ nowMs = Date.now() } = {}) {
  if (!latestSnapshot) {
    return {
      available: false,
      status: 'NO_REPORT',
      freshness: 'NO_REPORT',
      age_seconds: null,
      message: 'V19 market-safety heartbeat has not been received'
    };
  }

  const ageSeconds = Math.max(0, (Number(nowMs) - latestSnapshot.received_at_epoch * 1000) / 1000);
  const fresh = Number.isFinite(ageSeconds) && ageSeconds <= GOLD_MARKET_SAFETY_HEARTBEAT_FRESH_SECONDS;
  return {
    ...latestSnapshot,
    available: true,
    age_seconds: ageSeconds,
    freshness: fresh ? 'FRESH' : 'STALE',
    status: fresh ? latestSnapshot.status : 'STALE',
    display_allowed: fresh && latestSnapshot.status === 'ALLOWED'
  };
}

export function resetGoldMarketSafetyTelemetryForTests() {
  latestSnapshot = null;
}
