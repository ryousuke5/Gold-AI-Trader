import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldV3Setup } from '../src/gold_strategy_v3.js';

function buyFixture() {
  const t = 1_800_000_000;
  const rows = [
    [101, 103, 101, 102],
    [102, 104, 99, 103],
    [103, 105, 100, 104],
    [104, 107, 102, 106],
    [106, 110, 104, 109],
    [109, 108, 106, 107],
    [107, 107, 104.5, 105],
    [105, 108, 104.8, 107.5]
  ];
  const recentM5 = rows.map((r, i) => ({
    time: t + i * 300, open: r[0], high: r[1], low: r[2], close: r[3], volume: 0
  }));
  return {
    barTime: recentM5.at(-1).time,
    m5: { ema20: 106, atr14: 2.2, rsi14: 60 },
    h1: { close: 210, ema20: 205, ema50: 200, rsi14: 60, atr14: 5 },
    recentM5
  };
}

function sellFixture() {
  const t = 1_800_000_000;
  const rows = [
    [110, 111, 108, 109],
    [109, 112, 101, 108],
    [108, 111, 105, 107],
    [107, 109, 102, 103],
    [103, 105, 99, 100],
    [100, 104, 102, 103],
    [103, 105.5, 102, 104],
    [104, 105.2, 101, 101.8]
  ];
  const recentM5 = rows.map((r, i) => ({
    time: t + i * 300, open: r[0], high: r[1], low: r[2], close: r[3], volume: 0
  }));
  return {
    barTime: recentM5.at(-1).time,
    m5: { ema20: 104, atr14: 2.2, rsi14: 40 },
    h1: { close: 90, ema20: 95, ema50: 100, rsi14: 40, atr14: 5 },
    recentM5
  };
}

test('V3 creates a BUY after an expanded-zone pullback and bullish re-acceleration', () => {
  const setup = buildGoldV3Setup(buyFixture());
  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup));
  assert.equal(setup.strategy_version, 'gold-h1-m5-expanded-pullback-reaccel-v3');
  assert.equal(setup.risk_reward, 2);
  const risk = setup.entry_reference - setup.stop_loss;
  const reward = setup.take_profit - setup.entry_reference;
  assert.ok(Math.abs(reward / risk - 2) < 1e-9);
  assert.ok(setup.diagnostics.observed_retracement >= 0.236);
  assert.ok(setup.diagnostics.observed_retracement <= 0.618);
});

test('V3 creates a SELL with mirrored stop and target geometry', () => {
  const setup = buildGoldV3Setup(sellFixture());
  assert.equal(setup.candidate, 'SELL', JSON.stringify(setup));
  assert.equal(setup.risk_reward, 2);
  const risk = setup.stop_loss - setup.entry_reference;
  const reward = setup.entry_reference - setup.take_profit;
  assert.ok(Math.abs(reward / risk - 2) < 1e-9);
});

test('V3 rejects a trend that does not match the H1 EMA direction', () => {
  const features = buyFixture();
  features.h1.ema20 = 198;
  assert.equal(buildGoldV3Setup(features).candidate, 'WAIT');
});

test('V3 rejects a gap in the closed M5 candles', () => {
  const features = buyFixture();
  features.recentM5[5].time += 300;
  features.barTime = features.recentM5.at(-1).time;
  assert.equal(buildGoldV3Setup(features).candidate, 'WAIT');
});

test('V3 does not take a signal outside its declared UTC session', () => {
  const features = buyFixture();
  features.recentM5.at(-1).time = Date.UTC(2026, 0, 1, 2, 0, 0) / 1000;
  features.barTime = features.recentM5.at(-1).time;
  features.recentM5.at(-2).time = features.barTime - 300;
  assert.equal(buildGoldV3Setup(features).reason, 'session_filter');
});

test('V3 keeps the target at exactly 2R even if a different target is passed in config', () => {
  const features = buyFixture();
  const setup = buildGoldV3Setup(features, { takeProfitR: 1.25 });
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.risk_reward, 2);
  const risk = setup.entry_reference - setup.stop_loss;
  const reward = setup.take_profit - setup.entry_reference;
  assert.ok(Math.abs(reward / risk - 2) < 1e-9);
});
