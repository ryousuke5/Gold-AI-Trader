// Research-only, BUY-only H1 trend + M5 EMA20 pullback + local-high breakout.
// Evaluates only completed bars. Entry execution remains in the shared backtester.
const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function contiguous(bars, start, end) {
  for (let i = start + 1; i <= end; i++) {
    if (num(bars[i - 1]?.time, NaN) <= 0 ||
        num(bars[i]?.time, NaN) - num(bars[i - 1]?.time, NaN) !== 300) {
      return false;
    }
  }
  return true;
}

export const GOLD_M5_EMA20_PULLBACK_BREAKOUT_V1 = Object.freeze({
  pullbackLookbackBars: 5,
  breakoutLookbackBars: 3,
  ema20SlopeLookbackBars: 3,
  touchToleranceAtr: 0.10,
  maxLowBelowEmaAtr: 0.50,
  maxCloseBelowEmaAtr: 0.25,
  minSignalBodyAtr: 0.20,
  minSignalCloseLocation: 0.65,
  maxExtensionAtr: 1.00,
  stopBufferAtr: 0.15,
  minStopAtr: 0.40,
  maxStopAtr: 2.00,
  takeProfitR: 2.00,
  sessionStartUtc: 7,
  sessionEndUtc: 20
});

export function buildGoldM5Ema20PullbackBreakoutV1Setup(features = {}, config = {}) {
  const cfg = {
    ...GOLD_M5_EMA20_PULLBACK_BREAKOUT_V1,
    ...config
  };

  const m5 = features.m5 || {};
  const h1 = features.h1 || {};
  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signalIndex = bars.length - 1;
  const signal = bars[signalIndex];

  const required = [
    h1.close, h1.ema20, h1.ema50, h1.ema200,
    m5.ema20, m5.atr14,
    signal?.time, signal?.open, signal?.high, signal?.low, signal?.close,
    signal?.ema20, signal?.atr14
  ];

  if (!signal || !required.every((value) => Number.isFinite(Number(value))) ||
      !(Number(m5.atr14) > 0) || !(Number(signal.atr14) > 0) ||
      !(Number(signal.ema20) > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }

  if (Number(signal.time) - Number(bars[signalIndex - 1]?.time) !== 300) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'noncontiguous_confirmation_bars' };
  }
  if (Number.isFinite(Number(features.barTime)) &&
      Number(features.barTime) > 0 && Number(signal.time) !== Number(features.barTime)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'm5_bar_time_mismatch' };
  }

  const minimumHistory = Math.max(
    cfg.pullbackLookbackBars,
    cfg.breakoutLookbackBars,
    cfg.ema20SlopeLookbackBars
  ) + 1;
  if (bars.length < minimumHistory + 1) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'insufficient_m5_history' };
  }

  const hourUtc = new Date(Number(signal.time) * 1000).getUTCHours();
  if (hourUtc < cfg.sessionStartUtc || hourUtc > cfg.sessionEndUtc) {
    return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };
  }

  // Strict H1 uptrend: latest completed H1 close > EMA20 > EMA50 > EMA200.
  const trendUp = Number(h1.close) > Number(h1.ema20) &&
    Number(h1.ema20) > Number(h1.ema50) &&
    Number(h1.ema50) > Number(h1.ema200);
  if (!trendUp) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_uptrend_filter' };
  }

  const slopeIndex = signalIndex - cfg.ema20SlopeLookbackBars;
  if (slopeIndex < 0 || !Number.isFinite(Number(bars[slopeIndex]?.ema20)) ||
      !(Number(signal.ema20) > Number(bars[slopeIndex].ema20))) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'm5_ema20_not_rising' };
  }

  // Find the most recent completed M5 candle that touched the EMA20 zone.
  // The low may pierce EMA20 by at most 0.50 ATR; close may finish no more
  // than 0.25 ATR below EMA20. This prevents treating a failed breakdown
  // as a healthy pullback.
  let pullbackIndex = -1;
  let pullbackTouchDepthAtr = null;
  const firstTouchIndex = Math.max(0, signalIndex - cfg.pullbackLookbackBars);

  for (let i = signalIndex - 1; i >= firstTouchIndex; i--) {
    const bar = bars[i];
    const atr = num(bar?.atr14, 0);
    const ema20 = num(bar?.ema20, 0);
    const low = num(bar?.low, NaN);
    const close = num(bar?.close, NaN);
    if (!(atr > 0 && ema20 > 0) ||
        ![low, close].every(Number.isFinite)) continue;

    const touchDepthAtr = (ema20 - low) / atr;
    const closeBelowEmaAtr = (ema20 - close) / atr;
    const touched = touchDepthAtr >= -cfg.touchToleranceAtr &&
      touchDepthAtr <= cfg.maxLowBelowEmaAtr;
    const held = closeBelowEmaAtr <= cfg.maxCloseBelowEmaAtr;

    if (touched && held) {
      pullbackIndex = i;
      pullbackTouchDepthAtr = touchDepthAtr;
      break;
    }
  }

  if (pullbackIndex < 0) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'ema20_pullback_not_found' };
  }

  if (!contiguous(bars, pullbackIndex, signalIndex)) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'noncontiguous_pullback_sequence' };
  }

  // After the touch, price must not close materially below EMA20 before the
  // breakout candle. All values come from candles already closed at signal time.
  for (let i = pullbackIndex + 1; i < signalIndex; i++) {
    const bar = bars[i];
    const atr = num(bar?.atr14, 0);
    const ema20 = num(bar?.ema20, 0);
    if (!(atr > 0 && ema20 > 0) ||
        (ema20 - Number(bar.close)) / atr > cfg.maxCloseBelowEmaAtr) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'pullback_structure_invalidated' };
    }
  }

  const breakoutStart = signalIndex - cfg.breakoutLookbackBars;
  if (breakoutStart < 0 || !contiguous(bars, breakoutStart, signalIndex)) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'noncontiguous_breakout_window' };
  }
  const breakoutLevel = Math.max(
    ...bars.slice(breakoutStart, signalIndex).map((bar) => Number(bar.high))
  );

  const atr = Number(signal.atr14);
  const candleRange = Number(signal.high) - Number(signal.low);
  const body = Number(signal.close) - Number(signal.open);
  const closeLocation = candleRange > 0
    ? (Number(signal.close) - Number(signal.low)) / candleRange
    : -Infinity;
  const breakoutDistance = Number(signal.close) - breakoutLevel;
  const extensionAtr = (Number(signal.close) - Number(signal.ema20)) / atr;

  const diagnostics = {
    h1_close: Number(h1.close),
    h1_ema20: Number(h1.ema20),
    h1_ema50: Number(h1.ema50),
    h1_ema200: Number(h1.ema200),
    m5_ema20: Number(signal.ema20),
    m5_ema20_slope_lookback_bars: cfg.ema20SlopeLookbackBars,
    m5_ema20_slope: Number(signal.ema20) - Number(bars[slopeIndex].ema20),
    pullback_age_bars: signalIndex - pullbackIndex,
    pullback_touch_depth_atr: pullbackTouchDepthAtr,
    breakout_lookback_bars: cfg.breakoutLookbackBars,
    breakout_level: breakoutLevel,
    breakout_distance: breakoutDistance,
    breakout_distance_atr: breakoutDistance / atr,
    signal_body_atr: body / atr,
    signal_close_location: closeLocation,
    extension_from_ema20_atr: extensionAtr,
    m5_atr: atr
  };

  if (!(Number(signal.close) > Number(signal.open)) ||
      !(body / atr >= cfg.minSignalBodyAtr) ||
      !(closeLocation >= cfg.minSignalCloseLocation)) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'bullish_signal_candle_filter', diagnostics };
  }
  if (!(Number(signal.close) > breakoutLevel)) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'recent_high_breakout_not_confirmed', diagnostics };
  }
  if (!(Number(signal.close) > Number(signal.ema20)) ||
      extensionAtr > cfg.maxExtensionAtr) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'ema20_extension_filter', diagnostics };
  }

  const pullbackBars = bars.slice(pullbackIndex, signalIndex + 1);
  const pullbackLow = Math.min(...pullbackBars.map((bar) => Number(bar.low)));
  const entryReference = Number(signal.close);
  const stop = pullbackLow - cfg.stopBufferAtr * atr;
  const stopDistance = entryReference - stop;
  const stopAtr = stopDistance / atr;

  diagnostics.pullback_low = pullbackLow;
  diagnostics.stop_atr = stopAtr;
  diagnostics.entry_reference = entryReference;

  if (!(stop > 0 && stopDistance > 0) ||
      stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'stop_distance_filter', diagnostics };
  }

  return {
    candidate: 'BUY',
    trend: 'UP',
    setup_type: 'H1_TREND_M5_EMA20_PULLBACK_BREAKOUT_V1',
    entry_reference: entryReference,
    stop_loss: stop,
    take_profit: entryReference + cfg.takeProfitR * stopDistance,
    risk_reward: cfg.takeProfitR,
    diagnostics,
    reason: 'ema20_pullback_breakout_confirmed'
  };
}
