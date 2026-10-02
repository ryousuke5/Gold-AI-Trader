import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEurUsdFeatures,
  validateEurUsdFeatures,
  buildEurUsdSetup
} from '../src/eurusd_features.js';
import {
  buildEurUsdFundamentalDecision,
  validateEurUsdFundamentalAssessment
} from '../src/eurusd_ai.js';
import { evaluateEurUsdRisk } from '../src/eurusd_risk.js';

function setupBarsBuy() {
  return [
    { time: 1727000000, open: 1.09990, high: 1.10005, low: 1.09980, close: 1.09995, volume: 100 },
    { time: 1727000900, open: 1.09995, high: 1.10015, low: 1.09975, close: 1.10005, volume: 110 },
    { time: 1727001800, open: 1.10005, high: 1.10030, low: 1.09990, close: 1.10020, volume: 120 },
    { time: 1727002700, open: 1.10020, high: 1.10038, low: 1.10012, close: 1.10018, volume: 130 },
    { time: 1727003600, open: 1.10018, high: 1.10035, low: 1.10015, close: 1.10010, volume: 140 },
    { time: 1727004500, open: 1.10010, high: 1.10028, low: 1.10005, close: 1.10008, volume: 150 },
    { time: 1727005400, open: 1.10008, high: 1.10020, low: 1.10000, close: 1.10000, volume: 160 },
    { time: 1727006300, open: 1.10025, high: 1.10070, low: 1.10020, close: 1.10055, volume: 220 }
  ];
}

function setupBarsSell() {
  return [
    { time: 1727000000, open: 1.10200, high: 1.10220, low: 1.10175, close: 1.10190, volume: 100 },
    { time: 1727000900, open: 1.10190, high: 1.10200, low: 1.10160, close: 1.10175, volume: 110 },
    { time: 1727001800, open: 1.10175, high: 1.10185, low: 1.10140, close: 1.10155, volume: 120 },
    { time: 1727002700, open: 1.10155, high: 1.10170, low: 1.10135, close: 1.10142, volume: 130 },
    { time: 1727003600, open: 1.10142, high: 1.10160, low: 1.10125, close: 1.10130, volume: 140 },
    { time: 1727004500, open: 1.10130, high: 1.10150, low: 1.10110, close: 1.10118, volume: 150 },
    { time: 1727005400, open: 1.10118, high: 1.10140, low: 1.10095, close: 1.10105, volume: 160 },
    { time: 1727006300, open: 1.10055, high: 1.10070, low: 1.10010, close: 1.10020, volume: 220 }
  ];
}

function baseFeatures(overrides = {}) {
  return normalizeEurUsdFeatures({
    bid: 1.10050,
    ask: 1.10058,
    point: 0.00001,
    bar_time: 1727006300,
    m15: { ema20: 1.10040, ema50: 1.10020, rsi14: 58, atr14: 0.00080 },
    h1: { close: 1.10100, ema20: 1.10080, ema50: 1.10040, ema200: 1.09980, rsi14: 56, atr14: 0.00250 },
    recent_m15: setupBarsBuy(),
    ...overrides
  });
}

function favorableAiAssessment(overrides = {}) {
  return {
    environment: 'FAVORABLE',
    confidence: 0.80,
    freshness: 'CURRENT',
    fundamental: {
      bias: 'BEARISH_EURUSD',
      summary: 'Macro bias is mixed-to-bearish, but no near-term event risk is identified.',
      drivers: ['relative rate expectations'],
      risks: ['policy uncertainty'],
      source_urls: ['https://www.ecb.europa.eu/', 'https://www.reuters.com/']
    },
    event_risk_next_24h: 'LOW',
    event_summary: '',
    sources: [
      { title: 'ECB', url: 'https://www.ecb.europa.eu/' },
      { title: 'Reuters', url: 'https://www.reuters.com/' }
    ],
    ...overrides
  };
}

test('EURUSD high-quality M15 range breakout aligns with H1 uptrend', () => {
  const f = baseFeatures();
  assert.deepEqual(validateEurUsdFeatures(f), []);

  const setup = buildEurUsdSetup(f, {
    maxSpreadPips: 1.0,
    maxSpreadToTpPct: 20
  });

  assert.equal(setup.trend, 'UP');
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'BREAKOUT');
  assert.ok(setup.quality_score >= 95);
  assert.ok(setup.range_width_atr >= 0.75 && setup.range_width_atr <= 2);
  assert.ok(setup.breakout_distance_atr >= 0.10);
  assert.ok(setup.breakout_body_atr >= 0.35);
  assert.ok(setup.breakout_close_location >= 0.70);
  assert.ok(setup.volume_confirmation);
  assert.equal(setup.risk_reward, 2);
});

