import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSignalRows, summarizeTradeResultRows, summarizeGoldFilterFunnel, summarizeGoldRangeAtr, summarizeEurUsdSetup } from '../src/forward_monitor.js';

test('summarizeSignalRows counts candidate and decision distribution', () => {
  const result = summarizeSignalRows([
    { candidate: 'BUY', decision: 'BUY', created_at: '2026-10-08T00:00:00Z' },
    { candidate: 'WAIT', decision: 'WAIT', created_at: '2026-10-08T00:01:00Z' },
    { candidate: 'SELL', decision: 'WAIT', created_at: '2026-10-08T00:02:00Z' }
  ]);
  assert.deepEqual(result.candidate, { BUY: 1, SELL: 1, WAIT: 1 });
  assert.deepEqual(result.decision, { BUY: 1, SELL: 0, WAIT: 2 });
  assert.equal(result.latest_candidate, 'SELL');
  assert.equal(result.latest_decision, 'WAIT');
  assert.equal(result.latest_wait_reason, null);
  assert.deepEqual(result.reason_counts, {});
});

test('summarizeTradeResultRows computes PF expectancy and win rate', () => {
  const result = summarizeTradeResultRows([
    { result: 'WIN', r_multiple: 2 },
    { result: 'LOSS', r_multiple: -1 },
    { result: 'BREAKEVEN', r_multiple: 0 }
  ]);
  assert.equal(result.results_total, 3);
  assert.equal(result.wins, 1);
  assert.equal(result.losses, 1);
  assert.equal(result.breakeven, 1);
  assert.ok(Math.abs(result.win_rate_pct - (100 / 3)) < 1e-12);
  assert.equal(result.net_r, 1);
  assert.equal(result.profit_factor, 2);
  assert.equal(result.expectancy_r, 1 / 3);
});


test('summarizeSignalRows exposes latest WAIT reason and reason distribution', () => {
  const result = summarizeSignalRows([
    { candidate: 'WAIT', decision: 'WAIT', reason: 'h1_trend_filter', created_at: '2026-10-08T00:00:00Z' },
    { candidate: 'WAIT', decision: 'WAIT', reason: 'breakout_trigger_filter', created_at: '2026-10-08T00:01:00Z' },
    { candidate: 'BUY', decision: 'BUY', reason: 'trend_compression_breakout_confirmed', created_at: '2026-10-08T00:02:00Z' }
  ]);
  assert.equal(result.latest_reason, 'trend_compression_breakout_confirmed');
  assert.equal(result.latest_wait_reason, 'breakout_trigger_filter');
  assert.deepEqual(result.reason_counts, {
    h1_trend_filter: 1,
    breakout_trigger_filter: 1,
    trend_compression_breakout_confirmed: 1
  });
});


test('summarizeGoldFilterFunnel calculates sequential filter pass rates', () => {
  const result = summarizeGoldFilterFunnel([
    { reason: 'h1_trend_filter' },
    { reason: 'compression_filter' },
    { reason: 'compression_filter' },
    { reason: 'volume_expansion_filter' },
    { reason: 'm5_rsi_filter' },
    { reason: 'trend_compression_breakout_confirmed' },
    { reason: 'Rule filter found no eligible setup.' }
  ]);
  assert.equal(result.sampled_rows, 7);
  assert.equal(result.recognized_rows, 6);
  assert.equal(result.unclassified_rows, 1);
  assert.equal(result.coverage_pct, 6 / 7 * 100);

  const h1 = result.stages.find(stage => stage.reason === 'h1_trend_filter');
  const compression = result.stages.find(stage => stage.reason === 'compression_filter');
  const volume = result.stages.find(stage => stage.reason === 'volume_expansion_filter');
  const rsi = result.stages.find(stage => stage.reason === 'm5_rsi_filter');
  const confirmed = result.stages.find(stage => stage.reason === 'trend_compression_breakout_confirmed');

  assert.deepEqual(h1, {
    reason: 'h1_trend_filter', label: 'H1トレンド', reached: 6, failed: 1, passed: 5, pass_rate_pct: 5 / 6 * 100
  });
  assert.deepEqual(compression, {
    reason: 'compression_filter', label: 'レンジ圧縮', reached: 5, failed: 2, passed: 3, pass_rate_pct: 3 / 5 * 100
  });
  assert.equal(volume.failed, 1);
  assert.equal(rsi.failed, 1);
  assert.equal(confirmed.passed, 1);
});


test('summarizeGoldRangeAtr reports observed range width against configured bounds', () => {
  const result = summarizeGoldRangeAtr([
    { invalid_reasons: ['GOLD_V2_DIAG:{"range_atr":0.5,"min_range_atr":0.8,"max_range_atr":2.8}'] },
    { invalid_reasons: ['GOLD_V2_DIAG:{"range_atr":0.9,"min_range_atr":0.8,"max_range_atr":2.8}'] },
    { invalid_reasons: ['GOLD_V2_DIAG:{"range_atr":1.4,"min_range_atr":0.8,"max_range_atr":2.8}'] },
    { invalid_reasons: ['GOLD_V2_DIAG:{"range_atr":3.2,"min_range_atr":0.8,"max_range_atr":2.8}'] },
    { invalid_reasons: ['unrelated'] }
  ]);
  assert.equal(result.observations, 4);
  assert.equal(result.min, 0.5);
  assert.equal(result.median, 0.9);
  assert.equal(result.max, 3.2);
  assert.equal(result.below_min, 1);
  assert.equal(result.in_range, 2);
  assert.equal(result.above_max, 1);
  assert.equal(result.configured_min, 0.8);
  assert.equal(result.configured_max, 2.8);
});


