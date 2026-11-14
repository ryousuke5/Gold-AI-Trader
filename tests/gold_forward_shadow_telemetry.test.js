import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoldForwardH1Telemetry,
  buildGoldForwardPathMetrics,
  normalizeGoldForwardShadowEvent
} from '../src/gold_forward_shadow_telemetry.js';
import { normalizeFeatures } from '../src/features.js';

const HOUR = 3600;
const BASE = Date.parse('2026-11-01T00:00:00.000Z') / 1000;

function h1Series(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    time: BASE + index * HOUR,
    open: 100 + index,
    high: 104 + index,
    low: 99 + index,
    close: 103 + index,
    ema20: 101 + index,
    ema50: 99 + index,
    ema200: 96 + index,
    atr14: 10
  }));
}

test('H1 telemetry uses only completed H1 candles and reports directional trend strength', () => {
  const recentH1 = h1Series();
  recentH1.push({
    time: BASE + 5 * HOUR, open: 105, high: 109, low: 104, close: 108,
    ema20: 106, ema50: 104, ema200: 101, atr14: 10
  });
  const signalBarTime = BASE + 5 * HOUR - 300;
  const result = buildGoldForwardH1Telemetry({
    barTime: signalBarTime,
    recentH1
  }, 'BUY');

  assert.equal(result.quality, 'OK');
  assert.equal(result.completed_h1_bars_used, 5);
  assert.equal(result.h1_ema20_slope_1bar_atr, 0.1);
  assert.equal(result.h1_ema20_slope_3bar_atr, 0.3);
  assert.equal(result.h1_directional_ema20_slope_3bar_atr, 0.3);
  assert.equal(result.h1_ema_alignment_age_bars, 5);
  assert.equal(result.h1_directionally_aligned, true);
  assert.equal(result.latest_completed_h1_open_time_utc, new Date((BASE + 4 * HOUR) * 1000).toISOString());
});

test('H1 telemetry direction-normalizes SELL and flags gaps in the completed H1 series', () => {
  const falling = h1Series().map((bar) => ({
    ...bar,
    close: 110 - (bar.time - BASE) / HOUR,
    ema20: 108 - (bar.time - BASE) / HOUR,
    ema50: 110 - (bar.time - BASE) / HOUR,
    ema200: 113 - (bar.time - BASE) / HOUR
  }));
  const result = buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR - 300,
    recentH1: falling
  }, 'SELL');

  assert.equal(result.quality, 'OK');
  assert.ok(result.h1_directional_ema20_slope_3bar_atr > 0);
  assert.equal(result.h1_directionally_aligned, true);

  const withGap = h1Series().filter((bar) => bar.time !== BASE + 3 * HOUR);
  const gapResult = buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR - 300,
    recentH1: withGap
  }, 'BUY');
  assert.equal(gapResult.quality, 'H1_GAP');
});

test('H1 telemetry refuses unfinished or incomplete EMA history instead of guessing', () => {
  const onlyThree = h1Series(3);
  const result = buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR - 300,
    recentH1: onlyThree
  }, 'BUY');
  assert.equal(result.quality, 'INSUFFICIENT_HISTORY');

  const missingIndicators = h1Series().map(({ ema200, ...bar }) => bar);
  const missing = buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR - 300,
    recentH1: missingIndicators
  }, 'BUY');
  assert.equal(missing.quality, 'INSUFFICIENT_HISTORY');
});

test('MFE/MAE path metrics identify 3-bar and 6-bar snapshots and data gaps', () => {
  const bars = [
    { time: BASE, open: 100, high: 100.6, low: 99.5, close: 100.4 },
    { time: BASE + 300, open: 100.4, high: 101, low: 99, close: 100.6 },
    { time: BASE + 600, open: 100.6, high: 102, low: 99.4, close: 101 },
    { time: BASE + 1200, open: 101, high: 101.5, low: 100.5, close: 101.2 },
    { time: BASE + 1500, open: 101.2, high: 101.7, low: 100.8, close: 101.4 },
    { time: BASE + 1800, open: 101.4, high: 102.2, low: 101, close: 102 }
  ];
  const result = buildGoldForwardPathMetrics({
    side: 'BUY',
    entryPrice: 100,
    stopPrice: 98,
    bars
  });

  assert.equal(result.ok, true);
  assert.equal(result.bars_observed, 6);
  assert.equal(result.after_3_bars.bars_since_entry, 3);
  assert.equal(result.after_6_bars.bars_since_entry, 6);
  assert.equal(result.after_3_bars.mfe_r, 1);
  assert.equal(result.after_3_bars.mae_r, 0.5);
  assert.equal(result.first_threshold, 'FAVORABLE_0_25R');
  assert.equal(result.data_gap_count, 1);
  assert.equal(result.max_gap_seconds, 600);
});

test('MFE/MAE handles SELL orientation and does not guess same-candle threshold order', () => {
  const sell = buildGoldForwardPathMetrics({
    side: 'SELL',
    entryPrice: 100,
    stopPrice: 102,
    bars: [
      { time: BASE, open: 100, high: 100.4, low: 99.4, close: 99.6 },
      { time: BASE + 300, open: 99.6, high: 101.1, low: 98.8, close: 99.1 }
    ]
  });
  assert.equal(sell.ok, true);
  assert.equal(sell.first_threshold, 'FAVORABLE_0_25R');
  assert.equal(sell.after_3_bars, null);
  assert.equal(sell.path[1].mae_r, 0.55);

  const ambiguous = buildGoldForwardPathMetrics({
    side: 'BUY',
    entryPrice: 100,
    stopPrice: 98,
    bars: [
      { time: BASE, open: 100, high: 100.7, low: 99, close: 100.2 }
    ]
  });
  assert.equal(ambiguous.first_threshold, 'AMBIGUOUS_SAME_BAR');
});

