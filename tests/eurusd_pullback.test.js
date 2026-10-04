import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEurUsdFeatures, validateEurUsdFeatures } from '../src/eurusd_features.js';
import { buildEurUsdTrendPullbackSetup, eurUsdH1PullbackTrend } from '../src/eurusd_pullback.js';

function barsBuy() {
  const t = 1727000000;
  return [
    { time: t, open: 1.10000, high: 1.10055, low: 1.09990, close: 1.10045, volume: 100 },
    { time: t + 900, open: 1.10045, high: 1.10090, low: 1.10030, close: 1.10080, volume: 110 },
    { time: t + 1800, open: 1.10080, high: 1.10082, low: 1.10040, close: 1.10045, volume: 120 },
    { time: t + 2700, open: 1.10045, high: 1.10060, low: 1.10020, close: 1.10030, volume: 125 },
    { time: t + 3600, open: 1.10030, high: 1.10052, low: 1.10024, close: 1.10036, volume: 130 },
    { time: t + 4500, open: 1.10036, high: 1.10058, low: 1.10026, close: 1.10050, volume: 140 },
    { time: t + 5400, open: 1.10050, high: 1.10062, low: 1.10040, close: 1.10055, volume: 145 },
    { time: t + 6300, open: 1.10055, high: 1.10145, low: 1.10050, close: 1.10130, volume: 240 }
  ];
}

function barsSell() {
  const t = 1727000000;
  return [
    { time: t, open: 1.10200, high: 1.10210, low: 1.10145, close: 1.10155, volume: 100 },
    { time: t + 900, open: 1.10155, high: 1.10160, low: 1.10105, close: 1.10115, volume: 110 },
    { time: t + 1800, open: 1.10115, high: 1.10150, low: 1.10108, close: 1.10140, volume: 120 },
    { time: t + 2700, open: 1.10140, high: 1.10150, low: 1.10118, close: 1.10125, volume: 125 },
    { time: t + 3600, open: 1.10125, high: 1.10150, low: 1.10120, close: 1.10130, volume: 130 },
    { time: t + 4500, open: 1.10130, high: 1.10148, low: 1.10122, close: 1.10125, volume: 140 },
    { time: t + 5400, open: 1.10125, high: 1.10138, low: 1.10105, close: 1.10110, volume: 145 },
    { time: t + 6300, open: 1.10110, high: 1.10115, low: 1.10025, close: 1.10035, volume: 240 }
  ];
}

function h1Bars(direction = 'UP') {
  const t = 1727000000;
  const closes = direction === 'UP'
    ? [1.09990, 1.10005, 1.10020, 1.10035, 1.10060, 1.10100]
    : [1.10320, 1.10305, 1.10290, 1.10270, 1.10250, 1.10220];
  return closes.map((close, i) => ({
    time: t + i * 3600,
    open: close - (direction === 'UP' ? 0.00003 : -0.00003),
    high: close + 0.00010,
    low: close - 0.00010,
    close,
    volume: 100 + i
  }));
}

function features(direction = 'UP') {
  const isUp = direction === 'UP';
  return normalizeEurUsdFeatures({
    bid: isUp ? 1.10122 : 1.10042,
    ask: isUp ? 1.10130 : 1.10050,
    point: 0.00001,
    spread: 0.00008,
    bar_time: 1727006300,
    m15: {
      ema20: isUp ? 1.10045 : 1.10115,
      ema50: isUp ? 1.10020 : 1.10135,
      rsi14: isUp ? 58 : 42,
      atr14: 0.00080
    },
    h1: isUp
      ? { close: 1.10100, ema20: 1.10080, ema50: 1.10040, ema200: 1.09980, rsi14: 56, atr14: 0.00250 }
      : { close: 1.10220, ema20: 1.10235, ema50: 1.10260, ema200: 1.10300, rsi14: 44, atr14: 0.00250 },
    recent_m15: isUp ? barsBuy() : barsSell(),
    recent_h1: h1Bars(direction)
  });
}

test('Strategy B recognizes an H1 uptrend pullback and produces BUY', () => {
  const f = features('UP');
  assert.deepEqual(validateEurUsdFeatures(f), []);
  assert.equal(eurUsdH1PullbackTrend(f), 'UP');

  const setup = buildEurUsdTrendPullbackSetup(f, {
    maxSpreadPips: 1.0,
    maxSpreadToTpPct: 20
  });

  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup, null, 2));
  assert.equal(setup.setup_type, 'TREND_PULLBACK');
  assert.ok(setup.quality_score >= 95);
  assert.ok(setup.risk_reward >= 1.99 && setup.risk_reward <= 2.01);
  assert.ok(setup.stop_atr >= 0.5 && setup.stop_atr <= 1.5);
});

test('Strategy B recognizes an H1 downtrend pullback and produces SELL', () => {
  const f = features('DOWN');
  assert.equal(eurUsdH1PullbackTrend(f), 'DOWN');

  const setup = buildEurUsdTrendPullbackSetup(f, {
    maxSpreadPips: 1.0,
    maxSpreadToTpPct: 20
  });

  assert.equal(setup.candidate, 'SELL', JSON.stringify(setup, null, 2));
  assert.equal(setup.setup_type, 'TREND_PULLBACK');
  assert.ok(setup.quality_score >= 95);
});

test('A weak pullback that fails EMA20 touch does not produce a signal', () => {
  const f = features('UP');
  f.recentM15[4].low = 1.10075;
  f.recentM15[5].low = 1.10078;
  f.recentM15[6].low = 1.10080;

  const setup = buildEurUsdTrendPullbackSetup(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.match(setup.reasons.join(','), /pullback_quality_failed|trigger_body_outside_atr_band|trigger_close_location_weak|quality_score_below_threshold/);
});

test('A deep structural break below EMA50 is rejected', () => {
  const f = features('UP');
  f.recentM15[4].low = 1.09950;
  f.recentM15[5].low = 1.09940;
  f.recentM15[6].low = 1.09945;

  const setup = buildEurUsdTrendPullbackSetup(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.match(setup.reasons.join(','), /pullback_quality_failed|stop_distance_outside_atr_band|quality_score_below_threshold/);
});

test('An unclear H1 trend disables Strategy B', () => {
  const f = features('UP');
  f.h1.ema20 = 1.10030;
  f.h1.ema50 = 1.10050;
  const setup = buildEurUsdTrendPullbackSetup(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.equal(setup.trend, 'RANGE');
});
