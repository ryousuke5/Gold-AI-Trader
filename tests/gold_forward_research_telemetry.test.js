import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceGoldForwardResearchObservation,
  buildGoldForwardResearchObservation
} from '../src/gold_forward_research_telemetry.js';

function baseFeatures() {
  const recentM5 = Array.from({ length: 24 }, (_, index) => {
    const time = 1_800_000_000 + index * 300;
    return { time, open: 2350 + index, high: 2352 + index, low: 2349 + index, close: 2351 + index, volume: 100 + index };
  });
  const recentH1 = Array.from({ length: 24 }, (_, index) => {
    const time = 1_799_913_600 + index * 3600;
    return { time, open: 2300 + index, high: 2303 + index, low: 2299 + index, close: 2302 + index, volume: 500 + index };
  });
  return {
    barTime: recentM5.at(-1).time,
    bid: 2373.0, ask: 2373.3, spread: 0.3,
    m5: { ema20: 2370, ema50: 2365, rsi14: 60, atr14: 2.0 },
    h1: { close: 2350, ema20: 2348, ema50: 2340, ema200: 2320, rsi14: 60, atr14: 10 },
    recentM5, recentH1
  };
}

function candidate(features = baseFeatures(), side = 'BUY') {
  const bar = features.recentM5.at(-1);
  return buildGoldForwardResearchObservation({
    signalId: '00000000-0000-4000-8000-000000000001',
    signal: { symbol: 'GOLD#', timeframe: 'M5', strategy_version: 'gold-m5-h1-v2', candidate: side },
    setup: {
      candidate: side, setup_type: 'TEST_SETUP', reason: 'test',
      entry_reference: bar.close, stop_loss: side === 'BUY' ? bar.close - 4 : bar.close + 4,
      take_profit: side === 'BUY' ? bar.close + 8 : bar.close - 8,
      diagnostics: { range_atr: 1.4, body_atr: 0.5, close_location: 0.8, volume_ratio: 1.2, breakout_atr: 0.2, stop_atr: 2 }
    },
    features,
    marketSafety: { allowed: true },
    risk: { approved: false },
    decision: { decision: 'WAIT' },
    state: { mode: 'ANALYSIS', auto_trading_enabled: false },
    createdAt: '2026-11-14T00:00:00.000Z'
  });
}

test('records candidate context but marks research as non-executable', () => {
  const features = baseFeatures();
  const row = candidate(features);
  assert.equal(row.side, 'BUY');
  assert.equal(row.status, 'PENDING');
  assert.equal(row.entry_context.orders_executed, false);
  assert.equal(row.entry_context.risk_approved, false);
  assert.equal(row.entry_context.ai_decision, 'WAIT');
  assert.equal(row.h1_context.momentum_3h_atr_directional > 0, true);
  assert.equal(row.h1_context.ema_slope_status, 'NOT_SENT_BY_V19');
  assert.equal(row.m5_context.range_atr, 1.4);
});

test('does not record WAIT, market-safety blocked, or malformed candidate', () => {
  const features = baseFeatures();
  assert.equal(candidate(features, 'WAIT'), null);
  const blocked = buildGoldForwardResearchObservation({
    signal: { symbol: 'GOLD#', timeframe: 'M5', strategy_version: 'gold-m5-h1-v2' },
    setup: { candidate: 'BUY', entry_reference: 1, stop_loss: 0.5, take_profit: 2 },
    features, marketSafety: { allowed: false }
  });
  assert.equal(blocked, null);
});

test('measures 15m and 30m MFE/MAE and does not infer order inside a same bar', () => {
  const features = baseFeatures();
  const observation = candidate(features);
  const entryTime = features.barTime;
  const entry = observation.entry_reference;
  const future = Array.from({ length: 6 }, (_, index) => ({
    time: entryTime + (index + 1) * 300,
    open: entry, high: entry + (index === 0 ? 9 : 2), low: entry - (index === 0 ? 5 : 1),
    close: entry + 1, volume: 100
  }));
  const laterFeatures = { ...features, barTime: entryTime + 1800, recentM5: [...features.recentM5, ...future] };
  const patch = advanceGoldForwardResearchObservation({ observation, features: laterFeatures, observedAt: '2026-11-14T00:30:00.000Z' });
  assert.equal(patch.status, 'COMPLETED');
  assert.equal(patch.outcome_15m.window_complete, true);
  assert.equal(patch.outcome_15m.expected_bars, 3);
  assert.equal(patch.outcome_15m.mfe_price, 9);
  assert.equal(patch.outcome_15m.mae_price, 5);
  assert.equal(patch.outcome_15m.first_touch, 'AMBIGUOUS_SAME_BAR');
  assert.equal(patch.outcome_30m.window_complete, true);
  assert.equal(patch.outcome_30m.mfe_r, 9 / 4);
});

test('marks a missing horizon candle as DATA_GAP instead of a zero-MFE result', () => {
  const features = baseFeatures();
  const observation = candidate(features, 'SELL');
  const entryTime = features.barTime;
  const future = Array.from({ length: 6 }, (_, index) => ({
    time: entryTime + (index + 1) * 300,
    open: observation.entry_reference, high: observation.entry_reference + 1,
    low: observation.entry_reference - 1, close: observation.entry_reference, volume: 100
  })).filter(bar => bar.time !== entryTime + 600);
  const laterFeatures = { ...features, barTime: entryTime + 1800, recentM5: [...features.recentM5, ...future] };
  const patch = advanceGoldForwardResearchObservation({ observation, features: laterFeatures });
  assert.equal(patch.outcome_15m.data_quality_status, 'DATA_GAP');
  assert.equal(patch.outcome_15m.mfe_price, null);
  assert.equal(patch.outcome_30m.data_quality_status, 'DATA_GAP');
  assert.equal(patch.status, 'COMPLETED');
});
