import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldDiagnosticsTracker } from '../src/gold_diagnostics.js';

test('records request freshness and spread warnings without affecting trade state', () => {
  const tracker = createGoldDiagnosticsTracker({ startedAtMs: Date.parse('2026-10-12T06:59:00.000Z') });
  const nowMs = Date.parse('2026-10-12T07:00:20.000Z');
  tracker.recordRequest({
    requestId: 'req-fresh',
    symbol: 'GOLD',
    timeframe: 'M5',
    features: {
      barTime: Date.parse('2026-10-12T07:00:00.000Z') / 1000,
      spread: 0.58
    },
    serverUtcOffsetSeconds: 10800,
    maxAgeSeconds: 90,
    maxSpreadPrice: 0.5,
    nowMs
  });

  const snapshot = tracker.getSnapshot(nowMs);
  assert.equal(snapshot.counters.requests_received, 1);
  assert.equal(snapshot.counters.spread_warnings, 1);
  assert.equal(snapshot.latest_request.timestamp_valid_at_receipt, true);
  assert.equal(snapshot.latest_request.bar_age_seconds, 20);
  assert.equal(snapshot.latest_request.server_utc_offset_seconds, 10800);
  assert.equal(snapshot.latest_request.outcome, 'RECEIVED');
  assert.equal(snapshot.counter_scope, 'process_lifetime');
});

test('counts stale and future bar rejections and duplicate responses separately', () => {
  const tracker = createGoldDiagnosticsTracker();
  const nowMs = Date.parse('2026-10-12T07:00:00.000Z');
  tracker.recordRequest({
    requestId: 'req-stale',
    symbol: 'GOLD',
    timeframe: 'M5',
    features: { barTime: Date.parse('2026-10-12T06:55:00.000Z') / 1000 },
    nowMs,
    maxAgeSeconds: 90
  });
  tracker.recordTimeRejection({
    requestId: 'req-stale',
    reason: 'bar_time_too_old',
    ageSeconds: 300,
    futureSeconds: 0,
    nowMs
  });

  tracker.recordRequest({
    requestId: 'req-duplicate',
    symbol: 'GOLD',
    timeframe: 'M5',
    features: { barTime: Date.parse('2026-10-12T07:00:00.000Z') / 1000 },
    nowMs,
    maxAgeSeconds: 90
  });
  tracker.recordOutcome({ requestId: 'req-duplicate', outcome: 'DUPLICATE_BAR' });

  const snapshot = tracker.getSnapshot(nowMs);
  assert.equal(snapshot.counters.time_rejections, 1);
  assert.equal(snapshot.counters.stale_bar_rejections, 1);
  assert.equal(snapshot.counters.future_bar_rejections, 0);
  assert.equal(snapshot.counters.duplicate_bar_responses, 1);
  assert.equal(snapshot.latest_request.outcome, 'DUPLICATE_BAR');
  assert.equal(snapshot.latest_time_rejection.reason, 'bar_time_too_old');
});

test('records the last evaluated signal and effective execution state', () => {
  const tracker = createGoldDiagnosticsTracker();
  const nowMs = Date.parse('2026-10-12T07:00:06.000Z');
  tracker.recordRequest({
    requestId: 'req-evaluated',
    symbol: 'GOLD',
    timeframe: 'M5',
    features: { barTime: Date.parse('2026-10-12T07:00:00.000Z') / 1000, spread: 0.3 },
    nowMs,
    maxAgeSeconds: 90,
    maxSpreadPrice: 0.5
  });
  tracker.recordEvaluated({
    requestId: 'req-evaluated',
    signal: {
      id: 'signal-1',
      bar_time: '2026-10-12T07:00:00.000Z',
      candidate: 'WAIT',
      decision: 'WAIT',
      reason: 'h1_trend_filter'
    },
    risk: { approved: false },
    state: { mode: 'ANALYSIS', auto_trading_enabled: false, emergency_stopped_at: null },
    nowMs
  });

  const snapshot = tracker.getSnapshot(nowMs);
  assert.equal(snapshot.counters.signal_evaluations, 1);
  assert.equal(snapshot.latest_request.outcome, 'SIGNAL_EVALUATED');
  assert.equal(snapshot.latest_request.decision, 'WAIT');
  assert.equal(snapshot.latest_request.auto_trading_enabled, false);
  assert.equal(snapshot.latest_signal.reason, 'h1_trend_filter');
  assert.equal(snapshot.latest_signal.risk_approved, false);
});