test('MFE/MAE flags a same-candle stop and target touch as ambiguous', () => {
  const result = buildGoldForwardPathMetrics({
    side: 'BUY',
    entryPrice: 100,
    stopPrice: 98,
    bars: [
      { time: BASE, open: 100, high: 103, low: 97, close: 100, targetPrice: 102 }
    ]
  });
  assert.equal(result.first_exit_barrier, 'AMBIGUOUS_STOP_AND_TARGET_SAME_BAR');
});

test('feature normalization preserves optional completed H1 EMA values for telemetry', () => {
  const features = normalizeFeatures({
    recent_h1: [{
      time: BASE, open: 100, high: 103, low: 99, close: 102, volume: 500,
      ema20: 101, ema50: 99, ema200: 96, atr14: 10
    }]
  });
  assert.equal(features.recentH1[0].ema20, 101);
  assert.equal(features.recentH1[0].ema50, 99);
  assert.equal(features.recentH1[0].ema200, 96);
  assert.equal(features.recentH1[0].atr14, 10);
});

test('ENTRY event is normalized with directional prices, an idempotency key, and H1 context', () => {
  const entry = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY',
    entry_id: 'paper-entry-0001',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'BUY',
    features: {
      barTime: BASE + 5 * HOUR - 300,
      recentH1: h1Series()
    },
    payload: {
      signal_time_utc: '2026-11-01T04:55:00.000Z',
      entry_time_utc: '2026-11-01T05:00:00.000Z',
      entry_price: 105,
      stop_price: 103,
      target_price: 109,
      entry_bid: 104.9,
      entry_ask: 105,
      spread_price: 0.1
    }
  });

  assert.equal(entry.ok, true);
  assert.equal(entry.row.event_type, 'ENTRY');
  assert.equal(entry.row.event_key, 'paper-entry-0001:ENTRY:ENTRY');
  assert.equal(entry.row.payload.risk_distance_price, 2);
  assert.equal(entry.row.payload.h1_telemetry.quality, 'OK');
  assert.equal(entry.row.payload.h1_telemetry.side, 'BUY');
});

test('ENTRY rejects stop/target geometry that contradicts its direction', () => {
  const result = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY',
    entry_id: 'paper-entry-0002',
    symbol: 'XAUUSD',
    strategy_version: 'test',
    side: 'BUY',
    payload: {
      signal_time_utc: '2026-11-01T04:55:00Z',
      entry_time_utc: '2026-11-01T05:00:00Z',
      entry_price: 100,
      stop_price: 101,
      target_price: 102
    }
  });
  assert.deepEqual(result, { ok: false, error: 'entry_stop_target_direction_mismatch' });
});

test('BAR, GAP, and EXIT events have stable idempotency keys and validated timestamps', () => {
  const common = {
    entry_id: 'paper-entry-0003',
    symbol: 'XAUUSD',
    strategy_version: 'gold-m5-h1-v2',
    side: 'SELL'
  };
  const bar = normalizeGoldForwardShadowEvent({
    ...common,
    event_type: 'BAR',
    payload: {
      bars_since_entry: 1,
      bar_time_utc: '2026-11-01T05:05:00Z',
      open: 100, high: 101, low: 99, close: 99.5
    }
  });
  assert.equal(bar.ok, true);
  assert.equal(bar.row.event_key, 'paper-entry-0003:BAR:2026-11-01T05:05:00.000Z');

  const gap = normalizeGoldForwardShadowEvent({
    ...common,
    event_type: 'GAP',
    payload: {
      from_time_utc: '2026-11-01T05:05:00Z',
      to_time_utc: '2026-11-01T05:20:00Z',
      gap_seconds: 900,
      reason: 'mt4_disconnected'
    }
  });
  assert.equal(gap.ok, true);
  assert.equal(gap.row.payload.gap_seconds, 900);

  const exit = normalizeGoldForwardShadowEvent({
    ...common,
    event_type: 'EXIT',
    payload: {
      exit_time_utc: '2026-11-01T05:35:00Z',
      exit_price: 98,
      exit_reason: 'STOP',
      net_r: -1.04,
      holding_seconds: 2100
    }
  });
  assert.equal(exit.ok, true);
  assert.equal(exit.row.event_key, 'paper-entry-0003:EXIT:EXIT');
  assert.equal(exit.row.payload.net_r, -1.04);
});

test('shadow event validation rejects unknown event types and non-GOLD symbols', () => {
  assert.equal(normalizeGoldForwardShadowEvent({ event_type: 'ORDER_SEND' }).error, 'unsupported_event_type');
  const result = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY',
    entry_id: 'paper-entry-0004',
    symbol: 'EURUSD',
    strategy_version: 'test',
    side: 'BUY',
    payload: {}
  });
  assert.equal(result.error, 'gold_symbol_required');
});
