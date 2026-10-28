// Frozen runtime version: GOLD H1 trend + M5 pullback/reconfirmation V1.
// Kept independent from the legacy research implementation for isolated
// diagnostics, backtests, and forward validation.
const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function buildGoldH1M5PullbackV1Setup(features = {}, config = {}) {
  const cfg = {
    minH1RsiBuy: Math.max(1, num(config.minH1RsiBuy, 50)),
    maxH1RsiBuy: Math.min(99, num(config.maxH1RsiBuy, 72)),
    minH1RsiSell: Math.max(1, num(config.minH1RsiSell, 28)),
    maxH1RsiSell: Math.min(99, num(config.maxH1RsiSell, 50)),
    buyRsiMin: Math.max(1, num(config.buyRsiMin, 52)),
    buyRsiMax: Math.min(99, num(config.buyRsiMax, 75)),
    sellRsiMin: Math.max(1, num(config.sellRsiMin, 25)),
    sellRsiMax: Math.min(99, num(config.sellRsiMax, 48)),
    pullbackTouchAtr: Math.max(0.01, num(config.pullbackTouchAtr, 0.15)),
    pullbackCloseToleranceAtr: Math.max(0.05, num(config.pullbackCloseToleranceAtr, 0.35)),
    maxExtensionAtr: Math.max(0.1, num(config.maxExtensionAtr, 1.5)),
    stopBufferAtr: Math.max(0, num(config.stopBufferAtr, 0.15)),
    minStopAtr: Math.max(0.1, num(config.minStopAtr, 0.8)),
    maxStopAtr: Math.max(0.2, num(config.maxStopAtr, 2.0)),
    takeProfitR: Math.max(1.0, num(config.takeProfitR, 2.0)),
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionEndUtc, 20)))),
    h1TrendMode: config.h1TrendMode === 'close_ema20_rsi' ? 'close_ema20_rsi' : 'strict'
  };

  const m5 = features.m5 || {};
  const h1 = features.h1 || {};
  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signal = bars.at(-1);
  const pullback = bars.at(-2);

  const required = [
    h1.close, h1.ema20, h1.ema50, h1.ema200, h1.rsi14, h1.atr14,
    m5.ema20, m5.rsi14, m5.atr14,
    signal?.time, signal?.open, signal?.high, signal?.low, signal?.close,
    pullback?.time, pullback?.high, pullback?.low, pullback?.close, pullback?.ema20, pullback?.atr14
  ];
  if (!signal || !pullback || !required.every(Number.isFinite) ||
      !(m5.atr14 > 0) || !(pullback.atr14 > 0) || !(h1.atr14 > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }
  if (Number.isFinite(Number(features.barTime)) && Number(features.barTime) > 0 && signal.time !== Number(features.barTime)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'm5_bar_time_mismatch' };
  }
  if (!(Number(m5.ema20) > 0) || !(Number(signal.ema20) > 0) || !(Number(pullback.ema20) > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }
  if (signal.time - pullback.time !== 300) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'noncontiguous_confirmation_bars' };
  }

  const hour = new Date(signal.time * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };

  const trendUp = h1.close > h1.ema20 &&
    (cfg.h1TrendMode === 'close_ema20_rsi' || (h1.ema20 > h1.ema50 && h1.ema50 > h1.ema200)) &&
    h1.rsi14 >= cfg.minH1RsiBuy && h1.rsi14 <= cfg.maxH1RsiBuy;
  const trendDown = h1.close < h1.ema20 &&
    (cfg.h1TrendMode === 'close_ema20_rsi' || (h1.ema20 < h1.ema50 && h1.ema50 < h1.ema200)) &&
    h1.rsi14 >= cfg.minH1RsiSell && h1.rsi14 <= cfg.maxH1RsiSell;
  if (!trendUp && !trendDown) return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_trend_filter' };

  // Pattern definition:
  // 1) the prior completed M5 candle traded through the EMA20 touch band;
  // 2) its close stayed within a bounded distance of EMA20;
  // 3) the current completed candle closes in the trend direction beyond the
  //    prior candle's extreme, confirming continuation before next-bar entry.
  const touch = cfg.pullbackTouchAtr * pullback.atr14;
  const closeTolerance = cfg.pullbackCloseToleranceAtr * pullback.atr14;
  const touchedEma20 = pullback.low <= pullback.ema20 + touch &&
    pullback.high >= pullback.ema20 - touch;
  if (!touchedEma20) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'pullback_ema20_not_touched' };
  }
  if (trendUp && pullback.close < pullback.ema20 - closeTolerance) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'pullback_close_too_weak' };
  }
  if (trendDown && pullback.close > pullback.ema20 + closeTolerance) {
    return { candidate: 'WAIT', trend: 'DOWN', reason: 'pullback_close_too_weak' };
  }

  const candleRange = signal.high - signal.low;
  const body = Math.abs(signal.close - signal.open);
  if (!(candleRange > 0)) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'invalid_confirmation_candle' };
  }
  const atr = m5.atr14;
  const closeLocation = (signal.close - signal.low) / candleRange;
  const extension = trendUp ? (signal.close - m5.ema20) / atr : (m5.ema20 - signal.close) / atr;
  if (trendUp) {
    if (!(signal.close > signal.open && signal.close > pullback.high && signal.close > m5.ema20)) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'bullish_reconfirmation_failed' };
    }
    if (m5.rsi14 < cfg.buyRsiMin || m5.rsi14 > cfg.buyRsiMax) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'm5_rsi_filter' };
    }
    if (closeLocation < 0.60) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'confirmation_close_location_filter' };
    }
  } else {
    if (!(signal.close < signal.open && signal.close < pullback.low && signal.close < m5.ema20)) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'bearish_reconfirmation_failed' };
    }
    if (m5.rsi14 < cfg.sellRsiMin || m5.rsi14 > cfg.sellRsiMax) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'm5_rsi_filter' };
    }
    if (closeLocation > 0.40) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'confirmation_close_location_filter' };
    }
  }
  if (extension > cfg.maxExtensionAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'extension_filter' };
  }

  const side = trendUp ? 'BUY' : 'SELL';
  const swingBars = bars.slice(-4); // current confirmation + pullback + two prior bars
  if (swingBars.length < 4 || swingBars.some((bar) => ![bar.high, bar.low].every(Number.isFinite))) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'insufficient_swing_history' };
  }
  const swingLow = Math.min(...swingBars.map((bar) => bar.low));
  const swingHigh = Math.max(...swingBars.map((bar) => bar.high));
  const entryReference = signal.close;
  const stop = side === 'BUY'
    ? swingLow - cfg.stopBufferAtr * atr
    : swingHigh + cfg.stopBufferAtr * atr;
  const stopDistance = Math.abs(entryReference - stop);
  const stopAtr = stopDistance / atr;
  const diagnostics = {
    pullback_ema20: pullback.ema20,
    pullback_atr: pullback.atr14,
    pullback_touch_atr_tolerance: cfg.pullbackTouchAtr,
    confirmation_body_atr: body / atr,
    confirmation_close_location: closeLocation,
    extension_atr: extension,
    swing_low: swingLow,
    swing_high: swingHigh,
    stop_atr: stopAtr,
    entry_reference: entryReference
  };
  if (stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'stop_distance_filter', diagnostics };
  }

  const target = side === 'BUY'
    ? entryReference + cfg.takeProfitR * stopDistance
    : entryReference - cfg.takeProfitR * stopDistance;
  return {
    candidate: side,
    trend: side === 'BUY' ? 'UP' : 'DOWN',
    setup_type: 'H1_TREND_M5_PULLBACK_RECONFIRM',
    entry_reference: entryReference,
    stop_loss: stop,
    take_profit: target,
    risk_reward: cfg.takeProfitR,
    diagnostics,
    reason: 'trend_pullback_reconfirmed'
  };
}
