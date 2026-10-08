import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldV2Setup } from '../src/gold_strategy_v2.js';

function baseFeatures() {
  const t = Date.parse('2026-01-12T13:00:00Z') / 1000;
  const recentM5 = [];
  for (let i = 0; i < 12; i++) {
    const time = t - (12 - i) * 300;
    const center = 2502 + (i % 2) * 0.2;
    recentM5.push({
      time,
      open: center,
      high: center + 1.0,
      low: center - 1.0,
      close: center + 0.2,
      volume: 100
    });
  }
  recentM5.push({
    time: t,
    open: 2502,
    high: 2504.5,
    low: 2501.2,
    close: 2504.0,
    volume: 140
  });
  return {
    m5: { ema20: 2501.5, ema50: 2499.0, rsi14: 60, atr14: 2.0 },
    h1: { close: 2504, ema20: 2498, ema50: 2490, ema200: 2470, rsi14: 60, atr14: 8 },
    recentM5
  };
}

test('GOLD V2 accepts a valid in-session compression breakout', () => {
  const result = buildGoldV2Setup(baseFeatures());
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.trend, 'UP');
  assert.equal(result.setup_type, 'H1_TREND_M5_COMPRESSION_BREAKOUT');
  assert.ok(result.stop_loss < result.entry_reference);
  assert.ok(result.take_profit > result.entry_reference);
  assert.equal(result.risk_reward, 2);
});

test('GOLD V2 rejects a weak volume expansion', () => {
  const f = baseFeatures();
  f.recentM5.at(-1).volume = 105;
  const result = buildGoldV2Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'volume_expansion_filter');
});

test('GOLD V2 rejects a signal outside the configured session', () => {
  const f = baseFeatures();
  f.recentM5.at(-1).time = Date.parse('2026-01-12T03:00:00Z') / 1000;
  const result = buildGoldV2Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'session_filter');
});

test('GOLD V2 rejects a signal against H1 trend', () => {
  const f = baseFeatures();
  f.h1.close = 2460;
  f.h1.ema20 = 2470;
  f.h1.ema50 = 2480;
  f.h1.ema200 = 2490;
  f.h1.rsi14 = 55;
  const result = buildGoldV2Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'h1_trend_filter');
});


test('GOLD V2 pipeline accepts normalized MT4-style completed-bar input', async () => {
  const { normalizeFeatures } = await import('../src/features.js');
  const input = {
    bid: 2504.01,
    ask: 2504.11,
    point: 0.01,
    spread: 0.10,
    spread_points: 10,
    bar_time: Date.parse('2026-01-12T13:00:00Z') / 1000,
    m5: { ema20: 2501.5, ema50: 2499.0, rsi14: 60, atr14: 2.0, high20: 2504.5, low20: 2500.0 },
    h1: { close: 2504, ema20: 2498, ema50: 2490, ema200: 2470, rsi14: 60, atr14: 8 },
    recent_m5: baseFeatures().recentM5,
    recent_h1: []
  };
  const normalized = normalizeFeatures(input);
  assert.equal(normalized.recentM5.length, 13);
  assert.equal(normalized.h1.close, 2504);
  const result = buildGoldV2Setup(normalized);
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.setup_type, 'H1_TREND_M5_COMPRESSION_BREAKOUT');
});

test('GOLD V2 pipeline rejects malformed or insufficient history safely', async () => {
  const { normalizeFeatures } = await import('../src/features.js');
  const normalized = normalizeFeatures({
    bid: 2500, ask: 2500.1, point: 0.01, spread: 0.1, spread_points: 10,
    bar_time: Date.parse('2026-01-12T13:00:00Z') / 1000,
    m5: { ema20: 2501.5, ema50: 2499.0, rsi14: 60, atr14: 2.0 },
    h1: { close: 2504, ema20: 2498, ema50: 2490, ema200: 2470, rsi14: 60, atr14: 8 },
    recent_m5: []
  });
  const result = buildGoldV2Setup(normalized);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'missing_or_invalid_features');
});


test('GOLD V2 identifies M5 RSI as a separate breakout rejection reason', () => {
  const f = baseFeatures();
  f.m5.rsi14 = 49;
  const result = buildGoldV2Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'm5_rsi_filter');
});

test('GOLD V2 identifies close location as a separate breakout rejection reason', () => {
  const f = baseFeatures();
  f.recentM5.at(-1).close = 2502.0;
  const result = buildGoldV2Setup(f);
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'close_location_filter');
});
