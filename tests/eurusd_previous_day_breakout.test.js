import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEurUsdPreviousDayBreakoutSetup,
  buildPreviousTradingDayMap,
  latestPreviousTradingDay,
  londonDayKey
} from '../src/eurusd_previous_day_breakout.js';

function bar(time, open, high, low, close, extra = {}) {
  return { time, open, high, low, close, ema20: 1.1005, ema50: 1.1000, rsi14: 60, atr14: 0.001, ...extra };
}

test('London day keys are DST-aware and previous trading day skips weekends', () => {
  const friday = Date.parse('2022-03-04T12:00:00Z') / 1000;
  const monday = Date.parse('2022-03-07T08:00:00Z') / 1000;
  assert.equal(londonDayKey(friday), '2022-03-04');
  assert.equal(londonDayKey(monday), '2022-03-07');
  const map = buildPreviousTradingDayMap([
    bar(friday, 1.10, 1.105, 1.095, 1.102),
    bar(friday + 900, 1.102, 1.104, 1.098, 1.101),
    bar(monday, 1.101, 1.103, 1.099, 1.102)
  ]);
  const prior = latestPreviousTradingDay(map, monday);
  assert.equal(prior.date, '2022-03-04');
  assert.equal(prior.high, 1.105);
  assert.equal(prior.low, 1.095);
});

test('BUY setup requires trend, London session, prior-day break and continuation confirmation', () => {
  const t = Date.parse('2022-03-07T09:15:00Z') / 1000;
  const previousDay = { date: '2022-03-04', high: 1.1000, low: 1.0950, bars: 96 };
  const setup = buildEurUsdPreviousDayBreakoutSetup({
    signalBar: bar(t, 1.0997, 1.1010, 1.0995, 1.1005, { rsi14: 60 }),
    previousBar: bar(t - 900, 1.0990, 1.1000, 1.0988, 1.0998),
    h1Bar: { trend: 'UP' },
    previousDay,
    config: { spreadPips: 0.8, minBodyAtr: 0.25, minCloseLocation: 0.60, breakoutMinAtr: 0.05 }
  });
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'PREVIOUS_DAY_BREAKOUT');
  assert.equal(setup.risk_reward, 2);
  assert.ok(setup.stop_atr >= 0.5 && setup.stop_atr <= 1.5);
});

test('SELL setup mirrors the BUY logic', () => {
  const t = Date.parse('2022-03-07T09:15:00Z') / 1000;
  const previousDay = { date: '2022-03-04', high: 1.1050, low: 1.1000, bars: 96 };
  const setup = buildEurUsdPreviousDayBreakoutSetup({
    signalBar: bar(t, 1.1003, 1.1005, 1.0990, 1.0995, { ema20: 1.1000, ema50: 1.1005, rsi14: 40 }),
    previousBar: bar(t - 900, 1.1007, 1.1010, 1.0999, 1.1002, { ema20: 1.1000, ema50: 1.1005 }),
    h1Bar: { trend: 'DOWN' },
    previousDay,
    config: { spreadPips: 0.8, minBodyAtr: 0.25, minCloseLocation: 0.60, breakoutMinAtr: 0.05 }
  });
  assert.equal(setup.candidate, 'SELL');
  assert.equal(setup.setup_type, 'PREVIOUS_DAY_BREAKOUT');
  assert.equal(setup.risk_reward, 2);
});

test('signals outside London session are rejected', () => {
  const t = Date.parse('2022-03-07T06:15:00Z') / 1000;
  const setup = buildEurUsdPreviousDayBreakoutSetup({
    signalBar: bar(t, 1.0997, 1.1010, 1.0995, 1.1005),
    previousBar: bar(t - 900, 1.0990, 1.1000, 1.0988, 1.0998),
    h1Bar: { trend: 'UP' },
    previousDay: { date: '2022-03-04', high: 1.1000, low: 1.0950, bars: 96 }
  });
  assert.equal(setup.candidate, 'WAIT');
  assert.deepEqual(setup.reasons, ['outside_london_session']);
});
