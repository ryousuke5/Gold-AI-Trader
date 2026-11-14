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
    time: BASE + (index + 1) * HOUR,
    open: 100 + index, high: 104 + index, low: 99 + index,
    close: 103 + index, ema20: 101 + index, ema50: 99 + index,
    ema200: 96 + index, atr14: 10
  }));
}

function dualBar(time, bid, spread = 0.1) {
  const ask = Object.fromEntries(Object.entries(bid).map(([key, value]) => [key, value + spread]));
  return { time, bid_ohlc: bid, ask_ohlc: ask, tick_data_quality: 'BID_ASK_TICK_AGGREGATED' };
}

function entryPayload(overrides = {}) {
  return {
    signal_time_utc: '2026-11-01T05:00:00.000Z',
    entry_time_utc: '2026-11-01T05:00:03.000Z',
    entry_price: 105,
    signal_reference_bid: 104.9,
    stop_price: 103,
    target_price: 109,
    expected_stop_fill_price: 102.95,
    expected_stop_spread_price: 0,
    expected_stop_slippage_price: 0.05,
    cost_model_version: 'XM_KIWAMI_BID_ASK_SLIPPAGE_V1',
    entry_bid: 104.9,
    entry_ask: 105,
    spread_price: 0.1,
    ...overrides
  };
}

test('H1 telemetry uses only completed H1 candles and reports directional trend strength', () => {
  const recentH1 = h1Series();
  recentH1.push({
    time: BASE + 6 * HOUR, open: 105, high: 109, low: 104, close: 108,
    ema20: 106, ema50: 104, ema200: 101, atr14: 10
  });
  const result = buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR, recentH1
  }, 'BUY');
  assert.equal(result.quality, 'OK');
  assert.equal(result.completed_h1_bars_used, 5);
  assert.ok(Math.abs(result.h1_ema20_slope_1bar_atr - 0.1) < 1e-9);
  assert.ok(Math.abs(result.h1_ema20_slope_3bar_atr - 0.3) < 1e-9);
  assert.ok(Math.abs(result.h1_directional_ema20_slope_3bar_atr - 0.3) < 1e-9);
  assert.equal(result.h1_ema_alignment_age_bars, 5);
  assert.equal(result.h1_directional_ema20_slope_agreement_count_last3, 3);
  assert.equal(result.h1_directional_ema20_slope_agreement_ratio_last3, 1);
  assert.equal(result.h1_directionally_aligned, true);
  assert.equal(result.latest_completed_h1_close_time_utc, new Date((BASE + 5 * HOUR) * 1000).toISOString());
});

test('H1 telemetry direction-normalizes SELL and flags gaps in completed H1 series', () => {
  const falling = h1Series().map((bar) => ({
    ...bar,
    close: 106 - (bar.time - BASE) / HOUR,
    ema20: 108 - (bar.time - BASE) / HOUR,
    ema50: 110 - (bar.time - BASE) / HOUR,
    ema200: 113 - (bar.time - BASE) / HOUR
  }));
  const result = buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR, recentH1: falling
  }, 'SELL');
  assert.equal(result.quality, 'OK');
  assert.ok(result.h1_directional_ema20_slope_3bar_atr > 0);
  assert.equal(result.h1_directionally_aligned, true);
  const withGap = h1Series().filter((bar) => bar.time !== BASE + 3 * HOUR);
  const gap = buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR, recentH1: withGap
  }, 'BUY');
  assert.equal(gap.quality, 'H1_GAP');
});

test('H1 telemetry refuses unfinished or incomplete EMA history', () => {
  assert.equal(buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR, recentH1: h1Series(3)
  }, 'BUY').quality, 'INSUFFICIENT_HISTORY');
  const missing = h1Series().map(({ ema200, ...bar }) => bar);
  assert.equal(buildGoldForwardH1Telemetry({
    barTime: BASE + 5 * HOUR, recentH1: missing
  }, 'BUY').quality, 'INSUFFICIENT_HISTORY');
});

