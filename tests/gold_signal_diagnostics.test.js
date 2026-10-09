import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldSignalDiagnosticLog } from '../src/gold_signal_diagnostics.js';

test('Gold signal diagnostic log preserves H1 gate components without raw prices', () => {
  const payload = buildGoldSignalDiagnosticLog({
    requestId: 'request-123',
    signal: {
      id: 'signal-456',
      symbol: 'XAUUSD',
      timeframe: 'M5',
      bar_time: '2026-10-09T12:25:00.000Z',
      strategy_version: 'gold-m5-h1-v2',
      candidate: 'WAIT',
      decision: 'WAIT',
      reason: 'h1_trend_filter'
    },
    setup: {
      reason: 'h1_trend_filter',
      diagnostics: {
        h1_diagnostics_version: 1,
        h1_close_vs_ema20_atr: -0.2,
        h1_ema20_vs_ema50_atr: 0.1,
        h1_ema50_vs_ema200_atr: -0.3,
        h1_rsi14: 49,
        h1_min_rsi_buy: 50,
        h1_max_rsi_buy: 72,
        h1_min_rsi_sell: 28,
        h1_max_rsi_sell: 50,
        h1_up_close_above_ema20: false,
        h1_up_ema20_above_ema50: true,
        h1_up_ema50_above_ema200: false,
        h1_up_rsi_in_band: false,
        h1_down_close_below_ema20: true,
        h1_down_ema20_below_ema50: false,
        h1_down_ema50_below_ema200: true,
        h1_down_rsi_in_band: true,
        h1_up_failure_components: ['close_not_above_ema20', 'ema50_not_above_ema200', 'rsi_outside_buy_band'],
        h1_down_failure_components: ['ema20_not_below_ema50'],
        range_atr: 1.4,
        min_range_atr: 0.8,
        max_range_atr: 2.8
      }
    },
    risk: { approved: false },
    state: { mode: 'ANALYSIS', auto_trading_enabled: false }
  });

  assert.equal(payload.event, 'gold_signal_evaluated');
  assert.equal(payload.request_id, 'request-123');
  assert.equal(payload.reason, 'h1_trend_filter');
  assert.equal(payload.risk_approved, false);
  assert.equal(payload.h1.diagnostics_version, 1);
  assert.equal(payload.h1.close_vs_ema20_atr, -0.2);
  assert.equal(payload.h1.rsi14, 49);
  assert.equal(payload.h1.up_checks.close_above_ema20, false);
  assert.equal(payload.h1.down_checks.ema20_below_ema50, false);
  assert.deepEqual(payload.h1.up_failure_components, [
    'close_not_above_ema20',
    'ema50_not_above_ema200',
    'rsi_outside_buy_band'
  ]);
  assert.equal(payload.range_atr, 1.4);
  assert.equal(payload.runtime_mode, 'ANALYSIS');
  assert.equal(payload.auto_trading_enabled, false);
  assert.equal(JSON.stringify(payload).includes('2504'), false);
  assert.equal(JSON.stringify(payload).includes('equity'), false);
  assert.equal(JSON.stringify(payload).includes('GOLD_API_KEY'), false);
});

test('Gold signal diagnostic log handles missing H1 diagnostics and malformed values safely', () => {
  const payload = buildGoldSignalDiagnosticLog({
    requestId: 'request-789',
    signal: { candidate: 'WAIT', decision: 'WAIT', reason: 'session_filter' },
    setup: { reason: 'session_filter', diagnostics: { range_atr: 'bad', min_range_atr: null } },
    risk: { approved: false }
  });

  assert.equal(payload.h1, null);
  assert.equal(payload.range_atr, null);
  assert.equal(payload.range_min_atr, null);
  assert.equal(payload.range_max_atr, null);
  assert.equal(payload.reason, 'session_filter');
  assert.equal(payload.runtime_mode, 'ANALYSIS');
  assert.equal(payload.auto_trading_enabled, false);
});
