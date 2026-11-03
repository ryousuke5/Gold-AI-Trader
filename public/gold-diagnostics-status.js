/**
 * Display-only GOLD M5 freshness state.
 *
 * The MT4 EA sends once when a new completed M5 candle becomes available,
 * so requests normally arrive about every 300 seconds. The 90-second API
 * timestamp rule is checked at receipt time; the current bar age naturally
 * grows between M5 closes and must not be mistaken for a failed receipt check.
 */
export const GOLD_M5_INTERVAL_SECONDS = 300;
export const GOLD_COMMUNICATION_OK_SECONDS = 360;
export const GOLD_COMMUNICATION_WARN_SECONDS = 600;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function getGoldDiagnosticsDisplayState({
  requestAgeSeconds = null,
  barAgeSeconds = null,
  timestampValidAtReceipt = null,
  timestampReasonAtReceipt = null
} = {}) {
  const requestAge = finiteOrNull(requestAgeSeconds);
  const barAge = finiteOrNull(barAgeSeconds);

  let communicationState = 'muted';
  let communicationLabel = '未受信';
  if (requestAge !== null && requestAge >= 0) {
    if (requestAge <= GOLD_COMMUNICATION_OK_SECONDS) {
      communicationState = 'good';
      communicationLabel = '正常';
    } else if (requestAge <= GOLD_COMMUNICATION_WARN_SECONDS) {
      communicationState = 'warn';
      communicationLabel = '受信間隔超過';
    } else {
      communicationState = 'bad';
      communicationLabel = '長時間更新なし';
    }
  }

  let currentBarState = 'muted';
  if (barAge !== null) {
    if (barAge < -30) {
      currentBarState = 'bad';
    } else if (barAge <= GOLD_COMMUNICATION_OK_SECONDS) {
      currentBarState = 'good';
    } else if (barAge <= GOLD_COMMUNICATION_WARN_SECONDS) {
      currentBarState = 'warn';
    } else {
      currentBarState = 'bad';
    }
  }

  let receiptTimeState = 'muted';
  let receiptTimeLabel = '未確認';
  if (timestampValidAtReceipt === true) {
    receiptTimeState = 'good';
    receiptTimeLabel = '通過';
  } else if (timestampValidAtReceipt === false) {
    receiptTimeState = 'bad';
    receiptTimeLabel = String(timestampReasonAtReceipt || '拒否');
  }

  const communicationChipState = communicationState === 'good'
    ? 'good'
    : communicationState === 'bad'
      ? 'bad'
      : communicationState === 'muted'
        ? 'muted'
        : 'warn';

  return {
    communicationState,
    communicationLabel,
    communicationChipState,
    currentBarState,
    receiptTimeState,
    receiptTimeLabel
  };
}


/**
 * Display-only status for the independent V19 market-safety heartbeat.
 * This is intentionally separate from /api/gold/signal request freshness.
 */
export function getGoldSafetyHeartbeatDisplayState({ status = 'NO_REPORT' } = {}) {
  const normalized = String(status || 'NO_REPORT').toUpperCase();
  const states = {
    ALLOWED: { state: 'good', label: '正常' },
    BLOCKED: { state: 'warn', label: '安全ゲート停止' },
    API_CHECK_FAILED: { state: 'bad', label: 'API再確認NG' },
    STALE: { state: 'warn', label: 'ハートビート途絶' },
    NO_REPORT: { state: 'muted', label: '未受信' }
  };
  return states[normalized] || { state: 'warn', label: '状態不明' };
}


/**
 * Display-only explanation of the signal path reported by the V19 EA.
 * These flags never enable or change order execution.
 */
export function getGoldSignalFlowDisplayState(runtime) {
  if (!runtime || typeof runtime !== 'object') {
    return {
      state: 'muted',
      label: 'V19送信設定未報告',
      detail: 'V19の診断対応ビルドから次のハートビートを受信すると表示されます'
    };
  }

  if (runtime.enable_signal_requests === false) {
    return {
      state: 'bad',
      label: 'シグナル送信OFF',
      detail: 'EnableSignalRequests=false のため /api/gold/signal へ送信しません'
    };
  }

  if (runtime.run_ai_test_once === true) {
    return {
      state: 'warn',
      label: 'AIテスト専用',
      detail: 'RunAITestOnce=true のため /api/gold/ai-test に進み、通常シグナルは停止します'
    };
  }

  const states = {
    SIGNAL_POST_ACCEPTED: { state: 'good', label: 'シグナルAPI受信済み' },
    SIGNAL_POST_PENDING: { state: 'warn', label: 'シグナルAPI送信中' },
    SIGNAL_POST_FAILED: { state: 'bad', label: 'シグナルAPI送信失敗' },
    SIGNAL_POST_REJECTED_STALE_BAR: { state: 'bad', label: '古いM5足として拒否' },
    SAFETY_BLOCKED: { state: 'warn', label: '安全ゲートで送信停止' },
    WAITING_FOR_NEW_M5_BAR: { state: 'muted', label: '次のM5確定待ち' },
    WAITING_FOR_M5_BAR: { state: 'warn', label: '確定M5足を取得できない' },
    RETRY_BACKOFF: { state: 'warn', label: '再試行間隔待ち' },
    PAYLOAD_BUILD_FAILED: { state: 'bad', label: '送信データ生成失敗' },
    API_CONFIG_INVALID: { state: 'bad', label: 'API設定不正' },
    SYMBOL_NOT_READY: { state: 'warn', label: '銘柄・履歴データ未準備' },
    SYMBOL_NOT_GOLD: { state: 'bad', label: 'GOLD銘柄判定NG' },
    AI_TEST_ONLY: { state: 'warn', label: 'AIテスト専用' },
    AI_TEST_ALREADY_DONE: { state: 'warn', label: 'AIテスト完了・通常送信停止' },
    DISABLED: { state: 'bad', label: 'シグナル送信OFF' }
  };
  return states[String(runtime.flow_status || '').toUpperCase()] ||
    { state: 'muted', label: '送信状態確認中' };
}
