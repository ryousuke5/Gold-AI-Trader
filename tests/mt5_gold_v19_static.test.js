import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const entry = read('../mt5/GoldAITraderV19_MT5_Research.mq5');
const common = read('../mt5/include/GoldV19MT5_Common.mqh');
const marketSafety = read('../mt5/include/GoldV19MT5_MarketSafety.mqh');
const modules = [
  '../mt5/include/GoldV19MT5_Common.mqh',
  '../mt5/include/GoldV19MT5_Time.mqh',
  '../mt5/include/GoldV19MT5_MarketData.mqh',
  '../mt5/include/GoldV19MT5_MarketSafety.mqh',
  '../mt5/include/GoldV19MT5_Payload.mqh',
  '../mt5/include/GoldV19MT5_Http.mqh',
  '../mt5/include/GoldV19MT5_Flow.mqh'
].map(read);
const source = [entry, ...modules].join('\n');

test('MT5 V19 entry point includes modules in dependency order', () => {
  const names = [
    'GoldV19MT5_Common.mqh',
    'GoldV19MT5_Time.mqh',
    'GoldV19MT5_MarketData.mqh',
    'GoldV19MT5_MarketSafety.mqh',
    'GoldV19MT5_Payload.mqh',
    'GoldV19MT5_Http.mqh',
    'GoldV19MT5_Flow.mqh'
  ];
  let previous = -1;
  for (const name of names) {
    const index = entry.indexOf('#include "include/' + name + '"');
    assert.ok(index > previous, 'missing or out-of-order include: ' + name);
    previous = index;
  }
});

test('MT5 research adapter is network-disabled by default and has no order switch', () => {
  assert.match(entry, /input bool\s+EnableSignalRequests\s*=\s*false;/);
  assert.match(entry, /input bool\s+EnableSafetyHeartbeat\s*=\s*false;/);
  assert.match(entry, /input string ApiKey\s*=\s*"CHANGE_ME";/);
  assert.doesNotMatch(entry, /input bool\s+AllowAutoOrders/);
  assert.match(source, /allow_auto_orders\\":false/);
});

test('MT5 adapter avoids reserved symbol names and MQL4-only time functions', () => {
  assert.match(entry, /input string\s+InpSymbol\s*=/);
  assert.doesNotMatch(entry, /input string\s+SymbolName\s*=/);
  assert.match(common, /TrimText\(InpSymbol\)/);
  assert.match(marketSafety, /MqlDateTime\s+nowUtcParts/);
  assert.match(marketSafety, /TimeToStruct\(nowUtc,\s*nowUtcParts\)/);
  assert.match(marketSafety, /nowUtcParts\.day_of_week\s*==\s*0/);
  assert.match(marketSafety, /nowUtcParts\.hour\s*>=\s*20/);
  assert.match(marketSafety, /nowUtcParts\.hour\s*<=\s*23/);
  assert.doesNotMatch(marketSafety, /\bTimeDayOfWeek\s*\(|\bTimeHour\s*\(/);
});

test('MT5 adapter contains no order-execution APIs', () => {
  assert.doesNotMatch(source, /\bCTrade\b/);
  assert.doesNotMatch(source, /\bOrderSend\s*\(/);
  assert.doesNotMatch(source, /\bOrderClose\s*\(/);
  assert.doesNotMatch(source, /\bOrderModify\s*\(/);
  assert.doesNotMatch(source, /\bPositionOpen\s*\(/);
  assert.doesNotMatch(source, /\bPositionClose\s*\(/);
  assert.doesNotMatch(source, /\.Buy\s*\(/);
  assert.doesNotMatch(source, /\.Sell\s*\(/);
});

test('MT5 adapter uses native handles, CopyBuffer, CopyRates and SymbolInfoTick', () => {
  assert.match(source, /\biMA\s*\(/);
  assert.match(source, /\biRSI\s*\(/);
  assert.match(source, /\biATR\s*\(/);
  assert.match(source, /\bCopyBuffer\s*\(/);
  assert.match(source, /\bCopyRates\s*\(/);
  assert.match(source, /\bSymbolInfoTick\s*\(/);
  assert.match(source, /\bHistorySelect\s*\(/);
  assert.match(source, /\bPositionGetTicket\s*\(/);
});

test('MT5 adapter preserves the existing API payload and endpoints', () => {
  for (const field of [
    'symbol', 'timeframe', 'market_safety', 'features',
    'recent_m5', 'recent_h1', 'account', 'ea_runtime',
    'allow_auto_orders'
  ]) assert.ok(source.includes(field), 'missing payload field: ' + field);
  assert.match(source, /allow_auto_orders\\":false/);

  assert.ok(source.includes('/api/gold/market-safety'));
  assert.ok(source.includes('/api/gold/signal'));
  assert.ok(source.includes('X-Gold-API-Key:'));
  assert.ok(source.includes('WebRequest('));
});

test('signal payload reuses the market-safety quote snapshot', () => {
  const payload = read('../mt5/include/GoldV19MT5_Payload.mqh');
  assert.match(payload, /double bid = g_marketSafetyBid;/);
  assert.match(payload, /double ask = g_marketSafetyAsk;/);
  assert.match(payload, /double spread = g_marketSafetySpread;/);
  assert.doesNotMatch(payload, /JsonNumber\(tick\.(bid|ask),/);
});

test('MT5 bar-copy routine requires 24 completed bars and keeps chronological JSON', () => {
  assert.match(source, /CopyRates\(sym,\s*PERIOD_M5,\s*1,\s*24,\s*m5Bars\)\s*!=\s*24/);
  assert.match(source, /CopyRates\(sym,\s*PERIOD_H1,\s*1,\s*24,\s*h1Bars\)\s*!=\s*24/);
  assert.match(source, /for\(int i = 0; i < count; i\+\+\)/);
});
