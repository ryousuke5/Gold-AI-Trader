import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEurUsdFeatures,
  validateEurUsdFeatures,
  buildEurUsdSetup,
  buildEurUsdSetupWithPullback
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
    { time: 1727003600, open: 1.10018, high: 1.10035, low: 1.10005, close: 1.10010, volume: 140 },
    { time: 1727004500, open: 1.10010, high: 1.10028, low: 1.10005, close: 1.10008, volume: 150 },
    { time: 1727005400, open: 1.10008, high: 1.10020, low: 1.10000, close: 1.10000, volume: 160 },
    { time: 1727006300, open: 1.10025, high: 1.10070, low: 1.10020, close: 1.10055, volume: 220 }
  ];
}

function setupBarsSell() {
  return [
    { time: 1727000000, open: 1.10200, high: 1.10220, low: 1.10175, close: 1.10190, volume: 100 },
    { time: 1727000900, open: 1.10190, high: 1.10155, low: 1.10145, close: 1.10150, volume: 110 },
    { time: 1727001800, open: 1.10150, high: 1.10155, low: 1.10130, close: 1.10140, volume: 120 },
    { time: 1727002700, open: 1.10140, high: 1.10150, low: 1.10125, close: 1.10135, volume: 130 },
    { time: 1727003600, open: 1.10135, high: 1.10160, low: 1.10115, close: 1.10125, volume: 140 },
    { time: 1727004500, open: 1.10125, high: 1.10145, low: 1.10105, close: 1.10115, volume: 150 },
    { time: 1727005400, open: 1.10115, high: 1.10135, low: 1.10095, close: 1.10105, volume: 160 },
    { time: 1727006300, open: 1.10112, high: 1.10118, low: 1.10070, close: 1.10075, volume: 220 }
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

function trendPullbackBarsBuy() {
  const bars = [];
  for (let i = 0; i < 25; i++) {
    const close = 1.10000 + i * 0.00008;
    bars.push({
      time: 1727000000 + i * 900,
      open: close - 0.00002,
      high: close + 0.00005,
      low: close - 0.00003,
      close,
      volume: 100 + i
    });
  }
  bars.push(
    { time: 1727000000 + 25 * 900, open: 1.10192, high: 1.10200, low: 1.10155, close: 1.10165, volume: 140 },
    { time: 1727000000 + 26 * 900, open: 1.10165, high: 1.10185, low: 1.10150, close: 1.10170, volume: 150 },
    { time: 1727000000 + 27 * 900, open: 1.10170, high: 1.10180, low: 1.10155, close: 1.10162, volume: 155 },
    { time: 1727000000 + 28 * 900, open: 1.10162, high: 1.10175, low: 1.10148, close: 1.10165, volume: 165 },
    { time: 1727000000 + 29 * 900, open: 1.10165, high: 1.10215, low: 1.10160, close: 1.10210, volume: 240 }
  );
  return bars;
}

test('EURUSD trend-pullback detects EMA20 touch followed by re-acceleration', () => {
  const bars = trendPullbackBarsBuy();
  const f = baseFeatures({
    bid: 1.10202,
    ask: 1.10210,
    bar_time: bars[bars.length - 1].time,
    m15: { ema20: 1.10190, ema50: 1.10155, rsi14: 60, atr14: 0.00080 },
    recent_m15: bars
  });
  const setup = buildEurUsdSetupWithPullback(f, {
    pullbackEnabled: true,
    rangeLookback: 10,
    minRangeAtr: 5,
    maxRangeAtr: 6,
    pullbackMaxAgeBars: 5,
    pullbackEmaToleranceAtr: 0.20,
    pullbackMinBodyAtr: 0.15,
    pullbackMinCloseLocation: 0.60,
    pullbackMinImpulseBreakAtr: 0.04,
    pullbackBuyRsiMin: 48,
    pullbackBuyRsiMax: 66,
    pullbackStopBufferAtr: 0.15,
    pullbackTakeProfitR: 2
  });
  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup, null, 2));
  assert.equal(setup.setup_type, 'TREND_PULLBACK');
  assert.ok(setup.pullback_bars >= 1 && setup.pullback_bars <= 5);
  assert.ok(setup.stop_atr >= 0.50 && setup.stop_atr <= 1.50);
  assert.equal(setup.risk_reward, 2);
});

test('EURUSD trend-pullback can be disabled without changing primary breakout behavior', () => {
  const bars = trendPullbackBarsBuy();
  const f = baseFeatures({ recent_m15: bars });
  const setup = buildEurUsdSetupWithPullback(f, {
    pullbackEnabled: false,
    rangeLookback: 10,
    minRangeAtr: 5,
    maxRangeAtr: 6
  });
  assert.equal(setup.candidate, 'WAIT');
  assert.notEqual(setup.setup_type, 'TREND_PULLBACK');
});

test('EURUSD high-quality M15 range breakout aligns with H1 uptrend', () => {
  const f = baseFeatures();
  assert.deepEqual(validateEurUsdFeatures(f), []);

  const setup = buildEurUsdSetup(f, {
    maxSpreadPips: 1.0,
    maxSpreadToTpPct: 20
  });

  assert.equal(setup.trend, 'UP');
  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup, null, 2));
  assert.equal(setup.setup_type, 'BREAKOUT');
  assert.ok(setup.quality_score >= 95);
  assert.ok(setup.range_width_atr >= 0.75 && setup.range_width_atr <= 2);
  assert.ok(setup.breakout_distance_atr >= 0.10);
  assert.ok(setup.breakout_body_atr >= 0.35);
  assert.ok(setup.breakout_close_location + 1e-9 >= 0.70);
  assert.ok(setup.volume_confirmation);
  assert.equal(setup.risk_reward, 2);
});

