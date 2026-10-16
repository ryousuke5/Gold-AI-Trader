import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../mt4/GoldAITraderV18.mq4', import.meta.url), 'utf8');

test('MT4 GOLD bridge uses completed M5 close time consistently', () => {
  assert.match(source, /datetime\s+closedBarTime\s*=\s*closedBarOpen\s*\+\s*300;/);
  assert.match(source, /bar_time.*closedBarTimeUtc/);
  assert.ok(source.includes('bool GetServerUtcOffsetSeconds(int &offsetSeconds)'));
  assert.ok(source.includes('[GOLD UTC DIAG]'));
  assert.ok(source.includes('barOpenM5 + 300 - serverUtcOffsetSeconds'));
  assert.ok(source.includes('barOpenH1 + 3600 - serverUtcOffsetSeconds'));
  assert.match(source, /barOpenM5\s*\+\s*300/);
  assert.doesNotMatch(source, /closedBarTime + 300/);
});

test('MT4 GOLD bridge sends required completed history and remains non-executing', () => {
  assert.match(source, /for\(int shiftM5 = 24; shiftM5 >= 1; shiftM5--\)/);
  assert.match(source, /for\(int shiftH1 = 24; shiftH1 >= 1; shiftH1--\)/);
  assert.match(source, /iClose\(sym, PERIOD_H1, 1\)/);
  assert.match(source, /input bool\s+AllowAutoOrders = false;/);
  assert.doesNotMatch(source, /OrderSend\s*\(/);
});


test('MT4 GOLD bridge treats stale-bar rejection as terminal for that candle only', () => {
  assert.ok(source.includes('bool IsStaleBarTimeRejection(string response)'));
  const onTimer = source.split('void OnTimer()')[1]?.split('// EA lifecycle')[0] || '';
  assert.ok(onTimer.includes('else if(IsStaleBarTimeRejection(response))'));
  const staleBranch = onTimer.split('else if(IsStaleBarTimeRejection(response))')[1] || '';
  assert.ok(staleBranch.includes('g_lastClosedM5Bar = closedBar;'));
  assert.ok(source.includes('g_retrySeconds = 30;'));
  assert.ok(!source.includes('OrderSend('));
});

test('MT4 GOLD bridge converts MODE_TICKSIZE points into quote-price units', () => {
  assert.match(source, /double tickSizePoints\s*=\s*MarketInfo\(sym, MODE_TICKSIZE\);/);
  assert.match(source, /double tickSize\s*=\s*tickSizePoints\s*\*\s*point;/);
  assert.match(source, /tick_size_points\\":.*JsonNumber\(tickSizePoints/);
  assert.match(source, /tick_size\\":.*JsonNumber\(tickSize, digits\)/);
  assert.ok(source.includes('tickSizePrice='));
  assert.ok(source.includes('tickSizePoints='));
});
