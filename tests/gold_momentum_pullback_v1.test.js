import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldMomentumPullbackV1Setup } from '../src/gold_momentum_pullback_v1.js';
import { normalizeBacktestStrategyVariant } from '../scripts/backtest-gold-v2.mjs';

function bullishFeatures() {
  const base = Date.parse('2026-01-12T13:00:00Z') / 1000;
  const recentM5 = [
    { time: base - 600, open: 101.0, high: 101.4, low: 100.9, close: 101.2, volume: 100 },
    { time: base - 300, open: 101.2, high: 101.4, low: 100.95, close: 101.2, volume: 100 },
    { time: base, open: 101.2, high: 102.2, low: 101.0, close: 102.0, volume: 120 }
  ];
  const recentH1 = [0, 1, 2, 3].map((i) => ({
    time: base - (3 - i) * 3600,
    open: 98 + i, high: 99 + i, low: 97 + i, close: 98 + i
  }));
  recentH1[3].close = 103;
  return {
    m5: { ema20: 101, ema50: 100.5, rsi14: 60, atr14: 1 },
    h1: { close: 103, ema20: 102, ema50: 100, ema200: 95, rsi14: 60, atr14: 10 },
    recentM5,
    recentH1
  };
}

function bearishFeatures() {
  const f = bullishFeatures();
  const base = f.recentM5.at(-1).time;
  f.recentM5 = [
    { time: base - 600, open: 101.0, high: 101.1, low: 100.9, close: 101.0, volume: 100 },
    { time: base - 300, open: 100.9, high: 101.1, low: 100.2, close: 100.8, volume: 100 },
    { time: base, open: 100.8, high: 101.0, low: 99.8, close: 100.0, volume: 120 }
  ];
  f.recentH1 = [0, 1, 2, 3].map((i) => ({
    time: base - (3 - i) * 3600,
    open: 103 - i, high: 104 - i, low: 102 - i, close: 103 - i
  }));
  f.recentH1[3].close = 98;
  f.m5 = { ema20: 101, ema50: 101.5, rsi14: 40, atr14: 1 };
  f.h1 = { close: 98, ema20: 99, ema50: 101, ema200: 106, rsi14: 40, atr14: 10 };
  return f;
}

test('momentum pullback V1 accepts a strong bullish H1 trend and M5 EMA20 pullback re-acceleration', () => {
  const result = buildGoldMomentumPullbackV1Setup(bullishFeatures());
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.setup_type, 'H1_MOMENTUM_M5_EMA20_PULLBACK_REACCELERATION');
  assert.equal(result.reason, 'trend_momentum_pullback_reaccelerated');
  assert.ok(result.stop_loss < result.entry_reference);
  assert.ok(result.take_profit > result.entry_reference);
  assert.equal(result.risk_reward, 2.5);
  assert.ok(result.diagnostics.h1_momentum_3_atr >= 0.35);
});

test('momentum pullback V1 mirrors the setup for a strong bearish trend', () => {
  const result = buildGoldMomentumPullbackV1Setup(bearishFeatures());
  assert.equal(result.candidate, 'SELL');
  assert.ok(result.stop_loss > result.entry_reference);
  assert.ok(result.take_profit < result.entry_reference);
  assert.equal(result.risk_reward, 2.5);
});

test('momentum pullback V1 rejects weak H1 momentum', () => {
  const f = bullishFeatures();
  f.recentH1[0].close = 100;
  f.recentH1[1].close = 101;
  f.recentH1[2].close = 101.5;
  f.recentH1[3].close = 102;
  f.h1.close = 102;
  const result = buildGoldMomentumPullbackV1Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'h1_trend_momentum_filter');
});

test('momentum pullback V1 rejects a pullback that breaks the EMA50 structure', () => {
  const f = bullishFeatures();
  f.recentM5.at(-2).low = 100.0;
  const result = buildGoldMomentumPullbackV1Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'pullback_broke_ema50_structure');
});

test('momentum pullback V1 rejects late entries extended far from EMA20', () => {
  const f = bullishFeatures();
  f.recentM5.at(-1).close = 102.2;
  f.recentM5.at(-1).high = 102.3;
  const result = buildGoldMomentumPullbackV1Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'late_entry_extension_filter');
});

test('momentum pullback V1 requires fully contiguous closed H1 bars', () => {
  const f = bullishFeatures();
  f.recentH1.at(-2).time += 1800;
  const result = buildGoldMomentumPullbackV1Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'insufficient_or_noncontiguous_h1_momentum');
});

test('backtest selector exposes the momentum pullback variant without changing default', () => {
  assert.equal(normalizeBacktestStrategyVariant(), 'breakout_v2');
  assert.equal(normalizeBacktestStrategyVariant('momentum_pullback_v1'), 'momentum_pullback_v1');
});