test('BUY MFE/MAE uses executable BID exit OHLC and effective entry-to-stop-fill R', () => {
  const bars = [
    dualBar(BASE, { open: 100, high: 100.6, low: 99.5, close: 100.4 }),
    dualBar(BASE + 300, { open: 100.4, high: 101, low: 99, close: 100.6 }),
    dualBar(BASE + 600, { open: 100.6, high: 102, low: 99.4, close: 101 }),
    dualBar(BASE + 1200, { open: 101, high: 101.5, low: 100.5, close: 101.2 }),
    dualBar(BASE + 1500, { open: 101.2, high: 101.7, low: 100.8, close: 101.4 }),
    dualBar(BASE + 1800, { open: 101.4, high: 102.2, low: 101, close: 102 })
  ];
  const result = buildGoldForwardPathMetrics({
    side: 'BUY', entryPrice: 100, stopPrice: 98, targetPrice: 102,
    expectedStopFillPrice: 98, effectiveRiskDistancePrice: 2,
    rawStopDistanceBid: 2.1, entryTimeUtc: new Date((BASE - 297) * 1000).toISOString(), bars
  });
  assert.equal(result.ok, true);
  assert.equal(result.effective_risk_distance_price, 2);
  assert.equal(result.raw_stop_distance_bid, 2.1);
  assert.equal(result.entry_quote_side, 'ASK');
  assert.equal(result.after_3_segments.segments_since_entry, 3);
  assert.equal(result.after_6_segments.segments_since_entry, 6);
  assert.equal(result.after_15_minutes.segments_since_entry, 4);
  assert.equal(result.after_30_minutes.segments_since_entry, 6);
  assert.equal(result.after_3_segments.mfe_r, 1);
  assert.equal(result.after_3_segments.mae_r, 0.5);
  assert.equal(result.first_threshold, 'FAVORABLE_0_25R');
  assert.equal(result.data_gap_count, 1);
  assert.equal(result.max_gap_seconds, 600);
});

test('SELL MFE/MAE uses executable ASK exit OHLC while logical barriers use BID', () => {
  const sell = buildGoldForwardPathMetrics({
    side: 'SELL', entryPrice: 100, stopPrice: 102, targetPrice: 98,
    expectedStopFillPrice: 102.15, effectiveRiskDistancePrice: 2.15,
    rawStopDistanceBid: 2, entryTimeUtc: new Date((BASE - 297) * 1000).toISOString(),
    bars: [
      dualBar(BASE, { open: 100, high: 100.4, low: 99.4, close: 99.6 }, 0.1),
      dualBar(BASE + 300, { open: 99.6, high: 100.8, low: 98.8, close: 99.1 }, 0.1)
    ]
  });
  assert.equal(sell.ok, true);
  assert.equal(sell.entry_quote_side, 'BID');
  assert.equal(sell.expected_stop_fill_quote_side, 'ASK');
  assert.equal(sell.first_threshold, 'FAVORABLE_0_25R');
  assert.equal(sell.after_3_segments, null);
  assert.ok(Math.abs(sell.path[1].mae_r - (100.9 - 100) / 2.15) < 1e-6);
});

test('MFE/MAE marks same-bar favorable/adverse threshold touches ambiguous', () => {
  const result = buildGoldForwardPathMetrics({
    side: 'BUY', entryPrice: 100, stopPrice: 98, targetPrice: 102,
    expectedStopFillPrice: 98, effectiveRiskDistancePrice: 2,
    bars: [dualBar(BASE, { open: 100, high: 100.7, low: 99, close: 100.2 })]
  });
  assert.equal(result.first_threshold, 'AMBIGUOUS_SAME_BAR');
});

test('MFE/MAE flags same-candle BID stop and target touches as ambiguous', () => {
  const result = buildGoldForwardPathMetrics({
    side: 'BUY', entryPrice: 100, stopPrice: 98, targetPrice: 102,
    expectedStopFillPrice: 98, effectiveRiskDistancePrice: 2,
    bars: [dualBar(BASE, { open: 100, high: 103, low: 97, close: 100 })]
  });
  assert.equal(result.first_exit_barrier, 'AMBIGUOUS_STOP_AND_TARGET_SAME_BAR');
});

test('MFE/MAE rejects missing quote side and reverse-ordered bars', () => {
  const missingAsk = buildGoldForwardPathMetrics({
    side: 'BUY', entryPrice: 100, stopPrice: 98, targetPrice: 102,
    expectedStopFillPrice: 98, effectiveRiskDistancePrice: 2,
    bars: [{ time: BASE, bid_ohlc: { open: 100, high: 101, low: 99, close: 100 } }]
  });
  assert.equal(missingAsk.ok, false);
  assert.equal(missingAsk.error, 'invalid_or_missing_bid_ask_ohlc');

  const reversed = buildGoldForwardPathMetrics({
    side: 'BUY', entryPrice: 100, stopPrice: 98, targetPrice: 102,
    expectedStopFillPrice: 98, effectiveRiskDistancePrice: 2,
    bars: [
      dualBar(BASE + 300, { open: 100, high: 101, low: 99, close: 100.5 }),
      dualBar(BASE, { open: 100.5, high: 101, low: 100, close: 100.2 })
    ]
  });
  assert.equal(reversed.ok, false);
  assert.equal(reversed.error, 'non_ascending_m5_bar_time');
});

