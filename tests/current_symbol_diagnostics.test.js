import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EURUSD_DIAGNOSTIC_SYMBOL,
  GOLD_DIAGNOSTIC_SYMBOLS,
  summarizeGoldH1Trend
} from '../src/forward_monitor.js';

test('forward diagnostics scope queries to the active broker-suffixed MT4 symbols', () => {
  assert.equal(EURUSD_DIAGNOSTIC_SYMBOL, 'EURUSD#');
  assert.deepEqual(GOLD_DIAGNOSTIC_SYMBOLS, ['GOLD#']);

  const source = readFileSync(new URL('../src/forward_monitor.js', import.meta.url), 'utf8');
  assert.match(source, /symbol: EURUSD_DIAGNOSTIC_SYMBOL/);
  assert.match(source, /symbols: GOLD_SYMBOLS/);
  assert.match(source, /listTradeResults\(\{ symbols: GOLD_SYMBOLS/);
});

test('H1 diagnostic summary reports exact-suffix GOLD data rather than legacy-symbol records', () => {
  const currentGoldRow = {
    symbol: 'GOLD#',
    reason: 'h1_trend_filter',
    invalid_reasons: [
      'GOLD_V2_DIAG:{"h1_diagnostics_version":2,"h1_up_failure_components":["close_not_above_ema20","rsi_outside_buy_band"],"h1_down_failure_components":["ema20_not_below_ema50","ema50_not_below_ema200"],"h1_up_conditions_passed_count":2,"h1_down_conditions_passed_count":2,"h1_up_gate_passed":false,"h1_down_gate_passed":false,"h1_ema_stack_state":"BULLISH","h1_nearest_direction_by_pass_count":"TIE"}'
    ]
  };
  const legacyGoldRow = {
    symbol: 'GOLD',
    reason: 'h1_trend_filter',
    invalid_reasons: [
      'GOLD_V2_DIAG:{"h1_diagnostics_version":1,"h1_ema_stack_state":"MIXED"}'
    ]
  };

  // The production database query is exact-symbol scoped; retain the same filter in this fixture.
  const matchingRows = [currentGoldRow, legacyGoldRow]
    .filter(row => GOLD_DIAGNOSTIC_SYMBOLS.includes(row.symbol));
  const summary = summarizeGoldH1Trend(matchingRows);

  assert.equal(summary.observations, 1);
  assert.equal(summary.trend_filter_rejected_count, 1);
  assert.deepEqual(summary.ema_stack_state_counts, {
    BULLISH: 1,
    BEARISH: 0,
    MIXED: 0
  });
});
