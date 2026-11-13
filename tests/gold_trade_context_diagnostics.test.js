import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradeContextDiagnostics } from '../scripts/backtest-gold-v2.mjs';

test('trade context diagnostics capture H1 trend, M5 re-acceleration and halfback structure', () => {
  const result = buildTradeContextDiagnostics({
    signalBar: {
      open: 98, high: 101, low: 97, close: 100,
      ema20: 99, atr14: 2
    },
    previousM5: { ema20: 98 },
    h1Bar: {
      close: 105, ema20: 102, ema50: 100, ema200: 95,
      rsi14: 60, atr14: 10
    },
    previousH1: { ema20: 99, ema50: 98 },
    setup: {
      entry_reference: 100,
      diagnostics: {
        observed_retracement: 0.5,
        impulse_range_atr: 1.8,
        impulse_bars: 12,
        extension_atr: 0.4,
        confirmation_body_atr: 0.8,
        confirmation_close_location: 0.75
      }
    },
    entryPrice: 100.5
  });

  assert.equal(result.h1_rsi14, 60);
  assert.ok(Math.abs(result.h1_close_to_ema20_atr - 0.3) < 1e-9);
  assert.ok(Math.abs(result.h1_ema20_slope_3_atr - 0.3) < 1e-9);
  assert.ok(Math.abs(result.h1_ema50_slope_3_atr - 0.2) < 1e-9);
  assert.ok(Math.abs(result.h1_ema20_ema50_gap_atr - 0.2) < 1e-9);
  assert.ok(Math.abs(result.h1_ema50_ema200_gap_atr - 0.5) < 1e-9);
  assert.ok(Math.abs(result.m5_ema20_slope_3_atr - 0.5) < 1e-9);
  assert.ok(Math.abs(result.m5_close_to_ema20_atr - 0.5) < 1e-9);
  assert.equal(result.signal_body_atr, 1);
  assert.equal(result.signal_close_location, 0.75);
  assert.equal(result.entry_gap_atr, 0.25);
  assert.equal(result.observed_retracement, 0.5);
  assert.equal(result.impulse_range_atr, 1.8);
  assert.equal(result.impulse_bars, 12);
});

test('trade context diagnostics return null for unavailable slopes and invalid denominators', () => {
  const result = buildTradeContextDiagnostics({
    signalBar: { open: 100, high: 100, low: 100, close: 100, ema20: 100, atr14: 0 },
    h1Bar: { close: 100, ema20: 100, ema50: 100, ema200: 100, rsi14: 50, atr14: 0 },
    setup: {}
  });
  assert.equal(result.h1_ema20_slope_3_atr, null);
  assert.equal(result.h1_ema50_slope_3_atr, null);
  assert.equal(result.m5_ema20_slope_3_atr, null);
  assert.equal(result.h1_close_to_ema20_atr, null);
  assert.equal(result.signal_body_atr, null);
  assert.equal(result.signal_close_location, null);
  assert.equal(result.entry_gap_atr, null);
});
