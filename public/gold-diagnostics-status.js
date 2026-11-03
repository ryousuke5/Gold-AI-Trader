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