test('EURUSD high-quality M15 range breakout supports SELL in H1 downtrend', () => {
  const f = baseFeatures({
    bid: 1.10012,
    ask: 1.10020,
    m15: { ema20: 1.10100, ema50: 1.10130, rsi14: 42, atr14: 0.00080 },
    h1: { close: 1.10060, ema20: 1.10180, ema50: 1.10210, ema200: 1.10270, rsi14: 44, atr14: 0.00250 },
    recent_m15: setupBarsSell()
  });

  const setup = buildEurUsdSetup(f, {
    maxSpreadPips: 1.0,
    maxSpreadToTpPct: 20
  });

  assert.equal(setup.trend, 'DOWN');
  assert.equal(setup.candidate, 'SELL');
  assert.equal(setup.setup_type, 'BREAKOUT');
  assert.ok(setup.quality_score >= 95);
});

test('pullback without a range breakout is ignored', () => {
  const bars = setupBarsBuy().slice();
  bars[7] = {
    time: 1727006300,
    open: 1.10030,
    high: 1.10060,
    low: 1.10020,
    close: 1.10050,
    volume: 220
  };

  const f = baseFeatures({ recent_m15: bars });
  const setup = buildEurUsdSetup(f);

  assert.equal(setup.candidate, 'WAIT');
  assert.ok(setup.reasons.includes('breakout_penetration_too_small'));
});

test('wide spread blocks an otherwise valid breakout', () => {
  const f = baseFeatures({
    spread: 0.00015,
    ask: 1.10065
  });
  const setup = buildEurUsdSetup(f, { maxSpreadPips: 1.0 });

  assert.equal(setup.candidate, 'WAIT');
  assert.ok(setup.reasons.includes('spread_filter_failed'));
});

test('H1 range blocks the M15 breakout', () => {
  const f = baseFeatures({
    h1: { close: 1.10060, ema20: 1.10040, ema50: 1.10050, ema200: 1.09980, rsi14: 52, atr14: 0.00250 }
  });

  const setup = buildEurUsdSetup(f);

  assert.equal(setup.trend, 'RANGE');
  assert.equal(setup.candidate, 'WAIT');
  assert.ok(setup.reasons.includes('h1_trend_not_clear'));
});

test('AI environment validation requires fresh evidence and multiple sources', () => {
  const checked = validateEurUsdFundamentalAssessment(favorableAiAssessment());
  assert.equal(checked.ok, true);
  assert.equal(checked.environment, 'FAVORABLE');
  assert.equal(checked.primary_or_reuters_source_count, 2);
});

test('AI environment is the gate, not the technical direction', () => {
  const confirmation = buildEurUsdFundamentalDecision({
    candidate: 'BUY',
    assessment: favorableAiAssessment({
      fundamental: {
        bias: 'BEARISH_EURUSD',
        summary: 'Opposite macro bias is retained as context.',
        drivers: [],
        risks: [],
        source_urls: ['https://www.ecb.europa.eu/', 'https://www.reuters.com/']
      }
    })
  });

  assert.equal(confirmation.decision, 'BUY');
  assert.equal(confirmation.environment, 'FAVORABLE');
});

test('AI caution blocks entry', () => {
  const confirmation = buildEurUsdFundamentalDecision({
    candidate: 'BUY',
    assessment: favorableAiAssessment({ environment: 'CAUTION' })
  });

  assert.equal(confirmation.decision, 'WAIT');
  assert.ok(confirmation.invalid_reasons.includes('ai_environment_not_favorable'));
});

test('high-impact event blocks entry even with favorable AI label', () => {
  const assessment = favorableAiAssessment({ event_risk_next_24h: 'HIGH' });
  const checked = validateEurUsdFundamentalAssessment(assessment);

  assert.equal(checked.ok, false);
  assert.ok(checked.reasons.includes('high_impact_event_next_24h'));

  const confirmation = buildEurUsdFundamentalDecision({ candidate: 'BUY', assessment });
  assert.equal(confirmation.decision, 'WAIT');
});

test('risk engine approves only when breakout, risk and AI environment align', () => {
  const f = baseFeatures();
  const setup = buildEurUsdSetup(f);
  assert.equal(setup.candidate, 'BUY');

  const decision = {
    decision: 'BUY',
    candidate: 'BUY',
    confidence: setup.quality_score / 100,
    risk_reward: setup.risk_reward,
    entry: setup.entry,
    stop_loss: setup.stop_loss,
    take_profit: setup.take_profit,
    ai_environment: {
      status: 'FAVORABLE',
      confidence: 0.80
    }
  };

  const risk = evaluateEurUsdRisk({
    decision,
    setup,
    features: f,
    account: {
      equity: 100000,
      open_positions: 0,
      daily_pnl_pct: 0,
      drawdown_pct: 0,
      risk_data_ready: true,
      trade_allowed: 1,
      tick_size: 0.00001,
      tick_value: 1,
      min_lot: 0.01,
      max_lot: 100,
      lot_step: 0.01
    },
    signalCreatedAt: 1727006300000,
    now: 1727006300000,
    fundamentalAssessment: favorableAiAssessment()
  });

  assert.equal(risk.approved, true);
  assert.ok(risk.lots > 0);
});
