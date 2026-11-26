import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLD_M5_EMA20_PULLBACK_BREAKOUT_V1,
  buildGoldM5Ema20PullbackBreakoutV1Setup
} from '../src/gold_m5_ema20_pullback_breakout_v1.js';
import { normalizeBacktestStrategyVariant } from '../scripts/backtest-gold-v2.mjs';

function bullishFeatures() {
  const start = Date.parse('2026-01-12T13:00:00Z') / 1000;
  const bars = Array.from({ length: 20 }, (_, i) => {
    const ema20 = 100 + i * 0.1;
    return {
      time: start + i * 300,
      open: ema20 + 0.45,
      high: ema20 + 0.80,
      low: ema20 + 0.30,
      close: ema20 + 0.65,
      ema20,
      atr14: 2,
      volume: 100
    };
  });

  // A completed EMA20 pullback that holds the trend structure.
  bars[15] = {
    ...bars[15], open: 101.8, high: 102.0, low: 101.0, close: 101.4
  };
  // Local highs after the pullback; the signal candle must close above all 3.
  bars[16] = { ...bars[16], open: 102.0, high: 102.7, low: 101.9, close: 102.4 };
  bars[17] = { ...bars[17], open: 102.3, high: 103.0, low: 102.1, close: 102.7 };
  bars[18] = { ...bars[18], open: 102.6, high: 102.9, low: 102.4, close: 102.5 };
  bars[19] = { ...bars[19], open: 102.7, high: 103.9, low: 102.6, close: 103.6 };

  return {
    m5: { ema20: bars.at(-1).ema20, atr14: 2 },
    h1: { close: 120, ema20: 115, ema50: 110, ema200: 100, atr14: 8 },
    recentM5: bars
  };
}

test('EMA20 pullback breakout V1 emits BUY for H1 uptrend + EMA20 touch + rising EMA20 + 3-bar high close breakout', () => {
  const features = bullishFeatures();
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);

  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'H1_TREND_M5_EMA20_PULLBACK_BREAKOUT_V1');
  assert.equal(setup.reason, 'ema20_pullback_breakout_confirmed');
  assert.equal(setup.diagnostics.pullback_age_bars, 4);
  assert.ok(setup.diagnostics.pullback_touch_depth_atr >= -GOLD_M5_EMA20_PULLBACK_BREAKOUT_V1.touchToleranceAtr);
  assert.ok(setup.diagnostics.pullback_touch_depth_atr <= GOLD_M5_EMA20_PULLBACK_BREAKOUT_V1.maxLowBelowEmaAtr);
  assert.ok(setup.entry_reference > setup.diagnostics.breakout_level);
  assert.ok(setup.stop_loss < setup.entry_reference);
  assert.ok(setup.take_profit > setup.entry_reference);
  assert.equal(setup.risk_reward, 2);
});

test('EMA20 pullback breakout V1 rejects a market without the strict completed-H1 uptrend', () => {
  const features = bullishFeatures();
  features.h1.ema50 = 116;
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'h1_uptrend_filter');
});

test('EMA20 pullback breakout V1 rejects when EMA20 is flat or falling over the fixed 3-bar slope window', () => {
  const features = bullishFeatures();
  const slopeIndex = features.recentM5.length - 1 - GOLD_M5_EMA20_PULLBACK_BREAKOUT_V1.ema20SlopeLookbackBars;
  features.recentM5[slopeIndex].ema20 = features.recentM5.at(-1).ema20 + 0.01;
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'm5_ema20_not_rising');
});

test('EMA20 pullback breakout V1 rejects a candle that never touched the EMA20 zone', () => {
  const features = bullishFeatures();
  features.recentM5[15].low = 102.0;
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'ema20_pullback_not_found');
});

test('EMA20 pullback breakout V1 rejects if price closes too far below EMA20 after the pullback', () => {
  const features = bullishFeatures();
  features.recentM5[17].close = 100.0;
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'pullback_structure_invalidated');
});

test('EMA20 pullback breakout V1 requires a close above the highest high of the prior 3 bars', () => {
  const features = bullishFeatures();
  features.recentM5.at(-1).close = 103.0;
  features.recentM5.at(-1).open = 102.0;
  features.recentM5.at(-1).high = 104.0;
  features.recentM5.at(-1).low = 100.5;
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'recent_high_breakout_not_confirmed');
});

test('EMA20 pullback breakout V1 rejects noncontiguous M5 bars', () => {
  const features = bullishFeatures();
  features.recentM5[17].time += 300;
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'noncontiguous_confirmation_bars');
});

test('EMA20 pullback breakout V1 is BUY-only and has no short-side mirror', () => {
  const features = bullishFeatures();
  features.h1 = { close: 90, ema20: 95, ema50: 100, ema200: 110, atr14: 8 };
  const setup = buildGoldM5Ema20PullbackBreakoutV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'h1_uptrend_filter');
});

test('backtest selector accepts the independent EMA20 pullback breakout variant', () => {
  assert.equal(
    normalizeBacktestStrategyVariant('EMA20_PULLBACK_BREAKOUT_V1'),
    'ema20_pullback_breakout_v1'
  );
  assert.throws(
    () => normalizeBacktestStrategyVariant('ema20_pullback_breakout'),
    /Invalid GOLD_BACKTEST_STRATEGY_VARIANT/
  );
});
