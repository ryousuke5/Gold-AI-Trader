import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEurUsdSafety, getEurUsdSafetyConfig } from '../src/eurusd_safety_gate.js';
import { parseEurUsdNewsPayload } from '../src/eurusd_news_feed.js';

const baseConfig = {
  ...getEurUsdSafetyConfig({
    EURUSD_NEWS_REQUIRE_FEED: 'false',
    EURUSD_REQUIRE_GAP_DATA: 'false'
  })
};

function ts(value) {
  return Date.parse(value);
}

test('blocks Friday before weekend market close', () => {
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-09T20:30:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05 },
    config: baseConfig,
    newsFeed: { fetchedAtMs: ts('2026-10-09T20:00:00Z'), events: [] }
  });
  assert.equal(result.newOrdersAllowed, false);
  assert.match(result.reasons.join(','), /weekend_friday_cutoff/);
});

test('blocks daily rollover window', () => {
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-08T21:59:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05 },
    config: baseConfig,
    newsFeed: { fetchedAtMs: ts('2026-10-08T21:30:00Z'), events: [] }
  });
  assert.equal(result.newOrdersAllowed, false);
  assert.match(result.reasons.join(','), /daily_rollover_window/);
});

test('blocks Monday when weekend gap is excessive', () => {
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-12T08:00:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.80 },
    config: baseConfig,
    newsFeed: { fetchedAtMs: ts('2026-10-12T07:30:00Z'), events: [] }
  });
  assert.equal(result.newOrdersAllowed, false);
  assert.match(result.reasons.join(','), /weekend_gap_too_large/);
});

test('fails closed when Monday gap data is missing', () => {
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-12T08:00:00Z'),
    safety: { weekend_gap_known: false },
    config: { ...baseConfig, requireWeekendGapData: true },
    newsFeed: { fetchedAtMs: ts('2026-10-12T07:30:00Z'), events: [] }
  });
  assert.equal(result.newOrdersAllowed, false);
  assert.match(result.reasons.join(','), /weekend_gap_data_missing/);
});

test('blocks high-impact EUR event before release and after release', () => {
  const event = { name: 'ECB Rate Decision', currency: 'EUR', impact: 'HIGH', scheduled_at: '2026-10-08T13:15:00Z' };
  const feed = { fetchedAtMs: ts('2026-10-08T13:30:00Z'), events: [event] };

  const before = evaluateEurUsdSafety({
    nowMs: ts('2026-10-08T12:30:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05 },
    config: baseConfig,
    newsFeed: feed
  });
  assert.equal(before.newOrdersAllowed, false);
  assert.equal(before.blockingNews.name, 'ECB Rate Decision');

  const after = evaluateEurUsdSafety({
    nowMs: ts('2026-10-08T13:45:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05 },
    config: baseConfig,
    newsFeed: feed
  });
  assert.equal(after.newOrdersAllowed, false);
});

test('fails closed when news feed is stale', () => {
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-08T15:00:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05 },
    config: { ...baseConfig, newsFeedRequired: true, newsFeedMaxAgeSeconds: 1800 },
    newsFeed: { fetchedAtMs: ts('2026-10-08T14:00:00Z'), events: [] }
  });
  assert.equal(result.newOrdersAllowed, false);
  assert.match(result.reasons.join(','), /news_feed_missing_or_stale/);
});

test('forces close when position exceeds maximum hold time', () => {
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-08T15:00:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05, oldest_position_age_seconds: 3601 },
    config: baseConfig,
    newsFeed: { fetchedAtMs: ts('2026-10-08T14:45:00Z'), events: [] }
  });
  assert.equal(result.forceClose, true);
  assert.match(result.actions.join(','), /FORCE_CLOSE_OLDEST_POSITION/);
});

test('force closes positions in the high-impact news exposure window', () => {
  const event = { name: 'NFP', currency: 'USD', impact: 'HIGH', scheduled_at: '2026-10-08T13:15:00Z' };
  const feed = { fetchedAtMs: ts('2026-10-08T13:00:00Z'), events: [event] };
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-08T13:05:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05, oldest_position_age_seconds: 120 },
    config: { ...baseConfig, highImpactForceClosePreMinutes: 15, highImpactForceClosePostMinutes: 15 },
    newsFeed: feed
  });
  assert.equal(result.forceClose, true);
  assert.match(result.actions.join(','), /FORCE_CLOSE_NEWS_EXPOSED_POSITIONS/);
});

test('force closes positions before the configured Friday cutoff window', () => {
  const result = evaluateEurUsdSafety({
    nowMs: ts('2026-10-09T20:45:00Z'),
    safety: { weekend_gap_known: true, weekend_gap_atr: 0.05, oldest_position_age_seconds: 120 },
    config: baseConfig,
    newsFeed: { fetchedAtMs: ts('2026-10-09T20:30:00Z'), events: [] }
  });
  assert.equal(result.forceClose, true);
  assert.match(result.actions.join(','), /FORCE_CLOSE_WEEKEND_POSITIONS/);
});

test('economic calendar parser accepts a valid empty high-impact event list', () => {
  assert.deepEqual(parseEurUsdNewsPayload([]), []);
  assert.deepEqual(parseEurUsdNewsPayload({ events: [] }), []);
});

test('economic calendar parser fails closed on an invalid payload shape', () => {
  assert.throws(() => parseEurUsdNewsPayload({ data: [] }), /news_feed_invalid_shape/);
});
