import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(
  new URL('../mt4/EURUSDAIMonitorV13.mq4', import.meta.url),
  'utf8'
);
const sendCurrentBar = source.slice(source.indexOf('bool SendCurrentBar('));

test('EURUSD monitor records a candle after success, including duplicate_bar', () => {
  assert.match(source, /datetime g_lastProcessedM15Open = 0;/);
  assert.match(
    sendCurrentBar,
    /if\s*\(\s*currentClosedBarOpen\s*==\s*g_lastProcessedM15Open\s*\)\s*return false;/
  );

  const successBlock = sendCurrentBar.match(/if\s*\(ok\)\s*\{([\s\S]*?)\n   \}/);
  assert.ok(successBlock, 'success block must exist');
  assert.match(successBlock[1], /g_lastProcessedM15Open\s*=\s*closedBarOpen;/);
  assert.ok(
    source.includes('StringFind(response, "\\\"error\\\":\\\"duplicate_bar\\\"")'),
    'duplicate_bar must remain treated as idempotent success'
  );
});

test('failed requests remain retryable and retain the configured retry deadline', () => {
  assert.match(source, /currentClosedBarOpen \+ 900 \+ MaxRetryMinutes \* 60/);
  assert.match(source, /g_lastAttemptAt = TimeCurrent\(\);/);

  const failureIndex = sendCurrentBar.indexOf('EURUSD M15 signal request failed');
  assert.ok(failureIndex >= 0, 'failure log must exist');
  assert.doesNotMatch(
    sendCurrentBar.slice(failureIndex),
    /g_lastProcessedM15Open\s*=/
  );
});

test('EURUSD monitor remains order-execution-free', () => {
  assert.match(source, /order_execution=false/);
  for (const token of ['OrderSend(', 'OrderClose(', 'OrderModify(', 'OrderDelete(', 'OrderCloseBy(']) {
    assert.equal(source.includes(token), false, `forbidden execution token found: ${token}`);
  }
});