test('EURUSD high-quality M15 range breakout supports SELL in H1 downtrend', () => {
  const f = baseFeatures({
    bid: 1.10069,
    ask: 1.10077,
    m15: { ema20: 1.10100, ema50: 1.10130, rsi14: 42, atr14: 0.00080 },
    h1: { close: 1.10060, ema20: 1.10180, ema50: 1.10210, ema200: 1.10270, rsi14: 44, atr14: 0.00250 },
    recent_m15: setupBarsSell()
  });

  const setup = buildEurUsdSetup(f, {
    maxSpreadPips: 1.0,
    maxSpreadToTpPct: 20
  });

  assert.equal(setup.trend, 'DOWN');
  assert.equal(setup.candidate, 'SELL', JSON.stringify(setup, null, 2));
  assert.equal(setup.setup_type, 'BREAKOUT');
  assert.ok(setup.quality_score >= 95);
});

test('pullback without a range breakout is ignored', () => {
  const bars = setupBarsBuy().slice();
  bars[7] = {
    time: 1727006300,
    open: 1.10025,
    high: 1.10055,
    low: 1.10015,
    close: 1.10040,
    volume: 220
  };

  const f = baseFeatures({ recent_m15: bars });
  const setup = buildEurUsdSetup(f);

  assert.equal(setup.candidate, 'WAIT');
  assert.ok(setup.reasons.includes('breakout_penetration_too_small'));
});


test('recent M15 bars are normalized newest-last even when input arrives newest-first', () => {
  const newestFirst = [...setupBarsBuy()].reverse();
  const f = baseFeatures({ recent_m15: newestFirst });
  const setup = buildEurUsdSetup(f);
  assert.equal(f.recentM15[f.recentM15.length - 1].time, f.barTime);
  assert.equal(setup.candidate, 'BUY');
});

test('missing H1 close is rejected instead of inferring a trend', () => {
  const f = baseFeatures({ h1: { close: 0, ema20: 1.10080, ema50: 1.10040, ema200: 1.09980, rsi14: 56, atr14: 0.00250 } });
  assert.ok(validateEurUsdFeatures(f).includes('invalid_h1.close'));
  assert.equal(buildEurUsdSetup(f).candidate, 'WAIT');
});

test('non-contiguous latest M15 setup bars are rejected', () => {
  const bars = setupBarsBuy();
  bars[6] = { ...bars[6], time: bars[6].time - 1800 };
  const f = baseFeatures({ recent_m15: bars });
  const setup = buildEurUsdSetup(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.ok(setup.reasons.includes('recent_m15_setup_bars_not_contiguous'));
});

test('missing breakout volume does not invalidate a technically complete breakout', () => {
  const bars = setupBarsBuy().map((bar) => ({ ...bar, volume: 0 }));
  const f = baseFeatures({ recent_m15: bars });
  const setup = buildEurUsdSetup(f);
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.volume_data_available, false);
  assert.equal(setup.volume_confirmation, false);
  assert.equal(setup.volume_gate_passed, true);
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
  assert.equal(checked.independent_source_host_count, 2);
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
  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup, null, 2));

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


test('risk engine rejects technical prices changed after AI confirmation', () => {
  const f = baseFeatures();
  const setup = buildEurUsdSetup(f);
  const decision = {
    decision: 'BUY',
    candidate: 'BUY',
    confidence: 1,
    risk_reward: setup.risk_reward,
    entry: setup.entry + 0.00010,
    stop_loss: setup.stop_loss,
    take_profit: setup.take_profit,
    ai_environment: { status: 'FAVORABLE', confidence: 0.80 }
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
      lot_step: 0.01,
      point: 0.00001,
      stop_level_points: 0,
      freeze_level_points: 0
    },
    signalCreatedAt: Date.now(),
    now: Date.now(),
    fundamentalAssessment: favorableAiAssessment()
  });
  assert.equal(risk.approved, false);
  assert.ok(risk.reasons.includes('technical_entry_mismatch'));
});

test('risk engine rejects broker stop-level violations', () => {
  const f = baseFeatures();
  const setup = buildEurUsdSetup(f);
  const decision = {
    decision: 'BUY',
    candidate: 'BUY',
    confidence: 1,
    risk_reward: setup.risk_reward,
    entry: setup.entry,
    stop_loss: setup.stop_loss,
    take_profit: setup.take_profit,
    ai_environment: { status: 'FAVORABLE', confidence: 0.80 }
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
      lot_step: 0.01,
      point: 0.00001,
      stop_level_points: 100000,
      freeze_level_points: 0
    },
    signalCreatedAt: Date.now(),
    now: Date.now(),
    fundamentalAssessment: favorableAiAssessment()
  });
  assert.equal(risk.approved, false);
  assert.ok(risk.reasons.includes('broker_stop_level_violation'));
});

test('balanced-weekly mode uses the frequency-tuned technical parameters', () => {
  const f = baseFeatures();
  const setup = buildEurUsdSetup(f, {
    frequencyMode: 'balanced-weekly',
    targetTradesPerWeek: 1,
    rangeLookback: 5,
    minRangeAtr: 0.50,
    maxRangeAtr: 2.50,
    breakoutAtr: 0.05,
    minBodyAtr: 0.25,
    minCloseLocation: 0.60,
    buyRsiMin: 48,
    buyRsiMax: 70,
    sellRsiMin: 30,
    sellRsiMax: 52
  });
  assert.equal(setup.frequency_mode, 'balanced-weekly');
  assert.equal(setup.target_trades_per_week, 1);
  assert.equal(setup.candidate, 'BUY');
  assert.equal(setup.setup_type, 'BREAKOUT');
});
