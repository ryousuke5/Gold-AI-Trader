import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEurUsdFeatures, validateEurUsdFeatures, buildEurUsdSetup } from '../src/eurusd_features.js';
import { buildEurUsdFundamentalDecision, validateEurUsdFundamentalAssessment } from '../src/eurusd_ai.js';

function bars({direction='up', count=8, base=1.1000, step=0.00015, atr=0.0008}={}) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const close = direction === 'up' ? base + i * step : base - i * step;
    const open = close - (direction === 'up' ? 0.00010 : -0.00010);
    out.push({
      time: 1727000000 + i * 900,
      open,
      high: Math.max(open, close) + atr * 0.08,
      low: Math.min(open, close) - atr * 0.08,
      close,
      volume: 100 + i
    });
  }
  return out;
}

function setupBarsBuy() {
  return [
    { time: 1727000000, open: 1.09960, high: 1.09995, low: 1.09950, close: 1.09985, volume: 100 },
    { time: 1727000900, open: 1.09985, high: 1.10015, low: 1.09975, close: 1.10005, volume: 110 },
    { time: 1727001800, open: 1.10005, high: 1.10030, low: 1.09990, close: 1.10020, volume: 120 },
    { time: 1727002700, open: 1.10020, high: 1.10038, low: 1.10000, close: 1.10018, volume: 130 },
    { time: 1727003600, open: 1.10018, high: 1.10035, low: 1.09998, close: 1.10010, volume: 140 },
    { time: 1727004500, open: 1.10010, high: 1.10028, low: 1.09995, close: 1.10008, volume: 150 },
    { time: 1727005400, open: 1.10008, high: 1.10020, low: 1.09990, close: 1.10000, volume: 160 },
    { time: 1727006300, open: 1.10072, high: 1.10120, low: 1.10065, close: 1.10105, volume: 220 }
  ];
}

function baseFeatures(overrides = {}) {
  return normalizeEurUsdFeatures({
    bid: 1.10100,
    ask: 1.10108,
    point: 0.00001,
    bar_time: 1727006300,
    m15: { ema20: 1.10060, ema50: 1.10030, rsi14: 55, atr14: 0.00080 },
    h1: { close: 1.10100, ema20: 1.10080, ema50: 1.10040, ema200: 1.09980, rsi14: 56, atr14: 0.00250 },
    recent_m15: bars({direction:'up', base:1.09970, step:0.00018, atr:0.00080}),
    ...overrides
  });
}

test('EURUSD M15 breakout candidate aligns with H1 trend', () => {
  const f = baseFeatures({ recent_m15: setupBarsBuy() });
  const errors = validateEurUsdFeatures(f);
  assert.deepEqual(errors, []);
  const setup = buildEurUsdSetup(f, { maxSpreadPips: 1.0, maxSpreadToTpPct: 20 });
  assert.equal(setup.trend, 'UP');
  assert.equal(setup.candidate, 'BUY');
  assert.ok(['PULLBACK_RECLAIM', 'BREAKOUT'].includes(setup.setup_type));
  assert.ok(setup.risk_reward >= 1.9);
  assert.ok(setup.spread_pips < 1);
});

test('wide spread blocks entry even when technical direction is correct', () => {
  const f = baseFeatures({ bid: 1.10100, ask: 1.10125, spread: 0.00025 });
  const setup = buildEurUsdSetup(f, { maxSpreadPips: 1.0 });
  assert.equal(setup.candidate, 'WAIT');
  assert.ok(setup.reasons.includes('spread_filter_failed'));
});

test('range H1 blocks the M15 setup', () => {
  const f = baseFeatures({
    h1: { close: 1.1006, ema20: 1.1004, ema50: 1.1005, ema200: 1.0998, rsi14: 52, atr14: 0.0025 }
  });
  const setup = buildEurUsdSetup(f);
  assert.equal(setup.trend, 'RANGE');
  assert.equal(setup.candidate, 'WAIT');
});

test('fundamental assessment requires current evidence and multiple sources', () => {
  const assessment = {
    fundamental: {
      bias: 'BULLISH_EURUSD',
      confidence: 0.78,
      freshness: 'CURRENT',
      summary: 'Current macro evidence supports EURUSD higher.',
      drivers: ['ECB expectations', 'relative rate outlook'],
      risks: [],
      source_urls: ['https://www.ecb.europa.eu/x', 'https://www.reuters.com/x']
    },
    event_risk_next_24h: 'LOW',
    event_summary: '',
    sources: [
      { title: 'ECB', url: 'https://www.ecb.europa.eu/x' },
      { title: 'Reuters', url: 'https://www.reuters.com/x' }
    ]
  };
  const checked = validateEurUsdFundamentalAssessment(assessment, new Date('2026-10-02T00:00:00Z'));
  assert.equal(checked.ok, true);
});

test('fundamental conflict forces WAIT', () => {
  const confirmation = buildEurUsdFundamentalDecision({
    candidate: 'BUY',
    assessment: {
      fundamental: {
        bias: 'BEARISH_EURUSD',
        confidence: 0.80,
        freshness: 'CURRENT',
        summary: 'conflict',
        drivers: [],
        risks: [],
        source_urls: []
      },
      event_risk_next_24h: 'LOW',
      event_summary: '',
      sources: [
        { title: 'ECB', url: 'https://www.ecb.europa.eu/x' },
        { title: 'Reuters', url: 'https://www.reuters.com/x' }
      ]
    }
  });
  assert.equal(confirmation.decision, 'WAIT');
  assert.ok(confirmation.invalid_reasons.includes('fundamental_conflict'));
});
