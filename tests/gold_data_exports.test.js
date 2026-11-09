import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldExportCsv } from '../src/gold_data_exports.js';

test('exports V19 safety heartbeat rows with gate and EA runtime fields', () => {
  const result = buildGoldExportCsv('market-safety', {
    events: [{
      id: 'evt-1',
      created_at: '2026-11-10T00:00:00.000Z',
      metadata: {
        symbol: 'GOLD#',
        status: 'BLOCKED',
        freshness: 'FRESH',
        reason: 'market_reopen_lock',
        spread_price: 0.28,
        stable_tick_count: 0,
        ea_runtime: { allow_auto_orders: false, flow_status: 'SAFETY_BLOCKED' }
      }
    }]
  });
  assert.equal(result.filename, 'GOLD_MarketSafety.csv');
  assert.equal(result.rowCount, 1);
  assert.match(result.content, /market_reopen_lock/);
  assert.match(result.content, /SAFETY_BLOCKED/);
});

test('flattens and de-duplicates M5/H1 research bars', () => {
  const base = {
    symbol: 'GOLD#',
    m5: { ema20: 4100, ema50: 4095, rsi14: 55, atr14: 2.1 },
    h1: { close: 4102, ema20: 4099, ema50: 4090, ema200: 4070, rsi14: 58, atr14: 7.5 },
    recent_m5: [{ time: 1794268800, open: 4099, high: 4102, low: 4098, close: 4101, volume: 120 }],
    recent_h1: [{ time: 1794268800, open: 4090, high: 4105, low: 4088, close: 4102, volume: 900 }]
  };
  const result = buildGoldExportCsv('m5-h1', {
    events: [
      { id: 'evt-1', created_at: '2026-11-10T00:00:00.000Z', metadata: { symbol: 'GOLD#', research_snapshot: base } },
      { id: 'evt-2', created_at: '2026-11-10T00:05:00.000Z', metadata: { symbol: 'GOLD#', research_snapshot: base } }
    ]
  });
  assert.equal(result.filename, 'GOLD_M5_H1_Data.csv');
  assert.equal(result.rowCount, 2);
  assert.match(result.content, /4099/);
  assert.match(result.content, /M5/);
  assert.match(result.content, /H1/);
});

test('does not label non-paper trade results as Paper', () => {
  const result = buildGoldExportCsv('paper-trades', {
    trades: [
      { id: 'live-1', symbol: 'GOLD#', result: 'WIN', metadata: { mode: 'LIVE' } },
      { id: 'paper-1', symbol: 'GOLD#', result: 'LOSS', r_multiple: -1, metadata: { mode: 'PAPER' } }
    ]
  });
  assert.equal(result.filename, 'GOLD_Paper_Trades.csv');
  assert.equal(result.rowCount, 1);
  assert.match(result.content, /PAPER/);
  assert.doesNotMatch(result.content, /LIVE/);
});

test('quotes CSV cells and blocks formula-like text', () => {
  const result = buildGoldExportCsv('signals', {
    signals: [{
      id: 's1', symbol: 'GOLD#', timeframe: 'M5',
      reason: '=HYPERLINK("https://bad")', invalid_reasons: ['wait,reason']
    }]
  });
  assert.match(result.content, /'=HYPERLINK/);
  assert.match(result.content, /"\[""wait,reason""\]"/);
});
