import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEurUsdSessionRangeCore } from '../src/eurusd_session_range_core_v1.js';

function fixture() {
  const start = Date.parse('2026-01-05T00:00:00Z') / 1000;
  const bars = [];
  for (let i = 0; i < 28; i += 1) {
    const t = start + i * 900;
    bars.push({
      time: t,
      open: 1.1002,
      high: 1.1008,
      low: 1.1000,
      close: 1.1004,
      volume: 100
    });
  }
  bars[27] = { ...bars[27], close: 1.1006 };
  bars.push({
    time: start + 28 * 900,
    open: 1.1006,
    high: 1.1010,
    low: 1.1005,
    close: 1.10085,
    volume: 140
  });
  bars.push({
    time: start + 29 * 900,
    open: 1.10085,
    high: 1.10095,
    low: 1.10074,
    close: 1.10080,
    volume: 110
  });
  bars.push({
    time: start + 30 * 900,
    open: 1.10080,
    high: 1.1010,
    low: 1.10075,
    close: 1.10090,
    volume: 120
  });

  const latest = bars.at(-1);
  return {
    bid: 1.10089,
    ask: 1.10097,
    spread: 0.00008,
    barTime: latest.time,
    m15: { atr14: 0.0005 },
    h1: {
      close: 1.1014,
      ema20: 1.1010,
      ema50: 1.1007,
      ema200: 1.0998
    },
    recentM15: bars
  };
}

test('Session core finds prior breakout and confirms on current retest bar', () => {
  const f = fixture();
  const setup = buildEurUsdSessionRangeCore(f);
  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup, null, 2));
  assert.equal(setup.setup_type, 'EURUSD_UTC_SESSION_RANGE_BREAKOUT_RETEST');
  assert.equal(setup.diagnostics.breakout_time, f.recentM15.at(-3).time);
  assert.equal(setup.diagnostics.retest_count, 1);
  assert.ok(setup.stop_loss < setup.entry_reference);
  assert.ok(setup.take_profit > setup.entry_reference);
});

test('Session core rejects a confirmation without a prior retest', () => {
  const f = fixture();
  f.recentM15[f.recentM15.length - 2] = {
    ...f.recentM15[f.recentM15.length - 2],
    low: 1.1012,
    close: 1.1013
  };
  f.recentM15[f.recentM15.length - 1] = {
    ...f.recentM15[f.recentM15.length - 1],
    low: 1.10082,
    close: 1.10090
  };
  const setup = buildEurUsdSessionRangeCore(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.match(setup.reasons.join(','), /breakout_retest_confirmation_filter/);
});

test('Session core rejects an out-of-session signal', () => {
  const f = fixture();
  f.recentM15 = f.recentM15.map((b) => ({ ...b, time: b.time - 7200 }));
  f.barTime = f.recentM15.at(-1).time;
  const setup = buildEurUsdSessionRangeCore(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.match(setup.reasons.join(','), /breakout_session_filter/);
});
