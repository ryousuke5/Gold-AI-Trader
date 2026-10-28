import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldM5EmaCrossTrendV1Setup } from '../src/gold_m5_ema_cross_trend_v1.js';
import { normalizeBacktestStrategyVariant } from '../scripts/backtest-gold-v2.mjs';

const start = Date.parse('2026-01-12T13:00:00Z') / 1000;

function bars(side = 'BUY') {
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push({
      time: start + i * 300,
      open: side === 'BUY' ? 100.2 + i * 0.1 : 99.8 - i * 0.1,
      high: side === 'BUY' ? 101.2 + i * 0.1 : 100.8 - i * 0.1,
      low: side === 'BUY' ? 99.8 + i * 0.1 : 99.2 - i * 0.1,
      close: side === 'BUY' ? 100.8 + i * 0.1 : 99.2 - i * 0.1,
      ema20: 99,
      ema50: 100
    });
  }
  const prev = out.at(-2);
  const signal = out.at(-1);
  if (side === 'BUY') {
    prev.ema20 = 99; prev.ema50 = 100;
    signal.ema20 = 101; signal.ema50 = 100;
    signal.open = 101.2; signal.high = 103.4; signal.low = 100.8; signal.close = 103;
  } else {
    prev.ema20 = 101; prev.ema50 = 100;
    signal.ema20 = 99; signal.ema50 = 100;
    signal.open = 98.8; signal.high = 99.2; signal.low = 96.6; signal.close = 97;
  }
  return out;
}

function features(side = 'BUY') {
  return {
    m5: { atr14: 2 },
    h1: side === 'BUY'
      ? { close: 120, ema20: 116, ema50: 110, rsi14: 60, atr14: 8 }
      : { close: 90, ema20: 94, ema50: 100, rsi14: 40, atr14: 8 },
    recentM5: bars(side)
  };
}

test('fresh M5 bullish EMA20/50 cross aligned with H1 uptrend emits BUY', () => {
  const setup = buildGoldM5EmaCrossTrendV1Setup(features('BUY'));
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'H1_TREND_M5_EMA20_50_FRESH_CROSS');
  assert.equal(setup.reason, 'aligned_fresh_ema_cross');
  assert.ok(setup.stop_loss < setup.entry_reference);
  assert.ok(setup.take_profit > setup.entry_reference);
  assert.equal(setup.risk_reward, 1.5);
});

test('fresh M5 bearish EMA20/50 cross aligned with H1 downtrend emits SELL', () => {
  const setup = buildGoldM5EmaCrossTrendV1Setup(features('SELL'));
  assert.equal(setup.candidate, 'SELL');
  assert.equal(setup.reason, 'aligned_fresh_ema_cross');
  assert.ok(setup.stop_loss > setup.entry_reference);
  assert.ok(setup.take_profit < setup.entry_reference);
});

test('persistent EMA alignment without a new cross is not an entry', () => {
  const sample = features('BUY');
  sample.recentM5.at(-2).ema20 = 100.5;
  const setup = buildGoldM5EmaCrossTrendV1Setup(sample);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'no_aligned_fresh_ema_cross');
});

test('flat H1 EMA separation rejects the regime before looking for entries', () => {
  const sample = features('BUY');
  sample.h1.ema20 = 110.8;
  sample.h1.ema50 = 110;
  const setup = buildGoldM5EmaCrossTrendV1Setup(sample);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'h1_trend_separation_filter');
});

test('a data gap in the stop-lookback window blocks an EMA-cross signal', () => {
  const sample = features('BUY');
  sample.recentM5.at(-2).time += 60;
  const setup = buildGoldM5EmaCrossTrendV1Setup(sample);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.reason, 'm5_data_gap');
});

test('backtest selector accepts only the named independent variant', () => {
  assert.equal(normalizeBacktestStrategyVariant('EMA_CROSS_V1'), 'ema_cross_v1');
  assert.throws(() => normalizeBacktestStrategyVariant('ema-cross'), /Invalid GOLD_BACKTEST_STRATEGY_VARIANT/);
});
