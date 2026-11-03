import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLD_COMMUNICATION_OK_SECONDS,
  GOLD_COMMUNICATION_WARN_SECONDS,
  getGoldDiagnosticsDisplayState,
  getGoldSafetyHeartbeatDisplayState,
  getGoldSignalFlowDisplayState
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


test('signal API and V19 safety heartbeat have independent display states', () => {
  assert.deepEqual(getGoldSafetyHeartbeatDisplayState({ status: 'ALLOWED' }), {
    state: 'good',
    label: '正常'
  });
  assert.deepEqual(getGoldSafetyHeartbeatDisplayState({ status: 'BLOCKED' }), {
    state: 'warn',
    label: '安全ゲート停止'
  });
  assert.deepEqual(getGoldSafetyHeartbeatDisplayState({ status: 'STALE' }), {
    state: 'warn',
    label: 'ハートビート途絶'
  });
  assert.deepEqual(getGoldSafetyHeartbeatDisplayState({ status: 'NO_REPORT' }), {
    state: 'muted',
    label: '未受信'
  });
  assert.deepEqual(getGoldSafetyHeartbeatDisplayState({ status: 'API_CHECK_FAILED' }), {
    state: 'bad',
    label: 'API再確認NG'
  });
});

test('missing signal request is neutral rather than a communication failure', () => {
  const status = getGoldDiagnosticsDisplayState();
  assert.equal(status.communicationLabel, '未受信');
  assert.equal(status.communicationState, 'muted');
  assert.equal(status.communicationChipState, 'muted');
});


test('V19 runtime flags identify disabled signal and one-shot AI test modes', () => {
  const disabled = getGoldSignalFlowDisplayState({
    enable_signal_requests: false,
    run_ai_test_once: false,
    flow_status: 'DISABLED'
  });
  assert.equal(disabled.label, 'シグナル送信OFF');
  assert.equal(disabled.state, 'bad');

  const testOnly = getGoldSignalFlowDisplayState({
    enable_signal_requests: true,
    run_ai_test_once: true,
    flow_status: 'AI_TEST_ALREADY_DONE'
  });
  assert.equal(testOnly.label, 'AIテスト専用');
  assert.equal(testOnly.state, 'warn');
});

test('V19 enabled signal flow explains successful, waiting, and failed API paths', () => {
  assert.equal(getGoldSignalFlowDisplayState({
    enable_signal_requests: true,
    run_ai_test_once: false,
    flow_status: 'SIGNAL_POST_ACCEPTED'
  }).label, 'シグナルAPI受信済み');

  assert.equal(getGoldSignalFlowDisplayState({
    enable_signal_requests: true,
    run_ai_test_once: false,
    flow_status: 'WAITING_FOR_NEW_M5_BAR'
  }).label, '次のM5確定待ち');

  assert.equal(getGoldSignalFlowDisplayState({
    enable_signal_requests: true,
    run_ai_test_once: false,
    flow_status: 'SIGNAL_POST_FAILED'
  }).label, 'シグナルAPI送信失敗');
});

test('legacy heartbeat without EA runtime remains clearly unreported', () => {
  const status = getGoldSignalFlowDisplayState(null);
  assert.equal(status.label, 'V19送信設定未報告');
  assert.equal(status.state, 'muted');
});
