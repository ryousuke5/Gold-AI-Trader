import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const entry = read('../mt5/GoldAITraderV19_MT5_Research.mq5');
const common = read('../mt5/include/GoldV19MT5_Common.mqh');
const marketSafety = read('../mt5/include/GoldV19MT5_MarketSafety.mqh');
const flow = read('../mt5/include/GoldV19MT5_Flow.mqh');
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
  assert.match(marketSafety, /bool\s+IsWithinTradingSession\s*\(/);
  assert.match(marketSafety, /SymbolInfoSessionTrade\s*\(/);
  assert.match(marketSafety, /reason\s*=\s*"market_closed"/);
  assert.match(marketSafety, /datetime\s+serverNow\s*=\s*TimeTradeServer\(\)/);
  assert.doesNotMatch(marketSafety, /\bTimeDayOfWeek\s*\(|\bTimeHour\s*\(/);
});

test('missing API credentials allow local safety monitoring but block every network route', () => {
  const updateIndex = flow.indexOf('UpdateMarketSafety(sym);');
  const heartbeatIndex = flow.indexOf('if(g_apiConfigReady &&');
  const signalDisabledIndex = flow.indexOf('if(!EnableSignalRequests)');
  const apiGuardIndex = flow.indexOf('if(!g_apiConfigReady)', signalDisabledIndex);
  assert.ok(updateIndex >= 0 && heartbeatIndex > updateIndex);
  assert.ok(signalDisabledIndex > heartbeatIndex);
  assert.ok(apiGuardIndex > signalDisabledIndex);
  assert.match(flow, /g_signalFlowStatus\s*=\s*\(!g_apiConfigReady\s*\?\s*"LOCAL_ONLY"\s*:\s*"DISABLED"\)/);
  assert.match(flow, /if\(g_apiConfigReady\s*&&\s*EnableSafetyHeartbeat/);
  assert.match(flow, /g_signalFlowStatus\s*=\s*"API_CONFIG_INVALID"/);
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


test('FXTF profile is pinned to XAUUSD, JPY and the observed contract specification', () => {
  assert.match(entry, /input string\s+InpSymbol\s*=\s*"XAUUSD"/);
  assert.match(entry, /ExpectedFXTFServer\s*=\s*"FXTF-MT5"/);
  assert.match(common, /ACCOUNT_SERVER/);
  assert.match(common, /ExpectedDepositCurrency/);
  assert.match(common, /SYMBOL_TRADE_CONTRACT_SIZE/);
  assert.match(common, /SYMBOL_VOLUME_MIN/);
  assert.match(common, /MathAbs\(minVolume - 1\.0\)/);
  assert.match(common, /MathAbs\(volumeStep - 1\.0\)/);
  assert.match(common, /SYMBOL_TRADE_TICK_VALUE/);
});

test('FXTF daily realized PnL includes opening-side commissions and fees', () => {
  const marketData = read('../mt5/include/GoldV19MT5_MarketData.mqh');
  assert.match(marketData, /HistoryDealGetDouble\(ticket, DEAL_COMMISSION\)/);
  assert.match(marketData, /HistoryDealGetDouble\(ticket, DEAL_FEE\)/);
  assert.match(marketData, /datetime now = TimeTradeServer\(\)/);
  assert.doesNotMatch(marketData, /entry != DEAL_ENTRY_OUT/);
});

test('FXTF real and contest accounts are hard-blocked from Render network calls', () => {
  assert.match(common, /return \(AccountInfoInteger\(ACCOUNT_TRADE_MODE\) == ACCOUNT_TRADE_MODE_DEMO\)/);
  assert.match(flow, /if\(!NetworkAllowedForCurrentAccount\(\)\)/);
  assert.match(flow, /REAL_ACCOUNT_LOCAL_ONLY/);
});

test('FXTF server UTC conversion accepts only GMT+2 or GMT+3', () => {
  const timeModule = read('../mt5/include/GoldV19MT5_Time.mqh');
  assert.match(timeModule, /roundedOffset != 7200/);
  assert.match(timeModule, /roundedOffset != 10800/);
});

test('FXTF terminal state keys are scoped to broker, full login and symbol', () => {
  assert.match(common, /ACCOUNT_SERVER/);
  assert.match(common, /IntegerToString\(login\)/);
  assert.match(common, /StringSubstr\(sym, 0, 8\)/);
});

test('FXTF profile allows read-only startup when the dynamic JPY tick value is unavailable', () => {
  const payload = read('../mt5/include/GoldV19MT5_Payload.mqh');
  assert.match(common, /tick value unavailable at initialization/);
  assert.doesNotMatch(common, /reason = "tick_value_invalid"/);
  assert.match(payload, /tickValue > 0\.0/);
  assert.match(entry, /SYMBOL_TRADE_TICK_VALUE_PROFIT/);
  assert.match(entry, /SYMBOL_TRADE_TICK_VALUE_LOSS/);
});

test('FXTF real-account forward logger writes one local CSV row per completed M5 bar', () => {
  const payload = read('../mt5/include/GoldV19MT5_Payload.mqh');
  const marketData = read('../mt5/include/GoldV19MT5_MarketData.mqh');
  assert.match(entry, /input bool\s+EnableLocalForwardLogging\s*=\s*true;/);
  assert.match(entry, /LoadForwardLogState\(\);/);
  assert.match(marketData, /GoldAITrader_FXTF_XAUUSD_M5_Forward\.csv/);
  assert.match(marketData, /FILE_READ\|FILE_WRITE\|FILE_CSV\|FILE_ANSI\|FILE_SHARE_READ/);
  assert.match(marketData, /GlobalVariableSet\(ScopedGlobalKey\("FWDLOG", "LAST_M5_BAR"\)/);
  assert.match(flow, /UpdateMarketSafety\(sym\);[\s\S]*LogForwardM5Snapshot\(sym\);[\s\S]*if\(!NetworkAllowedForCurrentAccount\(\)\)/);
  assert.match(marketData, /market_safety_reason/);
  assert.match(marketData, /indicators_ready/);
  assert.match(marketData, /FileFlush\(file\)/);
  assert.doesNotMatch(payload, /FileOpen\(/);
});
