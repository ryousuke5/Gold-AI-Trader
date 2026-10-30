const DEFAULT_MAX_SPREAD_PRICE = 0.50;
const DEFAULT_MAX_QUOTE_AGE_SECONDS = 30;
const FUTURE_TOLERANCE_SECONDS = 10;

const REPORTED_BLOCK_REASONS = new Set([
  'market_reopen_lock',
  'tick_anomaly_recovery',
  'spread_too_wide',
  'quote_invalid',
  'quote_stale',
  'quote_time_invalid',
  'server_utc_offset_invalid',
  'tick_time_reversed',
  'initial_market_warmup'
]);

/**
 * Validate the MT4-side market-safety snapshot again at the API boundary.
 * This is intentionally separate from GOLD V2 setup generation: it can only
 * prevent a signal from becoming order-eligible; it cannot create BUY/SELL.
 */
export function evaluateGoldMarketSafety(
  snapshot,
  features = {},
  {
    nowMs = Date.now(),
    maxSpreadPrice = DEFAULT_MAX_SPREAD_PRICE,
    maxQuoteAgeSeconds = DEFAULT_MAX_QUOTE_AGE_SECONDS
  } = {}
) {
  const reasons = [];
  const nowSeconds = Number(nowMs) / 1000;
  const requestedSpreadLimit = Number(maxSpreadPrice);
  const spreadLimit = Number.isFinite(requestedSpreadLimit)
    ? Math.min(DEFAULT_MAX_SPREAD_PRICE, requestedSpreadLimit)
    : Number.NaN;
  const maxAge = Number(maxQuoteAgeSeconds);

  if (!Number.isFinite(nowSeconds) || nowSeconds <= 0) reasons.push('server_clock_invalid');
  if (!Number.isFinite(spreadLimit) || spreadLimit < 0) reasons.push('market_safety_config_invalid');
  if (!Number.isFinite(maxAge) || maxAge < 0) reasons.push('market_safety_config_invalid');

  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    reasons.push('market_safety_missing');
    return { allowed: false, reasons: [...new Set(reasons)], quoteAgeSeconds: null };
  }

  if (snapshot.allowed !== true) {
    const reported = String(snapshot.reason || '').trim();
    reasons.push(REPORTED_BLOCK_REASONS.has(reported) ? reported : 'market_safety_blocked');
  }

  if (typeof snapshot.anomaly_active !== 'boolean' ||
      !Number.isInteger(Number(snapshot.stable_tick_count)) ||
      Number(snapshot.stable_tick_count) < 0) {
    reasons.push('market_safety_payload_incomplete');
  }
  if (snapshot.anomaly_active === true) reasons.push('tick_anomaly_recovery');

  const quoteTime = Number(snapshot.quote_time_utc);
  let quoteAgeSeconds = null;
  if (!Number.isFinite(quoteTime) || quoteTime <= 0) {
    reasons.push('quote_time_invalid');
  } else if (Number.isFinite(nowSeconds)) {
    quoteAgeSeconds = nowSeconds - quoteTime;
    if (quoteAgeSeconds > maxAge) reasons.push('quote_stale');
    if (quoteAgeSeconds < -FUTURE_TOLERANCE_SECONDS) reasons.push('quote_time_in_future');
  }

  const bid = Number(features.bid);
  const ask = Number(features.ask);
  const featureSpread = Number(features.spread);
  const point = Number(features.point);
  const snapshotMid = Number(snapshot.mid_price);
  const snapshotSpread = Number(snapshot.spread_price);
  const tolerance = Math.max(0.02, Number.isFinite(point) && point > 0 ? point * 2 : 0.02);

  if (![bid, ask, featureSpread, snapshotMid, snapshotSpread].every(Number.isFinite) ||
      bid <= 0 || ask < bid || featureSpread < 0 || snapshotSpread < 0) {
    reasons.push('quote_invalid');
  } else {
    const expectedMid = (bid + ask) / 2;
    const expectedSpread = ask - bid;
    if (Math.abs(snapshotMid - expectedMid) > tolerance ||
        Math.abs(snapshotSpread - expectedSpread) > tolerance) {
      reasons.push('market_safety_quote_mismatch');
    }
    if (featureSpread > spreadLimit || snapshotSpread > spreadLimit) {
      reasons.push('spread_too_wide');
    }
  }

  const lockUntil = Number(snapshot.reopen_lock_until_utc || 0);
  if (!Number.isFinite(lockUntil) || lockUntil < 0) {
    reasons.push('market_safety_payload_incomplete');
  } else if (Number.isFinite(nowSeconds) && lockUntil > nowSeconds) {
    reasons.push('market_reopen_lock');
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    allowed: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    quoteAgeSeconds,
    quoteTimeUtc: Number.isFinite(quoteTime) ? quoteTime : null,
    maxSpreadPrice: spreadLimit,
    maxQuoteAgeSeconds: maxAge
  };
}
