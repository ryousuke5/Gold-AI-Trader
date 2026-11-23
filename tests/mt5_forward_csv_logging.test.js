import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const entry = read('../mt5/GoldAITraderV19_MT5_Research.mq5');
const marketData = read('../mt5/include/GoldV19MT5_MarketData.mqh');
const flow = read('../mt5/include/GoldV19MT5_Flow.mqh');

const loggerStart = marketData.indexOf('bool LogForwardM5Snapshot(string sym)');
const loggerEnd = marketData.indexOf('double DailyRealizedPnl(string sym)', loggerStart);
assert.ok(loggerStart >= 0 && loggerEnd > loggerStart, 'forward logger function boundaries must exist');
const logger = marketData.slice(loggerStart, loggerEnd);

test('local forward CSV capture is enabled by default and restores duplicate state on startup', () => {
  assert.match(entry, /input bool\\s+EnableLocalForwardLogging\\s*=\\s*true;/);
  assert.match(entry, /LoadForwardLogState\\(\\);/);
  assert.match(entry, /EnableSignalRequests\\s*=\\s*false;/);
  assert.match(entry, /EnableSafetyHeartbeat\\s*=\\s*false;/);
  assert.match(marketData, /void LoadForwardLogState\\(\\)/);
  assert.match(logger, /GlobalVariableCheck\\(stateKey\\)/);
  assert.match(logger, /closedM5Bar\\s*<=\\s*g_lastForwardLoggedBar/);
});

test('forward CSV contains the completed M5 bar, live quote, cost and indicator fields', () => {
  for (const field of [
    'record_time_utc_epoch', 'broker_server', 'account_currency', 'symbol',
    'bar_open_utc_epoch', 'bar_open', 'bar_high', 'bar_low', 'bar_close',
    'bid', 'ask', 'spread_price', 'spread_points',
    'quote_time_utc_epoch', 'quote_age_seconds',
    'market_safety_allowed', 'market_safety_reason', 'tick_anomaly_active',
    'm5_ema20', 'm5_ema50', 'm5_rsi14', 'm5_atr14',
    'h1_ema20', 'h1_ema50', 'h1_ema200', 'h1_rsi14', 'h1_atr14',
    'tick_value_account_currency', 'indicators_ready'
  ]) {
    assert.ok(logger.includes('"' + field + '"'), 'missing CSV column: ' + field);
  }
  assert.match(logger, /GoldAITraderV19_M5_Forward\\.csv/);
  assert.match(logger, /FileOpen\\(fileName,[\\s\\S]*FILE_READ\\|FILE_WRITE\\|FILE_CSV\\|FILE_ANSI\\|FILE_SHARE_READ/);
  assert.match(logger, /FileSeek\\(file, 0, SEEK_END\\)/);
  assert.match(logger, /FileFlush\\(file\\)/);
});

test('CSV capture runs after market safety and before optional API requests', () => {
  const safetyIndex = flow.indexOf('UpdateMarketSafety(sym);');
  const loggerIndex = flow.indexOf('LogForwardM5Snapshot(sym);');
  const heartbeatIndex = flow.indexOf('if(g_apiConfigReady &&');
  const signalIndex = flow.indexOf('if(!EnableSignalRequests)');
  assert.ok(safetyIndex >= 0);
  assert.ok(loggerIndex > safetyIndex);
  assert.ok(heartbeatIndex > loggerIndex);
  assert.ok(signalIndex > heartbeatIndex);
});

test('CSV logger itself is local-only and has no trading or HTTP execution calls', () => {
  assert.doesNotMatch(logger, /\\bWebRequest\\s*\\(/);
  assert.doesNotMatch(logger, /\\bCTrade\\b/);
  assert.doesNotMatch(logger, /\\bOrderSend\\s*\\(/);
  assert.doesNotMatch(logger, /\\bPositionOpen\\s*\\(/);
  assert.doesNotMatch(logger, /\\bPositionClose\\s*\\(/);
  assert.doesNotMatch(logger, /\\.Buy\\s*\\(/);
  assert.doesNotMatch(logger, /\\.Sell\\s*\\(/);
});