test('summarizeEurUsdSetup excludes unavailable and legacy RANGE breakout distances from averages', () => {
  const result = summarizeEurUsdSetup([
    { invalid_reasons: [
      'EURUSD_SETUP_DIAG:{"trend":"UP","range_width_atr":2.2,"breakout_distance_atr":0.15,"breakout_body_atr":0.4,"breakout_close_location":0.75,"volume_ratio":1.2,"spread_pips":1.0,"spread_atr_pct":9}'
    ] },
    // Simulate a pre-fix row: a negative value stored for a RANGE regime must be ignored.
    { invalid_reasons: [
      'EURUSD_SETUP_DIAG:{"trend":"RANGE","range_width_atr":1.8,"breakout_distance_atr":-1.92,"breakout_body_atr":0.6,"breakout_close_location":0.6,"volume_ratio":0.8,"spread_pips":2.0,"spread_atr_pct":18}'
    ] },
    { invalid_reasons: [
      'EURUSD_SETUP_DIAG:{"trend":"DOWN","range_width_atr":1.6,"breakout_distance_atr":null,"breakout_body_atr":0.5,"breakout_close_location":0.25,"volume_ratio":1.1,"spread_pips":0.8,"spread_atr_pct":8}'
    ] }
  ]);
  assert.equal(result.observations, 3);
  assert.equal(result.averages.range_width_atr, (2.2 + 1.8 + 1.6) / 3);
  assert.equal(result.averages.breakout_distance_atr, 0.15);
  assert.equal(result.averages.spread_pips, (1 + 2 + 0.8) / 3);
});

test('summarizeEurUsdSetup exposes technical WAIT reasons and averages', () => {
  const result = summarizeEurUsdSetup([
    {
      invalid_reasons: [
        'technical_setup_wait',
        'range_width_outside_atr_band',
        'EURUSD_SETUP_DIAG:{"trend":"UP","range_width_atr":2.4,"breakout_distance_atr":0.05,"breakout_body_atr":0.25,"breakout_close_location":0.61,"volume_ratio":0.9,"spread_pips":1.0,"spread_atr_pct":10}'
      ]
    },
    {
      invalid_reasons: [
        'technical_setup_wait',
        'breakout_penetration_too_small',
        'EURUSD_SETUP_DIAG:{"trend":"DOWN","range_width_atr":1.6,"breakout_distance_atr":0.02,"breakout_body_atr":0.31,"breakout_close_location":0.68,"volume_ratio":1.1,"spread_pips":0.8,"spread_atr_pct":8}'
      ]
    }
  ]);
  assert.equal(result.observations, 2);
  assert.equal(result.reason_counts.technical_setup_wait, 2);
  assert.equal(result.reason_counts.range_width_outside_atr_band, 1);
  assert.equal(result.reason_counts.breakout_penetration_too_small, 1);
  assert.equal(result.averages.range_width_atr, 2);
  assert.equal(result.averages.breakout_distance_atr, 0.035);
  assert.equal(result.averages.spread_pips, 0.9);
});


test('summarizeEurUsdSetup reports spread percentiles, captured gate failures, and UTC-hour buckets', () => {
  const result = summarizeEurUsdSetup([
    {
      created_at: '2026-10-09T01:15:00Z',
      invalid_reasons: [
        'EURUSD_SETUP_DIAG:{"trend":"UP","spread_pips":2.1,"spread_limit_pips":1.2,"spread_atr_gate_passed":true,"setup_reasons":["spread_filter_failed"]}'
      ]
    },
    {
      created_at: '2026-10-09T01:45:00Z',
      invalid_reasons: [
        'EURUSD_SETUP_DIAG:{"trend":"UP","spread_pips":0.8,"spread_limit_pips":1.2,"spread_atr_gate_passed":true,"setup_reasons":[]}'
      ]
    },
    {
      created_at: '2026-10-09T02:15:00Z',
      invalid_reasons: [
        'EURUSD_SETUP_DIAG:{"trend":"DOWN","spread_pips":1.5,"spread_limit_pips":1.0,"spread_atr_gate_passed":false,"setup_reasons":["spread_filter_failed"]}'
      ]
    }
  ], { spreadLimitPips: 1.2 });

  const spread = result.spread_distribution;
  assert.equal(spread.count, 3);
  assert.equal(spread.limit_pips, 1.2);
  assert.equal(spread.min, 0.8);
  assert.equal(spread.median, 1.5);
  assert.ok(Math.abs(spread.p90 - 1.98) < 1e-12);
  assert.equal(spread.max, 2.1);
  assert.equal(spread.over_limit_count, 2);
  assert.ok(Math.abs(spread.over_limit_pct - (2 / 3 * 100)) < 1e-12);
  assert.equal(spread.pips_gate_failed_count, 2);
  assert.equal(spread.atr_gate_failed_count, 1);
  assert.equal(spread.combined_filter_failed_count, 2);
  assert.equal(spread.time_basis, 'signal_created_at_utc');
  assert.deepEqual(spread.by_utc_hour.map(hour => hour.hour), [1, 2]);
  assert.deepEqual(spread.by_utc_hour.map(hour => hour.count), [2, 1]);
  assert.equal(spread.by_utc_hour[0].over_limit_count, 1);
  assert.equal(spread.by_utc_hour[1].over_limit_count, 1);
});
