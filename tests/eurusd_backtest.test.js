import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFundamentalCsv, latestFundamentalAssessment, fundamentalGate, tradesToCsv } from '../scripts/backtest-eurusd.mjs';
import { classifyFundamentalProxy } from '../scripts/build-eurusd-fundamental-proxy.mjs';

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    prev = prev === null ? values[i] : alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function floorLot(raw, minLot = 0.01, maxLot = 100, lotStep = 0.01) {
  if (!(raw > 0)) return 0;
  const stepped = Math.floor((raw + 1e-12) / lotStep) * lotStep;
  if (stepped < minLot - 1e-12) return 0;
  return Math.min(maxLot, Number(stepped.toFixed(8)));
}

test('EMA initializes deterministically and converges', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.equal(out[0], 1);
  assert.ok(out[4] > 4);
  assert.ok(out[4] < 5);
});

test('EURUSD risk lot sizing floors to broker lot step', () => {
  const riskCash = 250;
  const stopDistance = 0.0010;
  const rawLots = riskCash / (stopDistance * 100000);
  assert.equal(floorLot(rawLots, 0.01, 100, 0.01), 2.5);
  assert.equal(floorLot(0.004, 0.01, 100, 0.01), 0);
});

test('fundamental replay selects latest non-future assessment only', () => {
  const rows = parseFundamentalCsv([
    'timestamp,bias,confidence,freshness,event_risk_next_24h',
    '2026-09-25T08:00:00Z,BULLISH_EURUSD,0.78,CURRENT,LOW',
    '2026-09-25T10:00:00Z,BEARISH_EURUSD,0.82,CURRENT,LOW'
  ].join('\n'));
  assert.equal(rows.length, 2);
  const selected = latestFundamentalAssessment(rows, Date.parse('2026-09-25T09:00:00Z') / 1000, 48);
  assert.equal(selected.bias, 'BULLISH_EURUSD');
});

test('fundamental replay blocks stale, conflicting and high-event assessments', () => {
  const setup = { candidate: 'BUY' };
  const cfg = { minFundamentalConfidence: 0.65 };
  assert.equal(fundamentalGate(setup, null, cfg).allowed, false);
  assert.equal(fundamentalGate(setup, {
    bias: 'BULLISH_EURUSD', confidence: 0.80, freshness: 'STALE', event_risk_next_24h: 'LOW'
  }, cfg).reason, 'fundamental_not_current');
  assert.equal(fundamentalGate(setup, {
    bias: 'BEARISH_EURUSD', confidence: 0.80, freshness: 'CURRENT', event_risk_next_24h: 'LOW'
  }, cfg).reason, 'fundamental_direction_mismatch');
  assert.equal(fundamentalGate(setup, {
    bias: 'BULLISH_EURUSD', confidence: 0.80, freshness: 'CURRENT', event_risk_next_24h: 'HIGH'
  }, cfg).reason, 'high_impact_event_next_24h');
});

test('trade CSV uses real line breaks', () => {
  const csv = tradesToCsv([{
    signal_time: 1,
    entry_time: 2,
    exit_time: 3,
    side: 'BUY',
    setup_type: 'BREAKOUT',
    h1_trend: 'UP',
    entry: 1.1,
    stop_loss: 1.099,
    take_profit: 1.102,
    lots: 1,
    risk_cash: 250,
    gross_pips: 10,
    net_pips: 8,
    gross_pnl: 100,
    net_pnl: 80,
    transaction_cost: 20,
    spread_cost_pips: 0.8,
    slippage_cost_pips: 0.2,
    exit_reason: 'TARGET',
    holding_minutes: 15,
    spread_caused_loss: false
  }]);
  assert.ok(csv.includes('\n'));
  assert.equal(csv.split('\n').length, 3);
});


test('fundamental proxy is causal and conservative', () => {
  assert.deepEqual(classifyFundamentalProxy({
    policy_diff_change_20d: '-0.30',
    usd_minus_eur_policy_rate: '1.00'
  }), { bias: 'BULLISH_EURUSD', confidence: 0.75 });
  assert.deepEqual(classifyFundamentalProxy({
    policy_diff_change_20d: '0.30',
    usd_minus_eur_policy_rate: '2.50'
  }), { bias: 'BEARISH_EURUSD', confidence: 0.75 });
  assert.deepEqual(classifyFundamentalProxy({
    policy_diff_change_20d: '0.04',
    usd_minus_eur_policy_rate: '1.00'
  }), { bias: 'NEUTRAL', confidence: 0.60 });
});
