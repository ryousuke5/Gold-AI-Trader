import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeFeatures } from '../src/features.js';
import { buildGoldH1M5PullbackV1Setup } from '../src/gold_h1_m5_pullback_v1.js';
import { normalizeBacktestStrategyVariant } from '../scripts/backtest-gold-v2.mjs';

const baseTime = Date.parse('2026-10-28T13:00:00Z') / 1000;

function buyPayload() {
  return {
    bid: 2504.01, ask: 2504.11, point: 0.01, spread: 0.10, spread_points: 10, bar_time: baseTime,
    m5: { ema20: 2501.5, ema50: 2499.0, rsi14: 60, atr14: 2.0 },
    h1: { close: 2504, ema20: 2498, ema50: 2490, ema200: 2470, rsi14: 60, atr14: 8 },
    recent_m5: [
      { time: baseTime-900, open: 2502.0, high: 2503.0, low: 2501.0, close: 2502.2, volume: 100, ema20: 2501.5, atr14: 2.0 },
      { time: baseTime-600, open: 2502.1, high: 2503.1, low: 2501.1, close: 2502.3, volume: 105, ema20: 2501.5, atr14: 2.0 },
      { time: baseTime-300, open: 2502.0, high: 2503.2, low: 2501.2, close: 2501.8, volume: 95, ema20: 2501.5, atr14: 2.0 },
      { time: baseTime, open: 2502.0, high: 2504.4, low: 2501.8, close: 2504.1, volume: 130, ema20: 2501.5, atr14: 2.0 }
    ]
  };
}

function sellPayload() {
  const payload = buyPayload();
  payload.m5 = { ema20: 2501.5, ema50: 2504.0, rsi14: 40, atr14: 2.0 };
  payload.h1 = { close: 2490, ema20: 2498, ema50: 2500, ema200: 2510, rsi14: 40, atr14: 8 };
  payload.recent_m5 = [
    { time: baseTime-900, open: 2502.0, high: 2503.0, low: 2501.0, close: 2502.0, volume: 100, ema20: 2501.5, atr14: 2.0 },
    { time: baseTime-600, open: 2502.1, high: 2503.1, low: 2501.1, close: 2502.0, volume: 105, ema20: 2501.5, atr14: 2.0 },
    { time: baseTime-300, open: 2502.0, high: 2502.1, low: 2500.9, close: 2501.8, volume: 95, ema20: 2501.5, atr14: 2.0 },
    { time: baseTime, open: 2501.3, high: 2501.4, low: 2499.5, close: 2499.8, volume: 130, ema20: 2501.5, atr14: 2.0 }
  ];
  return payload;
}

test('Pullback V1 preserves historical EMA/ATR and accepts a confirmed bullish pullback', () => {
  const features = normalizeFeatures(buyPayload());
  assert.equal(features.recentM5.at(-2).ema20, 2501.5);
  assert.equal(features.recentM5.at(-2).atr14, 2.0);
  const result = buildGoldH1M5PullbackV1Setup(features);
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.setup_type, 'H1_TREND_M5_PULLBACK_RECONFIRM');
  assert.ok(result.stop_loss < result.entry_reference);
  assert.ok(result.take_profit > result.entry_reference);
  assert.equal(result.risk_reward, 2);
});

test('Pullback V1 accepts a confirmed bearish pullback in an H1 downtrend', () => {
  const result = buildGoldH1M5PullbackV1Setup(normalizeFeatures(sellPayload()));
  assert.equal(result.candidate, 'SELL');
  assert.ok(result.stop_loss > result.entry_reference);
  assert.ok(result.take_profit < result.entry_reference);
});

test('Pullback V1 rejects mismatched M5 signal timestamps', () => {
  const payload = buyPayload();
  payload.bar_time += 300;
  const result = buildGoldH1M5PullbackV1Setup(normalizeFeatures(payload));
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'm5_bar_time_mismatch');
});

test('Pullback V1 fails closed on missing pullback ATR / EMA values', () => {
  const payload = buyPayload();
  delete payload.recent_m5[2].atr14;
  const result = buildGoldH1M5PullbackV1Setup(normalizeFeatures(payload));
  assert.equal(result.candidate, 'WAIT');
  assert.equal(result.reason, 'missing_or_invalid_features');
});

test('Pullback V1 is opt-in and existing backtest default remains GOLD V2', () => {
  assert.equal(normalizeBacktestStrategyVariant(), 'breakout_v2');
  assert.equal(normalizeBacktestStrategyVariant('h1_m5_pullback_v1'), 'h1_m5_pullback_v1');
  assert.throws(() => normalizeBacktestStrategyVariant('unknown'), /h1_m5_pullback_v1/);
});

test('Pullback V1 has an independent endpoint and a non-executing MT4 bridge', () => {
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const ea = fs.readFileSync(new URL('../mt4/GoldAITraderPullbackV1.mq4', import.meta.url), 'utf8');
  assert.ok(server.includes("'/api/gold/pullback/signal'"));
  assert.ok(server.includes("'gold-h1-m5-pullback-v1'"));
  assert.match(server, /orderAllowed=requestStrategyVersion!=='gold-h1-m5-pullback-v1'/);
  assert.ok(ea.includes('/api/gold/pullback/signal'));
  assert.ok(ea.includes('"ema20"'));
  assert.ok(ea.includes('"atr14"'));
  assert.match(ea, /input bool\s+AllowAutoOrders\s*=\s*false;/);
  assert.doesNotMatch(ea, /OrderSend\s*\(/);
});
