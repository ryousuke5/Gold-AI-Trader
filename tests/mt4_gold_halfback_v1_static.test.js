import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const eaPath = fileURLToPath(new URL('../mt4/GoldAITraderHalfbackV1.mq4', import.meta.url));

test('GOLD halfback V1 MT4 bridge is monitor-only and calls its own endpoint', () => {
  const source = fs.readFileSync(eaPath, 'utf8');
  assert.match(source, /\/api\/gold\/halfback\/signal/);
  assert.match(source, /AllowAutoOrders\s*=\s*false/i);
  assert.doesNotMatch(source, /\bOrderSend\s*\(/);
  assert.doesNotMatch(source, /\bOrderClose\s*\(/);
  assert.match(source, /recent_m5/);
});
