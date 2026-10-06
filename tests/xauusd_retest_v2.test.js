import test from 'node:test';
import assert from 'node:assert/strict';
import { findXauRetestSetup } from '../src/xauusd_retest_v2.js';

function makeBar(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

test('XAUUSD V2 detects range -> breakout -> retest -> confirmation', () => {
  const bars = [];
  const t0 = 1_700_000_000;

  // 12-bar range: stable 98-102.
  for (let i = 0; i < 12; i += 1) {
    bars.push(makeBar(t0 + i * 300, 100, 102, 98, 100));
  }

  // Confirmed breakout.
  bars.push(makeBar(t0 + 12 * 300, 101.3, 103.4, 100.8, 103.0));

  // Retest of range high without structural invalidation.
  bars.push(makeBar(t0 + 13 * 300, 103.0, 103.2, 101.85, 102.0));

  // Confirmation above retest high.
  bars.push(makeBar(t0 + 14 * 300, 102.0, 103.5, 101.9, 103.25));

  const recentH1 = [];
  for (let i = 0; i < 5; i += 1) {
    recentH1.push(makeBar(t0 + i * 3600, 100 + i, 101 + i, 99 + i, 100 + i));
  }

  const features = {
    barTime: bars.at(-1).time,
    bid: 103.25,
    ask: 103.80,
    spread: 0.55,
    m5: {
      ema20: 102.4,
      ema50: 101.6,
      rsi14: 62,
      atr14: 1.0
    },
    h1: {
      close: 105,
      ema20: 103,
      ema50: 101,
      ema200: 99,
      rsi14: 61,
      atr14: 2.5
    },
    recentM5: bars,
    recentH1
  };

  const setup = findXauRetestSetup(features, {
    breakoutLookback: 12,
    minRangeAtr: 0.60,
    maxRangeAtr: 3.20,
    breakoutAtr: 0.08,
    breakoutBodyAtr: 0.30,
    breakoutCloseLocation: 0.60,
    maxBreakoutBodyAtr: 1.80,
    maxRetestBars: 6,
    minRetestBars: 1,
    retestToleranceAtr: 0.20,
    maxPenetrationAtr: 0.20,
    retestCloseBufferAtr: 0.05,
    confirmBufferAtr: 0.02,
    confirmBodyAtr: 0.25,
    minConfirmCloseLocation: 0.60,
    maxConfirmBodyAtr: 1.50,
    minStopAtr: 0.60,
    maxStopAtr: 2.20,
    stopBufferAtr: 0.12,
    takeProfitR: 1.80,
    maxEntryDistanceAtr: 0.25,
    maxExtensionAtr: 1.80,
    minH1Agreement: 0.60,
    maxSpreadPrice: 0.60
  });

  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'H1_TREND_RANGE_BREAK_RETEST');
  assert.equal(setup.diagnostics.breakout_time, bars[12].time);
  assert.equal(setup.diagnostics.retest_time, bars[13].time);
  assert.equal(setup.diagnostics.confirmation_time, bars[14].time);
});

test('normal spread does not by itself fail the entry drift filter', () => {
  const bars = [];
  const t0 = 1_700_100_000;
  for (let i = 0; i < 12; i += 1) bars.push(makeBar(t0 + i * 300, 100, 102, 98, 100));
  bars.push(makeBar(t0 + 12 * 300, 101.3, 103.4, 100.8, 103));
  bars.push(makeBar(t0 + 13 * 300, 103, 103.2, 101.85, 102));
  bars.push(makeBar(t0 + 14 * 300, 102, 103.5, 101.9, 103.25));

  const h1 = [];
  for (let i = 0; i < 5; i += 1) h1.push(makeBar(t0 + i * 3600, 100 + i, 101 + i, 99 + i, 100 + i));

  const f = {
    barTime: bars.at(-1).time,
    bid: 103.25,
    ask: 103.80,
    spread: 0.55,
    m5: { ema20: 102.4, ema50: 101.6, rsi14: 62, atr14: 1.0 },
    h1: { close: 105, ema20: 103, ema50: 101, ema200: 99, rsi14: 61, atr14: 2.5 },
    recentM5: bars,
    recentH1: h1
  };

  const setup = findXauRetestSetup(f);
  assert.equal(setup.candidate, 'BUY');
  assert.notEqual(setup.reasons?.[0], 'entry_drift_filter');
});
