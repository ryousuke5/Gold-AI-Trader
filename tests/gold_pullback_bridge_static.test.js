import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../mt4/GoldAITraderPullbackV1.mq4', import.meta.url), 'utf8');

test('Pullback V1 bridge posts only to its dedicated endpoint', () => {
  assert.ok(source.includes('/api/gold/pullback/signal'));
  assert.doesNotMatch(source, /PostJson\("\/api\/gold\/signal"/);
});

test('Pullback V1 sends EMA20 and ATR14 for each completed M5 history bar', () => {
  assert.match(source, /"ema20".*iMA\(sym, PERIOD_M5, 20, 0, MODE_EMA, PRICE_CLOSE, shiftM5\)/);
  assert.match(source, /"atr14".*iATR\(sym, PERIOD_M5, 14, shiftM5\)/);
  assert.match(source, /for\(int shiftM5 = 24; shiftM5 >= 1; shiftM5--\)/);
});

test('Pullback V1 bridge stays monitor-only', () => {
  assert.match(source, /input bool\s+AllowAutoOrders\s*=\s*false;/);
  assert.doesNotMatch(source, /OrderSend\s*\(/);
});
