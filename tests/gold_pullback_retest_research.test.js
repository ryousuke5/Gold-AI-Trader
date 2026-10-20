import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldPullbackRetestSetup } from '../src/gold_pullback_retest_research.js';
import { normalizeBacktestStrategyVariant } from '../scripts/backtest-gold-v2.mjs';

function pullbackBuyFeatures() {
  const baseTime = Date.parse('2026-01-12T13:00:00Z') / 1000;
  const priorBars = [
    { time: baseTime - 900, open: 2502.0, high: 2503.0, low: 2501.0, close: 2502.2, volume: 100, ema20: 2501.5, atr14: 2.0 },
    { time: baseTime - 600, open: 2502.1, high: 2503.1, low: 2501.1, close: 2502.3, volume: 105, ema20: 2501.5, atr14: 2.0 },
    { time: baseTime - 300, open: 2502.0, high: 2503.2, low: 2501.2, close: 2501.8, volume: 95, ema20: 2501.5, atr14: 2.0 }
  ];
  const signal = {
    time: baseTime, open: 2502.0, high: 2504.4, low: 2501.8, close: 2504.1,
    volume: 130, ema20: 2501.5, ema50: 2499.0, ema200: 2495.0, rsi14: 60, atr14: 2.0
  };
  return {
    m5: { ema20: 2501.5, ema50: 2499.0, rsi14: 60, atr14: 2.0 },
    h1: { close: 2504, ema20: 2498, ema50: 2490, ema200: 2470, rsi14: 60, atr14: 8 },
    recentM5: [...priorBars, signal]
  };
}

function pullbackSellFeatures() {
  const f = pullbackBuyFeatures();
  f.h1 = { close: 2490, ema20: 2498, ema50: 2500, ema200: 2510, rsi14: 40, atr14: 8 };
  f.m5 = { ema20: 2501.5, ema50: 2504, rsi14: 40, atr14: 2.0 };
  f.recentM5 = f.recentM5.map((bar) => ({
    ...bar,
    open: 5003.5 - (bar.open - 2502.0),
    high: 5003.5 - (bar.low - 2502.0),
    low: 5003.5 - (bar.high - 2502.0),
    close: 5003.5 - (bar.close - 2502.0),
    ema20: 5003.5 - (bar.ema20 - 2502.0),
    ema50: 5003.5 - (bar.ema50 - 2502.0),
    ema200: 5003.5 - (bar.ema200 - 2502.0)
  }));
  // Use a realistic down-trend scale, with a prior candle at the EMA20 and a
  // bearish confirmation candle closing beneath the prior low.
  const base = Date.parse('2026-01-12T13:00:00Z') / 1000;
  f.recentM5 = [
    { time: base - 900, open: 2502.0, high: 2503.0, low: 2501.0, close: 2502.0, volume: 100, ema20: 2501.5, atr14: 2 },
    { time: base - 600, open: 2502.1, high: 2503.1, low: 2501.1, close: 2502.0, volume: 105, ema20: 2501.5, atr14: 2 },
    { time: base - 300, open: 2502.0, high: 2502.1, low: 2500.9, close: 2501.8, volume: 95, ema20: 2501.5, atr14: 2 },
    { time: base, open: 2501.3, high: 2501.4, low: 2499.5, close: 2499.8, volume: 130, ema20: 2501.5, atr14: 2 }
  ];
  return f;
}

test('pullback/reconfirmation research strategy accepts a valid bullish retest', () => {
  const result = buildGoldPullbackRetestSetup(pullbackBuyFeatures());
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.setup_type, 'H1_TREND_M5_PULLBACK_RECONFIRM');
  assert.ok(result.stop_loss < result.entry_reference);
  assert.ok(result.take_profit > result.entry_reference);
  assert.equal(result.risk_reward, 2);
});

test('pullback/reconfirmation research strategy rejects a signal without a prior EMA20 touch', () => {
  const f = pullbackBuyFeatures();
  f.recentM5.at(-2).low = 2503.0;
  f.recentM5.at(-2).high = 2503.8;
  f.recentM5.at(-2).close = 2503.4;
  const result = buildGoldPullbackRetestSetup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'pullback_ema20_not_touched');
});

test('pullback/reconfirmation research strategy rejects noncontiguous pullback bars', () => {
  const f = pullbackBuyFeatures();
  f.recentM5.at(-1).time += 300;
  const result = buildGoldPullbackRetestSetup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'noncontiguous_confirmation_bars');
});

test('pullback/reconfirmation research strategy supports a mirrored bearish pattern', () => {
  const result = buildGoldPullbackRetestSetup(pullbackSellFeatures());
  assert.equal(result.candidate, 'SELL');
  assert.equal(result.setup_type, 'H1_TREND_M5_PULLBACK_RECONFIRM');
  assert.ok(result.stop_loss > result.entry_reference);
  assert.ok(result.take_profit < result.entry_reference);
});

test('research backtest variant selector defaults safely and rejects unknown strategies', () => {
  assert.equal(normalizeBacktestStrategyVariant(), 'breakout_v2');
  assert.equal(normalizeBacktestStrategyVariant('pullback_retest'), 'pullback_retest');
  assert.throws(() => normalizeBacktestStrategyVariant('live_auto'), /Use breakout_v2 or pullback_retest/);
});
