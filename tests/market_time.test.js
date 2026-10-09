import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUtcBarTimestamp } from '../src/market_time.js';

const now = Date.parse('2026-10-09T12:50:05Z');
const completedBar = Date.parse('2026-10-09T12:50:00Z') / 1000;

test('accepts a recent completed UTC M5 bar', () => {
  assert.deepEqual(validateUtcBarTimestamp(completedBar, { nowMs: now }), {
    ok: true, reason: null, age_seconds: 5, future_seconds: 0
  });
});

test('rejects a broker-time bar accidentally sent three hours ahead as UTC', () => {
  const brokerTimeMistakenForUtc = Date.parse('2026-10-09T15:50:00Z') / 1000;
  const result = validateUtcBarTimestamp(brokerTimeMistakenForUtc, { nowMs: now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bar_time_in_future');
  assert.equal(result.future_seconds, 10795);
});

test('rejects timestamps farther in the future than the configured tolerance', () => {
  const futureBar = completedBar + 31;
  const result = validateUtcBarTimestamp(futureBar, { nowMs: now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bar_time_in_future');
  assert.equal(result.future_seconds, 26);
});

test('accepts a bar within the configured future tolerance', () => {
  const slightlyFutureBar = completedBar + 20;
  assert.equal(validateUtcBarTimestamp(slightlyFutureBar, { nowMs: now }).ok, true);
});

test('rejects stale completed bars', () => {
  const staleBar = completedBar - 120;
  const result = validateUtcBarTimestamp(staleBar, { nowMs: now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'bar_time_too_old');
  assert.equal(result.age_seconds, 125);
});

test('rejects invalid bar timestamps and invalid server clocks', () => {
  assert.equal(validateUtcBarTimestamp(0, { nowMs: now }).reason, 'invalid_bar_time');
  assert.equal(validateUtcBarTimestamp(Number.NaN, { nowMs: now }).reason, 'invalid_bar_time');
  assert.equal(validateUtcBarTimestamp(completedBar, { nowMs: 0 }).reason, 'invalid_server_clock');
});

test('rejects invalid validation settings', () => {
  assert.equal(validateUtcBarTimestamp(completedBar, { nowMs: now, maxAgeSeconds: -1 }).reason, 'invalid_time_validation_config');
});