test('MFE/MAE refuses a mismatched effective R denominator', () => {
  const result = buildGoldForwardPathMetrics({
    side: 'SELL', entryPrice: 100, stopPrice: 102, targetPrice: 98,
    expectedStopFillPrice: 102.15, effectiveRiskDistancePrice: 2,
    bars: []
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'effective_risk_distance_mismatch');
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

test('ENTRY calculates effective risk from executable entry and expected stop fills', () => {
  const entry = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY', entry_id: 'paper-entry-0001', symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2', side: 'BUY',
    features: { barTime: BASE + 5 * HOUR, recentH1: h1Series() },
    payload: entryPayload()
  });
  assert.equal(entry.ok, true);
  assert.equal(entry.row.event_type, 'ENTRY');
  assert.equal(entry.row.event_key, 'paper-entry-0001:ENTRY:ENTRY');
  assert.equal(entry.row.payload.raw_stop_distance_bid, 1.9);
  assert.ok(Math.abs(entry.row.payload.effective_risk_distance_price - 2.05) < 1e-9);
  assert.equal(entry.row.payload.risk_basis, 'ENTRY_FILL_TO_EXPECTED_STOP_FILL');
  assert.equal(entry.row.payload.cost_model_version, 'XM_KIWAMI_BID_ASK_SLIPPAGE_V1');
  assert.equal(entry.row.payload.h1_telemetry.quality, 'OK');
  assert.equal(entry.row.payload.h1_telemetry.side, 'BUY');
});

test('SELL ENTRY calculates spread and stop slippage into its effective risk distance', () => {
  const sell = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY', entry_id: 'paper-entry-sell-1', symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2', side: 'SELL',
    features: { barTime: BASE + 5 * HOUR, recentH1: h1Series() },
    payload: entryPayload({
      entry_price: 104.9, signal_reference_bid: 105, stop_price: 107,
      target_price: 101, expected_stop_fill_price: 107.2,
      expected_stop_spread_price: 0.1, expected_stop_slippage_price: 0.1,
      entry_bid: 104.9, entry_ask: 105, spread_price: 0.1
    })
  });
  assert.equal(sell.ok, true);
  assert.ok(Math.abs(sell.row.payload.effective_risk_distance_price - 2.3) < 1e-9);
  assert.equal(sell.row.payload.raw_stop_distance_bid, 2);
  assert.equal(sell.row.payload.expected_stop_fill_quote_side, 'ASK');
});

test('ENTRY rejects stop/target geometry that contradicts its direction', () => {
  const result = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY', entry_id: 'paper-entry-0002', symbol: 'XAUUSD',
    strategy_version: 'test', side: 'BUY',
    features: { barTime: BASE + 5 * HOUR, recentH1: h1Series() },
    payload: entryPayload({
      signal_reference_bid: 100, stop_price: 101, target_price: 102,
      entry_price: 100.1, entry_bid: 100, entry_ask: 100.1,
      expected_stop_fill_price: 99
    })
  });
  assert.deepEqual(result, { ok: false, error: 'entry_stop_target_or_expected_fill_direction_mismatch' });
});

test('ENTRY rejects invalid timestamps and signal time mismatch', () => {
  const beforeSignal = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY', entry_id: 'paper-entry-0005', symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2', side: 'BUY',
    payload: entryPayload({ entry_time_utc: '2026-11-01T04:59:59Z' })
  });
  assert.equal(beforeSignal.error, 'entry_time_must_not_precede_signal_time');

  const signalMismatch = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY', entry_id: 'paper-entry-0006', symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2', side: 'BUY',
    features: { barTime: BASE + 5 * HOUR, recentH1: h1Series() },
    payload: entryPayload({ signal_time_utc: '2026-11-01T05:00:20Z' })
  });
  assert.equal(signalMismatch.error, 'signal_time_does_not_match_completed_m5_bar');
});

