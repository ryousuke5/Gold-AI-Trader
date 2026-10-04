import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLondonAsiaRangeMap,
  buildEurUsdAsiaRangeBreakoutSetup
} from '../src/eurusd_asia_range_breakout.js';

function bar(time, open, high, low, close, extra = {}) {
  return {
    time, open, high, low, close,
    ema20: 1.1005,
    ema50: 1.1000,
    rsi14: 60,
    atr14: 0.001,
    ...extra
  };
}

test('Asia range map uses London-local 00:00-06:00 session', () => {
  const base = Date.parse('2022-03-07T00:15:00Z') / 1000;
  const bars = [
    bar(base, 1.1000, 1.1010, 1.0990, 1.1005),
    bar(base + 5 * 3600, 1.1005, 1.1020, 1.0995, 1.1010),
    bar(base + 6 * 3600, 1.1010, 1.1030, 1.1000, 1.1020)
  ];
  const map = buildLondonAsiaRangeMap(bars);
  const row = map.get('2022-03-07');
  assert.equal(row.bars, 2);
  assert.equal(row.high, 1.102);
  assert.equal(row.low, 1.099);
});

test('BUY requires H1 trend, London window and clean Asia high break', () => {
  const t = Date.parse('2022-03-07T08:15:00Z') / 1000;
  const setup = buildEurUsdAsiaRangeBreakoutSetup({
    signalBar: bar(t, 1.1012, 1.1022, 1.1010, 1.1020, { rsi14: 60 }),
    previousBar: bar(t - 900, 1.1005, 1.1012, 1.1003, 1.1010),
    h1Bar: { trend: 'UP' },
    asiaRange: { date: '2022-03-07', high: 1.1015, low: 1.0995, bars: 24 },
    config: { spreadPips: 0.8 }
  });
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'ASIA_RANGE_LONDON_BREAKOUT');
  assert.equal(setup.risk_reward, 2);
});

test('SELL mirrors BUY logic', () => {
  const t = Date.parse('2022-03-07T08:15:00Z') / 1000;
  const setup = buildEurUsdAsiaRangeBreakoutSetup({
    signalBar: bar(t, 1.1000, 1.1002, 1.0988, 1.0990, { ema20: 1.1000, ema50: 1.1005, rsi14: 40 }),
    previousBar: bar(t - 900, 1.1007, 1.1010, 1.0999, 1.1002, { ema20: 1.1000, ema50: 1.1005 }),
    h1Bar: { trend: 'DOWN' },
    asiaRange: { date: '2022-03-07', high: 1.1020, low: 1.0995, bars: 24 },
    config: { spreadPips: 0.8 }
  });
  assert.equal(setup.candidate, 'SELL');
});

test('outside London breakout window is rejected', () => {
  const t = Date.parse('2022-03-07T06:15:00Z') / 1000;
  const setup = buildEurUsdAsiaRangeBreakoutSetup({
    signalBar: bar(t, 1.1000, 1.1010, 1.0990, 1.1008),
    previousBar: bar(t - 900, 1.1000, 1.1005, 1.0995, 1.1002),
    h1Bar: { trend: 'UP' },
    asiaRange: { date: '2022-03-07', high: 1.1005, low: 1.0995, bars: 24 }
  });
  assert.deepEqual(setup.reasons, ['outside_london_breakout_window']);
});
