import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldV2Setup } from '../src/gold_strategy_v2.js';

function features({ rangeHigh = 101, rangeLow = 99, signalVolume = 90 } = {}) {
  const start = Math.floor(Date.UTC(2024, 0, 3, 12, 0, 0) / 1000);
  const prior = Array.from({ length: 12 }, (_, i) => ({
    time: start + i * 300,
    open: 100,
    high: rangeHigh,
    low: rangeLow,
    close: 100,
    volume: 100
  }));
  const signal = {
    time: start + 12 * 300,
    open: 98.6,
    high: 98.8,
    low: 97.4,
    close: 97.6,
    volume: signalVolume
  };
  return {
    recentM5: [...prior, signal],
    m5: { ema20: 98, ema50: 99, rsi14: 35, atr14: 1 },
    h1: { close: 90, ema20: 100, ema50: 105, ema200: 110, rsi14: 35, atr14: 1 }
  };
}

test('volume rejection includes the observed ratio and threshold without changing WAIT reason', () => {
  const setup = buildGoldV2Setup(features());
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'volume_expansion_filter');
  assert.equal(setup.diagnostics.volume_ratio, 0.9);
  assert.equal(setup.diagnostics.min_volume_ratio, 1.1);
  assert.equal(setup.diagnostics.volume_confirmation, false);
  assert.equal(setup.diagnostics.signal_volume, 90);
  assert.equal(setup.diagnostics.average_volume, 100);
  assert.equal(setup.diagnostics.body_atr, 1);
  assert.equal(setup.diagnostics.range_atr, 2);
});

test('volume metrics remain visible when Range ATR rejects the setup earlier', () => {
  const setup = buildGoldV2Setup(features({ rangeHigh: 104, rangeLow: 99 }));
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'compression_filter');
  assert.equal(setup.diagnostics.range_atr, 5);
  assert.equal(setup.diagnostics.volume_ratio, 0.9);
  assert.equal(setup.diagnostics.volume_confirmation, false);
});