test('BAR, GAP, and EXIT events have stable idempotency keys and validated timestamps', () => {
  const common = {
    entry_id: 'paper-entry-0003', symbol: 'XAUUSD',
    strategy_version: 'gold-m5-h1-v2', side: 'SELL'
  };
  const bar = normalizeGoldForwardShadowEvent({
    ...common, event_type: 'BAR',
    payload: {
      segments_since_entry: 1,
      bar_time_utc: '2026-11-01T05:05:00Z',
      is_partial: false,
      bar_duration_seconds: 300,
      bid_ohlc: { open: 100, high: 101, low: 99, close: 99.5 },
      ask_ohlc: { open: 100.1, high: 101.1, low: 99.1, close: 99.6 },
      tick_data_quality: 'BID_ASK_TICK_AGGREGATED'
    }
  });
  assert.equal(bar.ok, true);
  assert.equal(bar.row.event_key, 'paper-entry-0003:BAR:2026-11-01T05:05:00.000Z:1');
  assert.equal(bar.row.payload.ask_ohlc.close, 99.6);
  assert.equal(bar.row.payload.bar_duration_seconds, 300);

  const invalidBar = normalizeGoldForwardShadowEvent({
    ...common, event_type: 'BAR',
    payload: {
      segments_since_entry: 2, bar_time_utc: '2026-11-01T05:10:00Z',
      bid_ohlc: { open: 100, high: 101, low: 99, close: 99.5 }
    }
  });
  assert.equal(invalidBar.error, 'invalid_or_missing_bid_ask_ohlc');

  const gap = normalizeGoldForwardShadowEvent({
    ...common, event_type: 'GAP',
    payload: {
      from_time_utc: '2026-11-01T05:05:00Z',
      to_time_utc: '2026-11-01T05:20:00Z',
      gap_seconds: 900, reason: 'mt4_disconnected'
    }
  });
  assert.equal(gap.ok, true);
  assert.equal(gap.row.payload.gap_seconds, 900);

  const exit = normalizeGoldForwardShadowEvent({
    ...common, event_type: 'EXIT',
    payload: {
      exit_time_utc: '2026-11-01T05:35:00Z',
      exit_price: 98.1, exit_bid: 98, exit_ask: 98.1, exit_spread_price: 0.1,
      exit_reason: 'STOP', cost_completeness: 'SPREAD_AND_CONFIGURED_SLIPPAGE_EXCLUDES_COMMISSION_SWAP', net_r: -1.04, holding_seconds: 2100
    }
  });
  assert.equal(exit.ok, true);
  assert.equal(exit.row.event_key, 'paper-entry-0003:EXIT:EXIT');
  assert.equal(exit.row.payload.net_r, -1.04);
  assert.equal(exit.row.payload.exit_quote_side, 'ASK');
  assert.ok(Math.abs(exit.row.payload.exit_slippage_price_signed) < 1e-9);

  const badExitSide = normalizeGoldForwardShadowEvent({
    ...common, event_type: 'EXIT',
    payload: {
      exit_time_utc: '2026-11-01T05:40:00Z',
      exit_price: 98, exit_bid: 98, exit_ask: 98.1, exit_spread_price: 0.1,
      exit_reason: 'STOP', cost_completeness: 'SPREAD_AND_CONFIGURED_SLIPPAGE_EXCLUDES_COMMISSION_SWAP', net_r: -1, holding_seconds: 2400
    }
  });
  assert.equal(badExitSide.ok, false);
  assert.equal(badExitSide.error, 'exit_bid_ask_spread_or_executable_fill_side_invalid');
});

test('shadow event validation rejects unknown event types and non-GOLD symbols', () => {
  assert.equal(normalizeGoldForwardShadowEvent({ event_type: 'ORDER_SEND' }).error, 'unsupported_event_type');
  const result = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY', entry_id: 'paper-entry-0004', symbol: 'EURUSD',
    strategy_version: 'test', side: 'BUY', payload: {}
  });
  assert.equal(result.error, 'gold_symbol_required');
});


