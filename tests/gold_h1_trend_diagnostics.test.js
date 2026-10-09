import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldV2Setup } from '../src/gold_strategy_v2.js';
import { buildGoldV2H1TrendDiagnostics } from '../src/gold_h1_trend_diagnostics.js';
import { summarizeGoldH1Trend } from '../src/forward_monitor.js';

function featuresWithUnclearH1() {
  const time = Date.parse('2026-10-09T13:00:00Z') / 1000;
  return {
    m5: { ema20: 2501.5, ema50: 2499, rsi14: 60, atr14: 2 },
    h1: { close: 2500, ema20: 2501, ema50: 2500, ema200: 2502, rsi14: 20, atr14: 8 },
    recentM5: [{
      time: time - 300,
      open: 2500,
      high: 2502,
      low: 2498,
      close: 2501,
      volume: 100
    }, {
      time,
      open: 2501,
      high: 2503,
      low: 2499,
      close: 2502,
      volume: 120
    }]
  };
}

test('GOLD V2 H1 trend rejection exposes independent directional blockers without changing WAIT', () => {
  const features = featuresWithUnclearH1();
  const setup = buildGoldV2Setup(features);
  const diagnostic = buildGoldV2H1TrendDiagnostics(features);

  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'h1_trend_filter');
  assert.deepEqual(diagnostic.h1_up_failure_components, [
    'close_not_above_ema20',
    'ema20_not_above_ema50',
    'ema50_not_above_ema200',
    'rsi_outside_buy_band'
  ]);
  assert.deepEqual(diagnostic.h1_down_failure_components, [
    'ema20_not_below_ema50',
    'rsi_outside_sell_band'
  ]);
  assert.ok(Number.isFinite(diagnostic.h1_close_vs_ema20_atr));
  assert.ok(Number.isFinite(diagnostic.h1_ema20_vs_ema50_atr));
  assert.ok(Number.isFinite(diagnostic.h1_ema50_vs_ema200_atr));
});

test('GOLD V2 H1 diagnostic summary counts overlapping blockers without treating them as a sequential funnel', () => {
  const features = featuresWithUnclearH1();
  const diagnostic = buildGoldV2H1TrendDiagnostics(features);
  const summary = summarizeGoldH1Trend([{
    reason: 'h1_trend_filter',
    invalid_reasons: ['h1_trend_filter', 'GOLD_V2_DIAG:' + JSON.stringify(diagnostic)]
  }]);

  assert.equal(summary.observations, 1);
  assert.equal(summary.trend_filter_rejected_count, 1);
  assert.equal(summary.trend_filter_passed_count, 0);
  assert.equal(summary.up_blockers.find(x => x.key === 'close_not_above_ema20').failed_count, 1);
  assert.equal(summary.up_blockers.find(x => x.key === 'rsi_outside_buy_band').failed_count, 1);
  assert.equal(summary.down_blockers.find(x => x.key === 'ema20_not_below_ema50').failed_count, 1);
});

test('GOLD V2 H1 diagnostic rejects missing or zero-ATR data safely', () => {
  assert.equal(buildGoldV2H1TrendDiagnostics({ h1: {} }), null);
  assert.equal(buildGoldV2H1TrendDiagnostics({
    h1: { close: 1, ema20: 1, ema50: 1, ema200: 1, rsi14: 50, atr14: 0 }
  }), null);
});
