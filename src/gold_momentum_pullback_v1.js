// Research-only H1 momentum + M5 EMA20 pullback/re-acceleration setup.
// Fixed hypothesis for evaluation; parameters are not optimized on the consulted OOS.
const n = (value, fallback = 0) => {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
};
const contiguous = (bars, seconds) => {
  for (let i = 1; i < bars.length; i++) {
    if (Number(bars[i].time) - Number(bars[i - 1].time) !== seconds) return false;
  }
  return true;
};

export function buildGoldMomentumPullbackV1Setup(features = {}, config = {}) {
  const cfg = {
    minH1MomentumAtr: Math.max(0.05, n(config.minH1MomentumAtr, 0.35)),
    minH1EmaGapAtr: Math.max(0.01, n(config.minH1EmaGapAtr, 0.15)),
    minH1RsiBuy: Math.max(1, n(config.minH1RsiBuy, 52)),
    maxH1RsiBuy: Math.min(99, n(config.maxH1RsiBuy, 70)),
    minH1RsiSell: Math.max(1, n(config.minH1RsiSell, 30)),
    maxH1RsiSell: Math.min(99, n(config.maxH1RsiSell, 48)),
    pullbackTouchAtr: Math.max(0.01, n(config.pullbackTouchAtr, 0.20)),
    maxEma50PenetrationAtr: Math.max(0.01, n(config.maxEma50PenetrationAtr, 0.15)),
    minM5RsiBuy: Math.max(1, n(config.minM5RsiBuy, 52)),
    maxM5RsiBuy: Math.min(99, n(config.maxM5RsiBuy, 70)),
    minM5RsiSell: Math.max(1, n(config.minM5RsiSell, 30)),
    maxM5RsiSell: Math.min(99, n(config.maxM5RsiSell, 48)),
    minConfirmationBodyAtr: Math.max(0.05, n(config.minConfirmationBodyAtr, 0.30)),
    minCloseLocationBuy: Math.min(0.99, Math.max(0.5, n(config.minCloseLocationBuy, 0.70))),
    maxCloseLocationSell: Math.min(0.5, Math.max(0.01, n(config.maxCloseLocationSell, 0.30))),
    confirmationBreakoutAtr: Math.max(0, n(config.confirmationBreakoutAtr, 0.05)),
    maxExtensionAtr: Math.max(0.1, n(config.maxExtensionAtr, 1.0)),
    stopBufferAtr: Math.max(0, n(config.stopBufferAtr, 0.10)),
    minStopAtr: Math.max(0.1, n(config.minStopAtr, 0.60)),
    maxStopAtr: Math.max(0.2, n(config.maxStopAtr, 1.50)),
    takeProfitR: Math.max(1.5, n(config.takeProfitR, 2.50)),
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(n(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(n(config.sessionEndUtc, 20))))
  };

  const m5 = features.m5 || {};
  const h1 = features.h1 || {};
  const m5Bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const h1Bars = Array.isArray(features.recentH1) ? features.recentH1 : [];
  const signal = m5Bars.at(-1);
  const pullback = m5Bars.at(-2);

  const required = [
    m5.ema20, m5.ema50, m5.rsi14, m5.atr14,
    h1.close, h1.ema20, h1.ema50, h1.ema200, h1.rsi14, h1.atr14,
    signal?.time, signal?.open, signal?.high, signal?.low, signal?.close,
    pullback?.time, pullback?.open, pullback?.high, pullback?.low, pullback?.close,
    h1Bars.at(-1)?.time, h1Bars.at(-1)?.close, h1Bars.at(-4)?.time, h1Bars.at(-4)?.close
  ];
  if (!signal || !pullback || !required.every((v) => Number.isFinite(Number(v))) ||
      !(Number(m5.atr14) > 0) || !(Number(h1.atr14) > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }
  if (Number(signal.time) - Number(pullback.time) !== 300) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'noncontiguous_m5_bars' };
  }
  if (h1Bars.length < 4 || !contiguous(h1Bars.slice(-4), 3600)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'insufficient_or_noncontiguous_h1_momentum' };
  }
  if (Number(h1Bars.at(-1).close) !== Number(h1.close)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_bar_feature_mismatch' };
  }

  const hour = new Date(Number(signal.time) * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };

  const h1MomentumAtr = (Number(h1.close) - Number(h1Bars.at(-4).close)) / Number(h1.atr14);
  const h1GapAtr = (Number(h1.ema20) - Number(h1.ema50)) / Number(h1.atr14);
  const trendUp = Number(h1.close) > Number(h1.ema20) &&
    Number(h1.ema20) > Number(h1.ema50) &&
    Number(h1.ema50) > Number(h1.ema200) &&
    h1MomentumAtr >= cfg.minH1MomentumAtr &&
    h1GapAtr >= cfg.minH1EmaGapAtr &&
    Number(h1.rsi14) >= cfg.minH1RsiBuy &&
    Number(h1.rsi14) <= cfg.maxH1RsiBuy;
  const trendDown = Number(h1.close) < Number(h1.ema20) &&
    Number(h1.ema20) < Number(h1.ema50) &&
    Number(h1.ema50) < Number(h1.ema200) &&
    h1MomentumAtr <= -cfg.minH1MomentumAtr &&
    h1GapAtr <= -cfg.minH1EmaGapAtr &&
    Number(h1.rsi14) >= cfg.minH1RsiSell &&
    Number(h1.rsi14) <= cfg.maxH1RsiSell;
  if (!trendUp && !trendDown) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_trend_momentum_filter',
      diagnostics: { h1_momentum_3_atr: h1MomentumAtr, h1_ema20_ema50_gap_atr: h1GapAtr } };
  }

  const side = trendUp ? 'BUY' : 'SELL';
  const atr = Number(m5.atr14);
  const ema20 = Number(m5.ema20);
  const ema50 = Number(m5.ema50);
  const touchBand = cfg.pullbackTouchAtr * atr;
  const touchedEma20 = Number(pullback.low) <= ema20 + touchBand &&
    Number(pullback.high) >= ema20 - touchBand;
  if (!touchedEma20) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'pullback_ema20_not_touched',
      diagnostics: { h1_momentum_3_atr: h1MomentumAtr, h1_ema20_ema50_gap_atr: h1GapAtr } };
  }

  if (trendUp && Number(pullback.low) < ema50 - cfg.maxEma50PenetrationAtr * atr) {
    return { candidate: 'WAIT', trend: 'UP', reason: 'pullback_broke_ema50_structure' };
  }
  if (trendDown && Number(pullback.high) > ema50 + cfg.maxEma50PenetrationAtr * atr) {
    return { candidate: 'WAIT', trend: 'DOWN', reason: 'pullback_broke_ema50_structure' };
  }

  const candleRange = Number(signal.high) - Number(signal.low);
  if (!(candleRange > 0)) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'invalid_confirmation_candle' };
  }
  const bodyAtr = Math.abs(Number(signal.close) - Number(signal.open)) / atr;
  const closeLocation = (Number(signal.close) - Number(signal.low)) / candleRange;
  const extensionAtr = side === 'BUY'
    ? (Number(signal.close) - ema20) / atr
    : (ema20 - Number(signal.close)) / atr;

  if (bodyAtr < cfg.minConfirmationBodyAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'confirmation_body_filter' };
  }
  if (extensionAtr > cfg.maxExtensionAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'late_entry_extension_filter' };
  }

  if (trendUp) {
    if (!(Number(m5.ema20) > Number(m5.ema50)) ||
        !(Number(signal.close) > Number(signal.open)) ||
        !(Number(signal.close) >= Number(pullback.high) + cfg.confirmationBreakoutAtr * atr)) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'bullish_reacceleration_not_confirmed' };
    }
    if (Number(m5.rsi14) < cfg.minM5RsiBuy || Number(m5.rsi14) > cfg.maxM5RsiBuy) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'm5_momentum_rsi_filter' };
    }
    if (closeLocation < cfg.minCloseLocationBuy) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'confirmation_close_location_filter' };
    }
  } else {
    if (!(Number(m5.ema20) < Number(m5.ema50)) ||
        !(Number(signal.close) < Number(signal.open)) ||
        !(Number(signal.close) <= Number(pullback.low) - cfg.confirmationBreakoutAtr * atr)) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'bearish_reacceleration_not_confirmed' };
    }
    if (Number(m5.rsi14) < cfg.minM5RsiSell || Number(m5.rsi14) > cfg.maxM5RsiSell) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'm5_momentum_rsi_filter' };
    }
    if (closeLocation > cfg.maxCloseLocationSell) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'confirmation_close_location_filter' };
    }
  }

  const structureBars = m5Bars.slice(-3);
  if (structureBars.length !== 3) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'insufficient_stop_structure' };
  }
  const structuralStop = side === 'BUY'
    ? Math.min(...structureBars.map((bar) => Number(bar.low))) - cfg.stopBufferAtr * atr
    : Math.max(...structureBars.map((bar) => Number(bar.high))) + cfg.stopBufferAtr * atr;
  const entryReference = Number(signal.close);
  const stopDistance = Math.abs(entryReference - structuralStop);
  const stopAtr = stopDistance / atr;
  const diagnostics = {
    h1_momentum_3_atr: h1MomentumAtr,
    h1_ema20_ema50_gap_atr: h1GapAtr,
    pullback_touch_atr: cfg.pullbackTouchAtr,
    pullback_ema20_distance_atr: side === 'BUY'
      ? (ema20 - Number(pullback.low)) / atr
      : (Number(pullback.high) - ema20) / atr,
    pullback_ema50_penetration_atr: side === 'BUY'
      ? Math.max(0, (ema50 - Number(pullback.low)) / atr)
      : Math.max(0, (Number(pullback.high) - ema50) / atr),
    confirmation_body_atr: bodyAtr,
    confirmation_close_location: closeLocation,
    confirmation_breakout_atr: side === 'BUY'
      ? (Number(signal.close) - Number(pullback.high)) / atr
      : (Number(pullback.low) - Number(signal.close)) / atr,
    extension_atr: extensionAtr,
    stop_atr: stopAtr,
    entry_reference: entryReference,
    h1_rsi14: Number(h1.rsi14),
    m5_rsi14: Number(m5.rsi14)
  };
  if (!(structuralStop > 0) || !(stopDistance > 0) ||
      stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'stop_distance_filter', diagnostics };
  }

  const target = side === 'BUY'
    ? entryReference + cfg.takeProfitR * stopDistance
    : entryReference - cfg.takeProfitR * stopDistance;

  return {
    candidate: side,
    trend: side === 'BUY' ? 'UP' : 'DOWN',
    setup_type: 'H1_MOMENTUM_M5_EMA20_PULLBACK_REACCELERATION',
    entry_reference: entryReference,
    stop_loss: structuralStop,
    take_profit: target,
    risk_reward: cfg.takeProfitR,
    diagnostics,
    reason: 'trend_momentum_pullback_reaccelerated'
  };
}
