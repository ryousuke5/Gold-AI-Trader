import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoldMarketSafety } from '../src/gold_market_safety.js';

const nowMs = Date.UTC(2026, 9, 26, 7, 0, 10);
const features = {
  bid: 4097.08,
  ask: 4097.36,
  spread: 0.28,
  point: 0.01
};

function snapshot(overrides = {}) {
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

test('allows a fresh, internally consistent quote below the existing 0.50 cap', () => {
  const result = evaluateGoldMarketSafety(snapshot(), features, { nowMs });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.quoteAgeSeconds, 5);
});

test('fails closed when the MT4 market-safety snapshot is absent', () => {
  const result = evaluateGoldMarketSafety(null, features, { nowMs });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('market_safety_missing'));
});

test('blocks a Sunday market-reopen lock', () => {
  const result = evaluateGoldMarketSafety(
    snapshot({ allowed: false, reason: 'market_reopen_lock', reopen_lock_until_utc: nowMs / 1000 + 900 }),
    features,
    { nowMs }
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('market_reopen_lock'));
});

test('blocks a price-jump recovery state', () => {
  const result = evaluateGoldMarketSafety(
    snapshot({ allowed: false, reason: 'tick_anomaly_recovery', anomaly_active: true }),
    features,
    { nowMs }
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('tick_anomaly_recovery'));
});

test('keeps the spread limit at 0.50 and rejects values above it', () => {
  const wideFeatures = { ...features, ask: 4097.90, spread: 0.82 };
  const wideSnapshot = snapshot({ mid_price: (wideFeatures.bid + wideFeatures.ask) / 2, spread_price: 0.82 });
  const result = evaluateGoldMarketSafety(wideSnapshot, wideFeatures, { nowMs, maxSpreadPrice: 0.50 });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('spread_too_wide'));
});

test('blocks stale and future quote timestamps', () => {
  const stale = evaluateGoldMarketSafety(
    snapshot({ quote_time_utc: nowMs / 1000 - 45 }),
    features,
    { nowMs, maxQuoteAgeSeconds: 30 }
  );
  assert.ok(stale.reasons.includes('quote_stale'));

  const future = evaluateGoldMarketSafety(
    snapshot({ quote_time_utc: nowMs / 1000 + 20 }),
    features,
    { nowMs }
  );
  assert.ok(future.reasons.includes('quote_time_in_future'));
});

test('blocks a safety snapshot whose quote does not match the signal payload', () => {
  const result = evaluateGoldMarketSafety(snapshot({ mid_price: 4098.00 }), features, { nowMs });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('market_safety_quote_mismatch'));
});

test('blocks incomplete safety payloads', () => {
  const result = evaluateGoldMarketSafety(
    snapshot({ anomaly_active: undefined, stable_tick_count: undefined }),
    features,
    { nowMs }
  );
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('market_safety_payload_incomplete'));
});
