import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGoldRangeAtr } from '../src/forward_monitor.js';
import { buildGoldSignalDiagnosticLog } from '../src/gold_signal_diagnostics.js';

function row(diagnostics) {
  return {
    invalid_reasons: [
      'GOLD_V2_DIAG:' + JSON.stringify(diagnostics),
      'GOLD_V2_RANGE_ATR:' + diagnostics.range_atr
    ]
  };
}

test('Gold Range ATR summary reports volume ratio distribution and threshold pass rate', () => {
  const rows = [
    row({ range_atr: 2, min_range_atr: 0.8, max_range_atr: 2.8, volume_ratio: 0.9, min_volume_ratio: 1.1, average_volume: 100, volume_confirmation: false }),
    row({ range_atr: 2.2, min_range_atr: 0.8, max_range_atr: 2.8, volume_ratio: 1.2, min_volume_ratio: 1.1, average_volume: 100, volume_confirmation: true }),
    row({ range_atr: 2.4, min_range_atr: 0.8, max_range_atr: 2.8, volume_ratio: 1.5, min_volume_ratio: 1.1, average_volume: 100, volume_confirmation: true })
  ];
  const summary = summarizeGoldRangeAtr(rows);
  assert.equal(summary.volume_ratio.observations, 3);
  assert.equal(summary.volume_ratio.mean, 1.2);
  assert.equal(summary.volume_ratio.median, 1.2);
  assert.equal(summary.volume_ratio.below_threshold_count, 1);
  assert.equal(summary.volume_ratio.confirmed_count, 2);
  assert.equal(summary.volume_ratio.configured_min_volume_ratio, 1.1);
});

test('Gold Range ATR summary reports BUY/SELL breakout failures and shortfall metrics', () => {
  const rows = [
    row({
      range_atr: 2, min_range_atr: 0.8, max_range_atr: 2.8,
      breakout_direction: 'BUY', breakout_distance: 0.1, breakout_atr: 0.05,
      required_breakout_atr: 0.1, required_breakout_distance: 0.2,
      breakout_shortfall: 0.1, breakout_threshold_met: false
    }),
    row({
      range_atr: 2.1, min_range_atr: 0.8, max_range_atr: 2.8,
      breakout_direction: 'SELL', breakout_distance: 0.3, breakout_atr: 0.15,
      required_breakout_atr: 0.1, required_breakout_distance: 0.2,
      breakout_shortfall: 0, breakout_threshold_met: true
    }),
    row({
      range_atr: 2.2, min_range_atr: 0.8, max_range_atr: 2.8,
      breakout_direction: 'SELL', breakout_distance: 0.08, breakout_atr: 0.04,
      required_breakout_atr: 0.1, required_breakout_distance: 0.2,
      breakout_shortfall: 0.12, breakout_threshold_met: false
    })
  ];
  const summary = summarizeGoldRangeAtr(rows);
  assert.equal(summary.breakout.observations, 3);
  assert.equal(summary.breakout.buy_count, 1);
  assert.equal(summary.breakout.sell_count, 2);
  assert.equal(summary.breakout.threshold_failed_count, 2);
  assert.equal(summary.breakout.threshold_met_count, 1);
  assert.ok(Math.abs(summary.breakout.mean_atr - 0.08) < 1e-9);
  assert.ok(Math.abs(summary.breakout.mean_shortfall - (0.22 / 3)) < 1e-9);
  assert.equal(summary.breakout.max_shortfall, 0.12);
});

test('Gold structured signal log records volume ratio, its threshold, and confirmation outcome', () => {
  const log = buildGoldSignalDiagnosticLog({
    requestId: 'test-request',
    signal: { id: 'test-signal', symbol: 'GOLD#', timeframe: 'M5', candidate: 'WAIT', decision: 'WAIT', reason: 'volume_expansion_filter' },
    setup: { reason: 'volume_expansion_filter', diagnostics: {
      range_atr: 2, min_range_atr: 0.8, max_range_atr: 2.8,
      body_atr: 0.7, close_location: 0.2,
      signal_volume: 90, average_volume: 100,
      volume_ratio: 0.9, min_volume_ratio: 1.1, volume_confirmation: false,
      breakout_direction: 'SELL', breakout_distance: 0.1, breakout_atr: 0.05,
      required_breakout_atr: 0.1, required_breakout_distance: 0.2,
      breakout_shortfall: 0.1, breakout_threshold_met: false
    } },
    risk: { approved: false },
    state: { mode: 'ANALYSIS', auto_trading_enabled: false }
  });
  assert.equal(log.volume_ratio, 0.9);
  assert.equal(log.min_volume_ratio, 1.1);
  assert.equal(log.volume_confirmation, false);
  assert.equal(log.signal_volume, 90);
  assert.equal(log.average_volume, 100);
  assert.equal(log.body_atr, 0.7);
  assert.equal(log.breakout_direction, 'SELL');
  assert.equal(log.breakout_distance, 0.1);
  assert.equal(log.breakout_atr, 0.05);
  assert.equal(log.required_breakout_atr, 0.1);
  assert.equal(log.required_breakout_distance, 0.2);
  assert.equal(log.breakout_shortfall, 0.1);
  assert.equal(log.breakout_threshold_met, false);
});
