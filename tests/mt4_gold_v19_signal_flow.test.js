import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../mt4/GoldAITraderV19.mq4', import.meta.url), 'utf8');
const timer = source.split('void OnTimer()')[1]?.split('// EA lifecycle')[0] || '';

test('V19 safety heartbeat reports signal request switches and the latest M5 flow', () => {
  assert.match(source, /\\"enable_signal_requests\\":.*EnableSignalRequests/);
  assert.match(source, /\\"run_ai_test_once\\":.*RunAITestOnce/);
  assert.match(source, /\\"allow_auto_orders\\":.*AllowAutoOrders/);
  assert.match(source, /\\"flow_status\\":.*g_signalFlowStatus/);
  assert.match(source, /\\"flow_reason\\":.*g_signalFlowReason/);
  assert.match(source, /current_closed_m5_bar_open_utc/);
  assert.match(source, /last_handled_m5_bar_open_utc/);
  assert.match(source, /last_attempt_at_utc/);
});

test('V19 skips the already-closed startup M5 bar before the first signal POST', () => {
  const startupGuard = timer.split('if(g_lastClosedM5Bar <= 0)')[1]?.split('if(closedBar == g_lastClosedM5Bar)')[0] || '';
  assert.ok(startupGuard.length > 0, 'startup freshness guard must exist before the handled-bar check');
  assert.match(startupGuard, /g_lastClosedM5Bar = closedBar;/);
  assert.match(startupGuard, /startup_current_completed_M5_bar_skipped/);
  assert.match(startupGuard, /return;/);
  assert.ok(timer.indexOf('if(g_lastClosedM5Bar <= 0)') < timer.indexOf('if(closedBar == g_lastClosedM5Bar)'));
});

test('V19 exposes disabled, AI-test-only, safety-blocked and POST outcomes without changing the order gate', () => {
  assert.match(timer, /g_signalFlowStatus = "DISABLED"/);
  assert.match(timer, /g_signalFlowStatus = "AI_TEST_ONLY"/);
  assert.match(timer, /g_signalFlowStatus = "SAFETY_BLOCKED"/);
  assert.match(timer, /g_signalFlowStatus = "SIGNAL_POST_ACCEPTED"/);
  assert.match(timer, /g_signalFlowStatus = "SIGNAL_POST_FAILED"/);
  const handledBarGuard = timer.split('if(closedBar == g_lastClosedM5Bar)')[1] || '';
  assert.match(handledBarGuard, /g_signalFlowStatus != "SAFETY_BLOCKED"/);
  assert.match(handledBarGuard, /g_signalFlowStatus != "SIGNAL_POST_REJECTED_STALE_BAR"/);
  assert.match(source, /input bool\s+AllowAutoOrders = false;/);
  assert.doesNotMatch(source, /OrderSend\s*\(/);
});
