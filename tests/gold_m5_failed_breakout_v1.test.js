import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldM5FailedBreakoutV1Setup } from '../src/gold_m5_failed_breakout_v1.js';
import { normalizeBacktestStrategyVariant } from '../scripts/backtest-gold-v2.mjs';

function failedHighSweepFeatures() {
  const start = Date.parse('2024-02-12T13:00:00Z') / 1000;
  const bars = Array.from({ length: 13 }, (_, i) => ({
    time: start + i * 300,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 100
  }));
  bars[12] = {
    time: start + 12 * 300,
    open: 101,
    high: 101.2,
    low: 99.5,
    close: 100,
    volume: 150
  };
  return {
    m5: { atr14: 1 },
    h1: { close: 100.5, ema20: 100, ema50: 100.2, atr14: 5 },
    recentM5: bars
  };
}

function failedLowSweepFeatures() {
  const f = failedHighSweepFeatures();
  const signal = f.recentM5.at(-1);
  signal.open = 99;
  signal.high = 100.5;
  signal.low = 98.8;
  signal.close = 100;
  signal.volume = 150;
  return f;
}

test('failed-breakout V1 sells a confirmed high sweep that closes back inside the prior M5 range', () => {
  const setup = buildGoldM5FailedBreakoutV1Setup(failedHighSweepFeatures());
  assert.equal(setup.candidate, 'SELL');
  assert.equal(setup.setup_type, 'M5_FAILED_BREAKOUT_REVERSAL_V1');
  assert.equal(setup.reason, 'failed_breakout_reversal_confirmed');
  assert.ok(setup.stop_loss > setup.entry_reference);
  assert.ok(setup.take_profit < setup.entry_reference);
  assert.equal(setup.risk_reward, 1.5);
  assert.ok(setup.diagnostics.swept_high_atr >= 0.1);
  assert.equal(setup.diagnostics.inside_range_close, true);
});

test('failed-breakout V1 buys a confirmed low sweep that closes back inside the prior M5 range', () => {
  const setup = buildGoldM5FailedBreakoutV1Setup(failedLowSweepFeatures());
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.reason, 'failed_breakout_reversal_confirmed');
  assert.ok(setup.stop_loss < setup.entry_reference);
  assert.ok(setup.take_profit > setup.entry_reference);
  assert.ok(setup.diagnostics.swept_low_atr >= 0.1);
});

test('failed-breakout V1 rejects a breakout candle that does not close back inside the prior range', () => {
  const features = failedHighSweepFeatures();
  features.recentM5.at(-1).close = 102;
  const setup = buildGoldM5FailedBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'failed_breakout_did_not_close_inside');
});

test('failed-breakout V1 rejects a strong H1 directional regime', () => {
  const features = failedHighSweepFeatures();
  features.h1 = { close: 120, ema20: 110, ema50: 100, atr14: 5 };
  const setup = buildGoldM5FailedBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'h1_not_range_like');
});

test('failed-breakout V1 rejects ambiguous candles that sweep both sides of the range', () => {
  const features = failedHighSweepFeatures();
  const signal = features.recentM5.at(-1);
  signal.open = 100.5;
  signal.high = 101.2;
  signal.low = 98.8;
  signal.close = 100;
  const setup = buildGoldM5FailedBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'ambiguous_double_sweep');
});

test('backtest selector accepts failed_breakout_v1 as an independent variant', () => {
  assert.equal(normalizeBacktestStrategyVariant('FAILED_BREAKOUT_V1'), 'failed_breakout_v1');
  assert.throws(() => normalizeBacktestStrategyVariant('failed_breakout'), /Invalid GOLD_BACKTEST_STRATEGY_VARIANT/);
});
