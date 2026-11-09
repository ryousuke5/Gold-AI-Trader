import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf("app.post('/api/gold/trade-result'");
const end = source.indexOf("app.post('/api/gold/execution-result'", start);
const route = start >= 0 && end > start ? source.slice(start, end) : '';

test('allows ticketless results only when the request explicitly identifies a Paper mode', () => {
  assert.ok(route.length > 0, 'trade-result route must exist');
  assert.match(route, /const paperMode=\['PAPER','FORWARD_PAPER','ANALYSIS_PAPER'\]\.includes\(tradeMode\)/);
  assert.match(route, /\(!body\.mt4_ticket&&!paperMode\)/);
  assert.match(route, /mt4_ticket:Number\(body\.mt4_ticket\|\|0\)\|\|null/);
  assert.match(route, /mode:tradeMode/);
});

test('retains idempotency, symbol and result validation for Paper and non-Paper results', () => {
  assert.match(route, /!body\.idempotency_key/);
  assert.match(route, /!body\.symbol/);
  assert.match(route, /!body\.result/);
  assert.match(route, /\['WIN','LOSS','BREAKEVEN'\]/);
});
