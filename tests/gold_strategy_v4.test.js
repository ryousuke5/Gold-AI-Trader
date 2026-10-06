import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldV4Setup } from '../src/gold_strategy_v4.js';

function buyFeatures() {
  const start = Date.parse('2026-01-12T13:00:00Z') / 1000;
  const recentM5 = [];
  for (let i = 0; i < 12; i += 1) {
    const time = start + i * 300;
    const center = 2500 + (i % 2) * 0.1;
    recentM5.push({
      time, open: center, high: center + 2.0, low: center - 2.0,
      close: center + 0.1, volume: 100, atr14: 2
    });
  }
  recentM5.push({ time: start + 12 * 300, open: 2501.0, high: 2505.0, low: 2500.9, close: 2504.5, volume: 150, atr14: 2 });
  recentM5.push({ time: start + 13 * 300, open: 2504.4, high: 2504.8, low: 2502.3, close: 2503.4, volume: 105, atr14: 2 });
  recentM5.push({ time: start + 14 * 300, open: 2503.4, high: 2504.8, low: 2503.1, close: 2504.2, volume: 110, atr14: 2 });
  return {
    m5: { ema20: 2502.0, ema50: 2500, rsi14: 60, atr14: 2 },
    h1: { close: 2505, ema20: 2498, ema50: 2490, ema200: 2470, rsi14: 60, atr14: 8 },
    recentM5
  };
}

test('GOLD V4 accepts breakout -> retest -> confirmation BUY', () => {
  const result = buildGoldV4Setup(buyFeatures());
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.setup_type, 'H1_TREND_RANGE_BREAKOUT_RETEST');
  assert.equal(result.reason, 'breakout_retest_confirmed');
  assert.ok(result.diagnostics.breakout_age_bars >= 1);
  assert.ok(result.diagnostics.retest_depth_atr <= 0.35);
  assert.ok(result.stop_loss < result.entry_reference);
  assert.ok(result.take_profit > result.entry_reference);
  assert.equal(result.risk_reward, 2);
});

test('GOLD V4 rejects weak breakout volume', () => {
  const f = buyFeatures();
  f.recentM5[12].volume = 105;
  const result = buildGoldV4Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'no_valid_breakout_retest');
});

test('GOLD V4 rejects a retest that is too deep', () => {
  const f = buyFeatures();
  f.recentM5[13].low = 2500.8;
  const result = buildGoldV4Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'no_valid_breakout_retest');
});

test('GOLD V4 rejects missing retest', () => {
  const f = buyFeatures();
  f.recentM5[13].low = 2504.0;
  const result = buildGoldV4Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'no_valid_breakout_retest');
});

test('GOLD V4 rejects out-of-session signal', () => {
  const f = buyFeatures();
  const d = new Date(f.recentM5.at(-1).time * 1000);
  d.setUTCHours(3, 0, 0, 0);
  f.recentM5.at(-1).time = Math.floor(d.getTime() / 1000);
  const result = buildGoldV4Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'session_filter');
});

test('GOLD V4 rejects a missing H1 trend', () => {
  const f = buyFeatures();
  f.h1.close = 2460;
  f.h1.ema20 = 2470;
  f.h1.ema50 = 2480;
  f.h1.ema200 = 2490;
  f.h1.rsi14 = 55;
  const result = buildGoldV4Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'h1_trend_filter');
});

test('GOLD V4 accepts a SELL retest', () => {
  const f = buyFeatures();
  const start = f.recentM5[0].time;
  const rs = f.recentM5.map((b, i) => ({ ...b, time: start + i * 300 }));
  for (let i = 0; i < 12; i += 1) {
    rs[i] = { ...rs[i], open: 2500, high: 2502, low: 2498, close: 2499.9, volume: 100, atr14: 3 };
  }
  rs[12] = { ...rs[12], open: 2499, high: 2499.2, low: 2495, close: 2495.5, volume: 150, atr14: 3 };
  rs[13] = { ...rs[13], open: 2495.6, high: 2497.8, low: 2494.8, close: 2496.7, volume: 105, atr14: 3 };
  rs[14] = { ...rs[14], open: 2496.7, high: 2496.8, low: 2494.8, close: 2495.2, volume: 110, atr14: 3 };
  f.recentM5 = rs;
  f.m5.ema20 = 2496.0;
  f.m5.rsi14 = 40;
  f.m5.atr14 = 3;
  f.h1.close = 2495;
  f.h1.ema20 = 2502;
  f.h1.ema50 = 2510;
  f.h1.ema200 = 2530;
  f.h1.rsi14 = 40;
  const result = buildGoldV4Setup(f);
  assert.equal(result.candidate, 'SELL');
  assert.equal(result.trend, 'DOWN');
  assert.ok(result.stop_loss > result.entry_reference);
  assert.ok(result.take_profit < result.entry_reference);
});

test('GOLD V4 pipeline accepts normalized completed-bar input', async () => {
  const { normalizeFeatures } = await import('../src/features.js');
  const f = buyFeatures();
  const normalized = normalizeFeatures({
    bid: 2504.1, ask: 2504.2, point: 0.01, spread: 0.1, spread_points: 10,
    bar_time: f.recentM5.at(-1).time,
    m5: { ema20: f.m5.ema20, ema50: f.m5.ema50, rsi14: f.m5.rsi14, atr14: f.m5.atr14 },
    h1: f.h1, recent_m5: f.recentM5
  });
  const result = buildGoldV4Setup(normalized);
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.setup_type, 'H1_TREND_RANGE_BREAKOUT_RETEST');
});

test('GOLD V4 safely rejects insufficient history', () => {
  const f = buyFeatures();
  f.recentM5 = f.recentM5.slice(-5);
  const result = buildGoldV4Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'missing_or_invalid_features');
});
