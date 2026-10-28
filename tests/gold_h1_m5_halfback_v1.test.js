import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldH1M5HalfbackV1Setup } from '../src/gold_h1_m5_halfback_v1.js';
import { buildGoldH1M5HalfbackV2Setup } from '../src/gold_h1_m5_halfback_v2.js';
import { normalizeBacktestStrategyVariant } from '../scripts/backtest-gold-v2.mjs';
import { normalizeFeatures } from '../src/features.js';

function bullishFeatures() {
  const start = Date.parse('2026-01-12T13:00:00Z') / 1000;
  const bars = [];
  for (let i = 0; i < 21; i++) {
    const time = start + i * 300;
    let high = 104 + i * 0.8;
    let low = high - 2;
    let open = high - 1.4;
    let close = high - 0.7;
    if (i === 8) low = 100;          // confirmed swing low
    if (i === 18) { high = 120; low = 118; open = 119; close = 119.5; } // impulse high
    if (i === 19) { high = 112; low = 110; open = 111.5; close = 110.5; } // 50% pullback
    if (i === 20) { high = 115; low = 110.5; open = 111; close = 114; } // bullish reconfirmation
    bars.push({ time, open, high, low, close, volume: 100 });
  }
  return {
    m5: { ema20: 112, ema50: 110, rsi14: 58, atr14: 2 },
    h1: { close: 120, ema20: 116, ema50: 110, ema200: 100, rsi14: 60, atr14: 8 },
    recentM5: bars
  };
}

function bearishFeatures() {
  const start = Date.parse('2026-01-12T13:00:00Z') / 1000;
  const bars = [];
  for (let i = 0; i < 21; i++) {
    let high = 119 - i * 0.9;
    let low = high - 2;
    let open = low + 1.4;
    let close = low + 0.7;
    if (i === 8) { high = 120; low = 118; open = 119; close = 118.5; } // impulse high
    if (i === 18) { high = 102; low = 100; open = 101; close = 100.5; } // confirmed swing low
    if (i === 19) { high = 110; low = 108; open = 108.5; close = 109.5; } // 50% pullback
    if (i === 20) { high = 109.5; low = 105; open = 109; close = 106; } // bearish reconfirmation
    bars.push({ time: start + i * 300, open, high, low, close, volume: 100 });
  }
  return {
    m5: { ema20: 108, ema50: 110, rsi14: 42, atr14: 2 },
    h1: { close: 100, ema20: 104, ema50: 110, ema200: 120, rsi14: 40, atr14: 8 },
    recentM5: bars
  };
}

test('halfback V1 emits a BUY only after confirmed H1 uptrend + 45–55% M5 retrace + reconfirmation', () => {
  const setup = buildGoldH1M5HalfbackV1Setup(bullishFeatures());
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'H1_TREND_M5_HALFBACK_50');
  assert.equal(setup.reason, 'halfback_reconfirmed');
  assert.ok(setup.diagnostics.observed_retracement >= 0.45);
  assert.ok(setup.diagnostics.observed_retracement <= 0.55);
  assert.ok(setup.stop_loss < setup.entry_reference);
  assert.ok(setup.take_profit > setup.entry_reference);
  assert.equal(setup.risk_reward, 2);
});

test('halfback V1 mirrors the setup for a confirmed H1 downtrend', () => {
  const setup = buildGoldH1M5HalfbackV1Setup(bearishFeatures());
  assert.equal(setup.candidate, 'SELL');
  assert.equal(setup.reason, 'halfback_reconfirmed');
  assert.ok(setup.stop_loss > setup.entry_reference);
  assert.ok(setup.take_profit < setup.entry_reference);
});

test('halfback V1 rejects a shallow pullback outside the fixed zone', () => {
  const features = bullishFeatures();
  features.recentM5.at(-2).low = 117;
  const setup = buildGoldH1M5HalfbackV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'halfback_zone_not_touched');
});

test('halfback V1 does not treat the latest unconfirmed high as a confirmed impulse pivot', () => {
  const features = bullishFeatures();
  features.recentM5 = features.recentM5.slice(0, 19);
  const setup = buildGoldH1M5HalfbackV1Setup(features);
  assert.equal(setup.candidate, 'WAIT');
});

test('backtest selector accepts the independent halfback variant and rejects typos', () => {
  assert.equal(normalizeBacktestStrategyVariant('HALFBACK_V1'), 'halfback_v1');
  assert.equal(normalizeBacktestStrategyVariant('HALFBACK_V2'), 'halfback_v2');
  assert.throws(() => normalizeBacktestStrategyVariant('halfback'), /Invalid GOLD_BACKTEST_STRATEGY_VARIANT/);
});

test('feature normalization retains up to 64 completed M5 candles for confirmed pivots', () => {
  const recent_m5 = Array.from({ length: 80 }, (_, i) => ({
    time: 1700000000 + i * 300, open: 100, high: 101, low: 99, close: 100.5, volume: 10
  }));
  const normalized = normalizeFeatures({
    bid: 100, ask: 100.1, point: 0.01, spread: 0.1, spread_points: 10,
    bar_time: recent_m5.at(-1).time,
    m5: { ema20: 100, ema50: 99, rsi14: 55, atr14: 1, high20: 101, low20: 99 },
    h1: { close: 100, ema20: 99, ema50: 98, ema200: 95, rsi14: 55, atr14: 4 },
    recent_m5
  });
  assert.equal(normalized.recentM5.length, 64);
  assert.equal(normalized.recentM5[0].time, recent_m5.at(-64).time);
  assert.equal(normalized.recentM5.at(-1).time, recent_m5.at(-1).time);
});


test('halfback V2 requires an EMA20 reclaim and aligned rising slope for BUY', () => {
  const features = bullishFeatures();
  features.recentM5.forEach((bar, i) => { bar.ema20 = 100 + i * 0.4; });
  features.recentM5.at(-4).ema20 = 109.5;
  features.recentM5.at(-3).ema20 = 110;
  features.recentM5.at(-2).ema20 = 111;
  features.recentM5.at(-1).ema20 = 112;
  const setup = buildGoldH1M5HalfbackV2Setup(features);
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'H1_TREND_M5_HALFBACK_EMA20_RECLAIM_V2');
  assert.equal(setup.reason, 'halfback_ema20_reclaimed');
  assert.equal(setup.diagnostics.ema20_reclaimed, true);
  assert.equal(setup.diagnostics.ema20_slope_aligned, true);
});

test('halfback V2 mirrors the EMA20 reclaim and falling slope for SELL', () => {
  const features = bearishFeatures();
  features.recentM5.forEach((bar, i) => { bar.ema20 = 120 - i * 0.4; });
  features.recentM5.at(-4).ema20 = 110;
  features.recentM5.at(-3).ema20 = 109.5;
  features.recentM5.at(-2).ema20 = 109;
  features.recentM5.at(-1).ema20 = 108.5;
  const setup = buildGoldH1M5HalfbackV2Setup(features);
  assert.equal(setup.candidate, 'SELL');
  assert.equal(setup.reason, 'halfback_ema20_reclaimed');
});

test('halfback V2 rejects a halfback setup when M5 EMA20 slope is not aligned', () => {
  const features = bullishFeatures();
  features.recentM5.forEach((bar, i) => { bar.ema20 = 108; });
  features.recentM5.at(-4).ema20 = 112;
  features.recentM5.at(-3).ema20 = 113;
  features.recentM5.at(-2).ema20 = 113;
  features.recentM5.at(-1).ema20 = 111;
  const setup = buildGoldH1M5HalfbackV2Setup(features);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'm5_ema20_slope_not_aligned');
});