test('BAR accepts an explicitly bounded partial M5 interval with a tick-time timestamp', () => {
  const result = normalizeGoldForwardShadowEvent({
    entry_id: 'paper-entry-partial-1',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'BUY',
    event_type: 'BAR',
    payload: {
      segments_since_entry: 1,
      bar_time_utc: '2026-11-01T05:02:17Z',
      is_partial: true,
      bar_duration_seconds: 134,
      bid_ohlc: { open: 100, high: 101, low: 99.5, close: 100.8 },
      ask_ohlc: { open: 100.1, high: 101.1, low: 99.6, close: 100.9 },
      tick_data_quality: 'BID_ASK_TICK_AGGREGATED'
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.row.payload.is_partial, true);
  assert.equal(result.row.payload.bar_duration_seconds, 134);
});

test('BAR rejects a partial interval longer than one M5 period', () => {
  const result = normalizeGoldForwardShadowEvent({
    entry_id: 'paper-entry-partial-2',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'BUY',
    event_type: 'BAR',
    payload: {
      segments_since_entry: 1,
      bar_time_utc: '2026-11-01T05:02:17Z',
      is_partial: true,
      bar_duration_seconds: 301,
      bid_ohlc: { open: 100, high: 101, low: 99.5, close: 100.8 },
      ask_ohlc: { open: 100.1, high: 101.1, low: 99.6, close: 100.9 },
      tick_data_quality: 'BID_ASK_TICK_AGGREGATED'
    }
  });
  assert.equal(result.ok, false);
});


test('EXIT refuses to label quote-only results as fully cost-adjusted without cost status', () => {
  const result = normalizeGoldForwardShadowEvent({
    entry_id: 'paper-entry-cost-1',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'BUY',
    event_type: 'EXIT',
    payload: {
      exit_time_utc: '2026-11-01T05:45:00Z',
      exit_price: 100, exit_bid: 100, exit_ask: 100.1, exit_spread_price: 0.1,
      exit_reason: 'TIME', net_r: 0.2, holding_seconds: 2700
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'explicit_cost_completeness_required');
});


test('BAR event keys include sequence numbers for same-second partial segments', () => {
  const common = {
    entry_id: 'paper-entry-sequence-1',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'BUY',
    event_type: 'BAR'
  };
  const payload = {
    bar_time_utc: '2026-11-01T05:05:00Z',
    is_partial: true,
    bar_duration_seconds: 1,
    bid_ohlc: { open: 100, high: 100.1, low: 99.9, close: 100 },
    ask_ohlc: { open: 100.1, high: 100.2, low: 100, close: 100.1 },
    tick_data_quality: 'BID_ASK_TICK_AGGREGATED'
  };
  const first = normalizeGoldForwardShadowEvent({ ...common, payload: { ...payload, segments_since_entry: 1 } });
  const second = normalizeGoldForwardShadowEvent({ ...common, payload: { ...payload, segments_since_entry: 2 } });
  assert.notEqual(first.row.event_key, second.row.event_key);
});


test('ENTRY rejects fills that are not on the executable quote side', () => {
  const badBuy = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY',
    entry_id: 'paper-entry-bad-buy',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'BUY',
    features: { barTime: BASE + 5 * HOUR, recentH1: h1Series() },
    payload: entryPayload({ entry_price: 104.95 })
  });
  assert.equal(badBuy.ok, false);
  assert.equal(badBuy.error, 'entry_quote_and_stop_cost_model_fields_required_or_inconsistent');

  const badSell = normalizeGoldForwardShadowEvent({
    event_type: 'ENTRY',
    entry_id: 'paper-entry-bad-sell',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'SELL',
    features: { barTime: BASE + 5 * HOUR, recentH1: h1Series() },
    payload: entryPayload({
      entry_price: 104.95,
      signal_reference_bid: 105,
      stop_price: 107,
      target_price: 101,
      expected_stop_spread_price: 0.1,
      expected_stop_slippage_price: 0.1,
      expected_stop_fill_price: 107.2,
      entry_bid: 104.9,
      entry_ask: 105,
      spread_price: 0.1
    })
  });
  assert.equal(badSell.ok, false);
  assert.equal(badSell.error, 'entry_quote_and_stop_cost_model_fields_required_or_inconsistent');
});


test('BAR rejects incomplete intervals that are not explicitly marked partial', () => {
  const result = normalizeGoldForwardShadowEvent({
    entry_id: 'paper-entry-full-short-1',
    symbol: 'GOLD#',
    strategy_version: 'gold-m5-h1-v2',
    side: 'BUY',
    event_type: 'BAR',
    payload: {
      segments_since_entry: 1,
      bar_time_utc: '2026-11-01T05:05:00Z',
      is_partial: false,
      bar_duration_seconds: 299,
      bid_ohlc: { open: 100, high: 101, low: 99.5, close: 100.8 },
      ask_ohlc: { open: 100.1, high: 101.1, low: 99.6, close: 100.9 },
      tick_data_quality: 'BID_ASK_TICK_AGGREGATED'
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_or_missing_bid_ask_ohlc');
});
