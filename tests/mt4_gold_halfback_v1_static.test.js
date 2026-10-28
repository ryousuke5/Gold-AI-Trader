import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const eaPath = fileURLToPath(new URL('../mt4/GoldAITraderHalfbackV1.mq4', import.meta.url));
const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));

test('GOLD halfback V1 MT4 bridge is monitor-only and calls its own endpoint', () => {
  const source = fs.readFileSync(eaPath, 'utf8');
  assert.match(source, /\/api\/gold\/halfback\/signal/);
  assert.match(source, /AllowAutoOrders\s*=\s*false/i);
  assert.doesNotMatch(source, /\bOrderSend\s*\(/);
  assert.doesNotMatch(source, /\bOrderClose\s*\(/);
  assert.match(source, /recent_m5/);
});

test('GOLD halfback V1 API hard-blocks all order execution and persistence', () => {
  const server = fs.readFileSync(serverPath, 'utf8');
  const start = server.indexOf("app.post('/api/gold/halfback/signal'");
  const end = server.indexOf("app.get('/health'", start);
  assert.ok(start >= 0 && end > start, 'halfback V1 endpoint must be a distinct route');
  const route = server.slice(start, end);
  assert.match(route, /strategy_version:'gold-h1-m5-halfback-v1'/);
  assert.match(route, /order_allowed:false/);
  assert.match(route, /risk_approved:false/);
  assert.match(route, /persisted:false/);
  assert.match(route, /orders_executed:false/);
});
