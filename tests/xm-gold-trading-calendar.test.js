import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyXmGoldGap,
  expectedXmGoldGapPair,
  nicosiaOffsetHours,
  UNVERIFIED_XM_GAP_CLASSES,
} from '../src/xm_gold_trading_calendar.js';

const ts = (value) => Math.floor(Date.parse(value) / 1000);

test('XM GOLD daily pause maps to 21:00–22:00 UTC during server GMT+3 season', () => {
  const start = ts('2026-07-08T20:55:00Z');
  const next = ts('2026-07-08T22:00:00Z');
  const gap = classifyXmGoldGap(start, next);
  assert.equal(nicosiaOffsetHours(ts('2026-07-08T21:00:00Z')), 3);
  assert.equal(expectedXmGoldGapPair(ts('2026-07-08T21:00:00Z')), '21:00>22:00');
  assert.equal(gap.classification, 'scheduled_daily_maintenance');
});

test('XM GOLD daily pause maps to 22:00–23:00 UTC during server GMT+2 season', () => {
  const start = ts('2026-12-09T21:55:00Z');
  const next = ts('2026-12-09T23:00:00Z');
  const gap = classifyXmGoldGap(start, next);
  assert.equal(nicosiaOffsetHours(ts('2026-12-09T22:00:00Z')), 2);
  assert.equal(expectedXmGoldGapPair(ts('2026-12-09T22:00:00Z')), '22:00>23:00');
  assert.equal(gap.classification, 'scheduled_daily_maintenance');
});

test('normal Friday-to-Sunday interval is a planned weekend closure', () => {
  const previous = ts('2026-07-10T20:55:00Z');
  const reopen = ts('2026-07-12T22:00:00Z');
  const gap = classifyXmGoldGap(previous, reopen);
  assert.equal(gap.classification, 'scheduled_weekend_closure');
  assert.equal(UNVERIFIED_XM_GAP_CLASSES.has(gap.classification), false);
});

test('repeated but off-schedule intraday gap is not falsely certified as broker maintenance', () => {
  const previous = ts('2026-07-08T18:25:00Z');
  const next = ts('2026-07-08T19:30:00Z');
  const gap = classifyXmGoldGap(previous, next, 30);
  assert.equal(gap.classification, 'recurring_window_gap_not_confirmed_by_xm_hours');
  assert.equal(UNVERIFIED_XM_GAP_CLASSES.has(gap.classification), true);
});

test('gap near a daylight-saving transition is held for explicit review', () => {
  const previous = ts('2026-10-22T18:25:00Z');
  const next = ts('2026-10-22T18:55:00Z');
  const gap = classifyXmGoldGap(previous, next);
  assert.equal(gap.classification, 'dst_transition_window_review');
  assert.equal(UNVERIFIED_XM_GAP_CLASSES.has(gap.classification), true);
});

test('non-recurring intraday feed outage is classified as unverified', () => {
  const previous = ts('2026-06-10T15:00:00Z');
  const next = ts('2026-06-10T15:40:00Z');
  const gap = classifyXmGoldGap(previous, next);
  assert.equal(gap.classification, 'irregular_feed_gap_or_session_change');
  assert.equal(UNVERIFIED_XM_GAP_CLASSES.has(gap.classification), true);
});
