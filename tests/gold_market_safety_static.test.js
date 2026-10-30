import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../mt4/GoldAITraderV19.mq4', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');

test('Gold V19 keeps the existing spread cap and adds a 30-minute reopen lock', () => {
  assert.match(ea, /MaxSpreadPrice\s*=\s*0\.50/);
  assert.match(ea, /MarketReopenGapSeconds\s*=\s*7200/);
  assert.match(ea, /MarketReopenLockMinutes\s*=\s*30/);
});

test('Gold V19 evaluates persistent tick state on every timer tick', () => {
  assert.match(ea, /void UpdateMarketSafety\(string sym\)/);
  assert.match(ea, /UpdateMarketSafety\(sym\);/);
  assert.match(ea, /MaxTickJumpPrice\s*=\s*1\.50/);
  assert.match(ea, /TickRecoverySamples\s*=\s*3/);
  assert.match(ea, /MaxQuoteAgeSeconds\s*=\s*30/);
  assert.match(ea, /GlobalVariableSet\(MarketSafetyKey\("LAST_TICK_UTC"\)/);
});

test('Gold V19 transmits a quote snapshot for independent API validation', () => {
  assert.match(ea, /market_safety/);
  assert.match(ea, /quote_time_utc/);
  assert.match(ea, /mid_price/);
  assert.match(ea, /anomaly_active/);
  assert.match(ea, /reopen_lock_until_utc/);
});

test('API blocks AI evaluation and order approval when market safety fails', () => {
  assert.match(server, /evaluateGoldMarketSafety\(body\.market_safety/);
  assert.match(server, /if\(!marketSafety\.allowed\)/);
  assert.match(server, /risk\.approved=false/);
  assert.match(server, /market_safety:marketSafety/);
});

test('Gold V19 remains a monitor-only bridge without MT4 order functions', () => {
  assert.doesNotMatch(ea, /\bOrderSend\s*\(/);
  assert.doesNotMatch(ea, /\bOrderClose\s*\(/);
  assert.doesNotMatch(ea, /\bOrderModify\s*\(/);
});
