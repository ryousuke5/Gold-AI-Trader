import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTradeExit, summarizeExitMechanisms } from '../src/trade_exit_diagnostics.js';

test('classifies a stop touched in the first entry candle separately', () => {
  assert.equal(classifyTradeExit({ exit_reason: 'STOP', holding_bars: 1, net_r: -1 }), 'ENTRY_BAR_STOP_LOSS');
  assert.equal(classifyTradeExit({ exit_reason: 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE', holding_bars: 1, net_r: -1 }), 'ENTRY_BAR_STOP_LOSS');
});

test('classifies a later stop separately from a loss at the holding-time limit', () => {
  assert.equal(classifyTradeExit({ exit_reason: 'STOP', holding_bars: 3, net_r: -1 }), 'LATER_STOP_LOSS');
  assert.equal(classifyTradeExit({ exit_reason: 'TIME', holding_bars: 12, net_r: -0.25 }), 'TIME_EXIT_LOSS');
  assert.equal(classifyTradeExit({ exit_reason: 'TIME', holding_bars: 12, net_r: 0.4 }), 'TIME_EXIT_WIN');
});

test('summary compares entry-bar stops with timed losses using features, side, hour and excursions', () => {
  const result = summarizeExitMechanisms([
    { exit_reason: 'STOP', holding_bars: 1, net_r: -1, side: 'BUY', hour_utc: 8, range_atr: 1.1, breakout_atr: 0.2, body_atr: 0.7, extension_atr: 0.8, volume_ratio: 1.3, mfe_r: 0.2, mae_r: 1 },
    { exit_reason: 'TIME', holding_bars: 12, net_r: -0.3, side: 'SELL', hour_utc: 13, range_atr: 2.2, breakout_atr: 0.8, body_atr: 0.5, extension_atr: 1.4, volume_ratio: 1.8, mfe_r: 0.6, mae_r: 0.7 },
    { exit_reason: 'TARGET', holding_bars: 4, net_r: 2, side: 'BUY', hour_utc: 8, range_atr: 1.3, breakout_atr: 0.5, body_atr: 0.9, extension_atr: 0.6, volume_ratio: 1.5, mfe_r: 2.1, mae_r: 0.4 }
  ]);

  assert.equal(result.sample_size, 3);
  assert.equal(result.loss_trades, 2);
  assert.equal(result.classification_counts.ENTRY_BAR_STOP_LOSS, 1);
  assert.equal(result.classification_counts.TIME_EXIT_LOSS, 1);
  assert.equal(result.classification_counts.TARGET_EXIT, 1);
  assert.equal(result.entry_bar_stop_vs_time_exit_loss.entry_bar_stop.feature_means.range_atr.mean, 1.1);
  assert.equal(result.entry_bar_stop_vs_time_exit_loss.entry_bar_stop.by_side.BUY.trades, 1);
  assert.equal(result.entry_bar_stop_vs_time_exit_loss.time_exit_loss.by_utc_hour['13'].trades, 1);
  assert.equal(result.entry_bar_stop_vs_time_exit_loss.time_exit_loss.average_mae_r.mean, 0.7);
});
