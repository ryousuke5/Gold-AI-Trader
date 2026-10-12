import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLD_COMMUNICATION_OK_SECONDS,
  GOLD_COMMUNICATION_WARN_SECONDS,
  getGoldDiagnosticsDisplayState
} from '../public/gold-diagnostics-status.js';

test('a normal M5 request interval is not shown as communication delay', () => {
  const status = getGoldDiagnosticsDisplayState({
    requestAgeSeconds: 112,
    barAgeSeconds: 115,
    timestampValidAtReceipt: true,
    timestampReasonAtReceipt: null
  });

  assert.equal(GOLD_COMMUNICATION_OK_SECONDS, 360);
  assert.equal(GOLD_COMMUNICATION_WARN_SECONDS, 600);
  assert.equal(status.communicationState, 'good');
  assert.equal(status.communicationLabel, '正常');
  assert.equal(status.currentBarState, 'good');
  assert.equal(status.receiptTimeState, 'good');
  assert.equal(status.receiptTimeLabel, '通過');
});

test('the current completed-bar age is informational within a normal M5 interval', () => {
  const status = getGoldDiagnosticsDisplayState({
    requestAgeSeconds: 299,
    barAgeSeconds: 299,
    timestampValidAtReceipt: true
  });

  assert.equal(status.communicationState, 'good');
  assert.equal(status.currentBarState, 'good');
  assert.equal(status.receiptTimeState, 'good');
});

test('communication becomes delayed after six minutes and stale after ten minutes', () => {
  const delayed = getGoldDiagnosticsDisplayState({ requestAgeSeconds: 420, barAgeSeconds: 420 });
  const stale = getGoldDiagnosticsDisplayState({ requestAgeSeconds: 601, barAgeSeconds: 601 });

  assert.equal(delayed.communicationState, 'warn');
  assert.equal(delayed.communicationLabel, '受信間隔超過');
  assert.equal(delayed.currentBarState, 'warn');
  assert.equal(stale.communicationState, 'bad');
  assert.equal(stale.communicationLabel, '長時間更新なし');
  assert.equal(stale.currentBarState, 'bad');
});

test('a timestamp rejected at receipt remains a visible error even while recent', () => {
  const status = getGoldDiagnosticsDisplayState({
    requestAgeSeconds: 5,
    barAgeSeconds: 5,
    timestampValidAtReceipt: false,
    timestampReasonAtReceipt: 'bar_time_too_old'
  });

  assert.equal(status.communicationState, 'good');
  assert.equal(status.currentBarState, 'good');
  assert.equal(status.receiptTimeState, 'bad');
  assert.equal(status.receiptTimeLabel, 'bar_time_too_old');
});

test('missing request and bar data are reported as unconfirmed', () => {
  const status = getGoldDiagnosticsDisplayState();
  assert.equal(status.communicationState, 'muted');
  assert.equal(status.communicationLabel, '未受信');
  assert.equal(status.currentBarState, 'muted');
  assert.equal(status.receiptTimeState, 'muted');
});
