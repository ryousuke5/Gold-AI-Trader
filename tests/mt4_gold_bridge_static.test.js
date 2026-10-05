import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../mt4/GoldAITraderV18.mq4', import.meta.url), 'utf8');

test('MT4 GOLD bridge uses completed M5 close time consistently', () => {
  assert.match(source, /datetime\s+closedBarTime\s*=\s*closedBarOpen\s*\+\s*300;/);
  assert.ok(source.includes('json += "\\\"bar_time\\\":" + IntegerToString((int)closedBarTime) + ",";'));
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
