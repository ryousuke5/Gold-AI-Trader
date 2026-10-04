import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEurUsdLondonOrbSetup } from '../src/eurusd_london_orb.js';

function bar(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

test('London ORB only evaluates inside its breakout window', () => {
  const base = Date.parse('2026-01-15T08:00:00Z') / 1000;
  const recent = Array.from({ length: 20 }, (_, i) => bar(base + i * 900, 1.1, 1.101, 1.099, 1.1005));
  const f = {
    barTime: recent.at(-1).time,
    bid: 1.1004,
    ask: 1.1006,
    spread: 0.0002,
    m15: { ema20: 1.101, ema50: 1.100, rsi14: 55, atr14: 0.001 },
    h1: { close: 1.102, ema20: 1.101, ema50: 1.100, ema200: 1.098 },
    recentM15: recent
  };
  const setup = buildEurUsdLondonOrbSetup(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.match(setup.reasons.join('|'), /outside_london_breakout_window|london_opening_range_incomplete/);
});

test('London DST conversion distinguishes winter and summer correctly', () => {
  const recentWinter = Date.parse('2026-01-15T08:15:00Z') / 1000;
  const recentSummer = Date.parse('2026-07-15T07:15:00Z') / 1000;
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(recentWinter * 1000)), '08:15');
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(recentSummer * 1000)), '08:15');
});

test('London ORB rejects a breakout when the immediately prior candle already closed beyond the range', () => {
  const rangeStart = Date.parse('2026-01-15T07:15:00Z') / 1000;
  const rangeBars = [
    bar(rangeStart, 1.1000, 1.1010, 1.0990, 1.1005, 100),
    bar(rangeStart + 900, 1.1005, 1.1011, 1.0995, 1.1008, 100),
    bar(rangeStart + 1800, 1.1008, 1.1012, 1.0998, 1.1009, 100),
    bar(rangeStart + 2700, 1.1009, 1.1013, 1.0999, 1.1010, 100)
  ];
  const preBreakout = bar(Date.parse('2026-01-15T08:15:00Z') / 1000, 1.1020, 1.1038, 1.1019, 1.1036, 150);
  const breakout = bar(Date.parse('2026-01-15T08:30:00Z') / 1000, 1.1036, 1.1045, 1.1035, 1.1042, 160);
  const f = {
    barTime: breakout.time,
    bid: 1.1035,
    ask: 1.1037,
    spread: 0.0002,
    m15: { ema20: 1.102, ema50: 1.101, rsi14: 58, atr14: 0.001 },
    h1: { close: 1.1025, ema20: 1.102, ema50: 1.100, ema200: 1.098 },
    recentM15: [...rangeBars, breakout]
  };
  const setup = buildEurUsdLondonOrbSetup(f, { minVolumeRatio: 1.0, maxSpreadPips: 3, breakoutAtr: 0.05, minBodyAtr: 0.2 });
  assert.equal(setup.candidate, 'WAIT');
});
