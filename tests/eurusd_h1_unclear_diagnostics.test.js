import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEurUsdSetup } from '../src/eurusd_features.js';

function baseFeatures() {
  const barTime = Date.parse('2026-10-09T10:00:00Z') / 1000;
  const recentM15 = [];
  for (let i = 0; i < 5; i++) {
    recentM15.push({
      time: barTime - (5 - i) * 900,
      open: 1.1007,
      high: 1.1010,
      low: 1.1005,
      close: 1.1008,
      volume: 100
    });
  }
  recentM15.push({
    time: barTime,
    open: 1.1011,
    high: 1.1019,
    low: 1.1010,
    close: 1.1017,
    volume: 120
  });
  const spread = 0.00005;
  const bid = 1.1017;
  return {
    bid,
    ask: bid + spread,
    point: 0.00001,
    spread,
    spreadPoints: spread / 0.00001,
    barTime,
    m15: { ema20: 1.1015, ema50: 1.1008, rsi14: 55, atr14: 0.0010 },
    h1: { close: 1.1020, ema20: 1.1018, ema50: 1.1010, ema200: 1.0990, rsi14: 55, atr14: 0.0015 },
    recentM15,
    recentH1: [],
    safety: {}
  };
}

const config = {
  rangeLookback: 5,
  minRangeAtr: 0.4,
  maxRangeAtr: 2.5,
  breakoutAtr: 0.05,
  minBodyAtr: 0.25,
  minCloseLocation: 0.6,
  minVolumeRatio: 1.1,
  requireVolume: true,
  maxSpreadPips: 1.2,
  maxSpreadAtrPct: 15,
  minStopAtr: 0.5,
  maxStopAtr: 1.5,
  takeProfitR: 2,
  maxSpreadToTpPct: 12,
  buyRsiMin: 48,
  buyRsiMax: 70,
  sellRsiMin: 30,
  sellRsiMax: 52
};

test('EURUSD diagnostics mark directional gates not evaluated when H1 trend is RANGE', () => {
  const features = baseFeatures();
  features.h1.close = 1.1016; // aligned EMA stack, but H1 close is below EMA20 => RANGE
  features.spread = 0.00019; // 1.9 pips, matching the observed forward spread
  features.ask = features.bid + features.spread;
  features.spreadPoints = features.spread / features.point;

  const result = buildEurUsdSetup(features, config);
  assert.equal(result.trend, 'RANGE');
  assert.equal(result.candidate, 'WAIT');

  for (const reason of [
    'h1_trend_not_clear',
    'm15_ema_not_evaluated_h1_unclear',
    'm15_rsi_not_evaluated_h1_unclear',
    'breakout_penetration_not_evaluated_h1_unclear',
    'breakout_close_location_not_evaluated_h1_unclear',
    'spread_filter_failed'
  ]) {
    assert.ok(result.reasons.includes(reason), `expected reason: ${reason}`);
  }
  for (const misleading of [
    'm15_ema_not_aligned',
    'm15_rsi_out_of_breakout_zone',
    'breakout_penetration_too_small',
    'breakout_close_location_weak'
  ]) {
    assert.ok(!result.reasons.includes(misleading), `unexpected directional failure when H1 is unclear: ${misleading}`);
  }
});

test('EURUSD directional setup behavior remains unchanged when H1 trend is UP', () => {
  const result = buildEurUsdSetup(baseFeatures(), config);
  assert.equal(result.trend, 'UP');
  assert.equal(result.candidate, 'BUY');
  assert.equal(result.setup_type, 'BREAKOUT');
  assert.equal(result.reasons.length, 0);
});

test('EURUSD actual directional EMA and RSI failures remain failures when H1 trend is clear', () => {
  const features = baseFeatures();
  features.m15.ema20 = 1.1005; // below EMA50 despite clear H1 UP trend
  features.m15.rsi14 = 75; // outside the configured BUY continuation zone

  const result = buildEurUsdSetup(features, config);
  assert.equal(result.trend, 'UP');
  assert.equal(result.candidate, 'WAIT');
  assert.ok(result.reasons.includes('m15_ema_not_aligned'));
  assert.ok(result.reasons.includes('m15_rsi_out_of_breakout_zone'));
  assert.ok(!result.reasons.includes('m15_ema_not_evaluated_h1_unclear'));
  assert.ok(!result.reasons.includes('m15_rsi_not_evaluated_h1_unclear'));
});
