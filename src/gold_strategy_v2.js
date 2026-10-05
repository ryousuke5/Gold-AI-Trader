// CI: GOLD V2 resumable research pipeline trigger
const n = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

function recentRange(bars, lookback) {
  if (!Array.isArray(bars) || bars.length < lookback + 1) return null;
  const signal = bars[bars.length - 1];
  const prior = bars.slice(-(lookback + 1), -1);
  if (!prior.length) return null;
  for (let i = 1; i < prior.length; i++) {
    if (prior[i].time - prior[i - 1].time !== 300) return null;
  }
  if (signal.time - prior[prior.length - 1].time !== 300) return null;
  return {
    high: Math.max(...prior.map((b) => b.high)),
    low: Math.min(...prior.map((b) => b.low)),
    averageVolume: prior.reduce((sum, b) => sum + Math.max(0, n(b.volume)), 0) / prior.length
  };
}

export function buildGoldV2Setup(features = {}, config = {}) {
  const cfg = {
    rangeLookback: Math.max(4, Math.floor(n(config.rangeLookback, 12))),
    minRangeAtr: Math.max(0.1, n(config.minRangeAtr, 0.8)),
    maxRangeAtr: Math.max(0.2, n(config.maxRangeAtr, 2.8)),
    breakoutAtr: Math.max(0.01, n(config.breakoutAtr, 0.10)),
    minBodyAtr: Math.max(0.05, n(config.minBodyAtr, 0.40)),
    minCloseLocation: Math.min(0.95, Math.max(0.50, n(config.minCloseLocation, 0.65))),
    minVolumeRatio: Math.max(0.1, n(config.minVolumeRatio, 1.10)),
    buyRsiMin: Math.max(1, n(config.buyRsiMin, 52)),
    buyRsiMax: Math.min(99, n(config.buyRsiMax, 75)),
    sellRsiMin: Math.max(1, n(config.sellRsiMin, 25)),
    sellRsiMax: Math.min(99, n(config.sellRsiMax, 48)),
    maxExtensionAtr: Math.max(0.1, n(config.maxExtensionAtr, 1.50)),
    stopBufferAtr: Math.max(0, n(config.stopBufferAtr, 0.15)),
    minStopAtr: Math.max(0.1, n(config.minStopAtr, 0.80)),
    maxStopAtr: Math.max(0.2, n(config.maxStopAtr, 2.00)),
    takeProfitR: Math.max(1.0, n(config.takeProfitR, 2.00)),
    minH1RsiBuy: Math.max(1, n(config.minH1RsiBuy, 50)),
    maxH1RsiBuy: Math.min(99, n(config.maxH1RsiBuy, 72)),
    minH1RsiSell: Math.max(1, n(config.minH1RsiSell, 28)),
    maxH1RsiSell: Math.min(99, n(config.maxH1RsiSell, 50)),
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(n(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(n(config.sessionEndUtc, 20))))
  };

  const m5 = features.m5 || {};
  const h1 = features.h1 || {};
  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signal = bars[bars.length - 1];

  const values = [
    h1.close, h1.ema20, h1.ema50, h1.ema200, h1.rsi14, h1.atr14,
    m5.ema20, m5.ema50, m5.rsi14, m5.atr14
  ];
  if (!signal || !values.every(Number.isFinite) || !(m5.atr14 > 0) || !(h1.atr14 > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }

  const hour = new Date(signal.time * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };

  const trendUp = h1.close > h1.ema20 && h1.ema20 > h1.ema50 && h1.ema50 > h1.ema200 &&
    h1.rsi14 >= cfg.minH1RsiBuy && h1.rsi14 <= cfg.maxH1RsiBuy;
  const trendDown = h1.close < h1.ema20 && h1.ema20 < h1.ema50 && h1.ema50 < h1.ema200 &&
    h1.rsi14 >= cfg.minH1RsiSell && h1.rsi14 <= cfg.maxH1RsiSell;
  if (!trendUp && !trendDown) return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_trend_filter' };

  const range = recentRange(bars, cfg.rangeLookback);
  if (!range) return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'insufficient_or_noncontiguous_range' };

  const rangeWidth = range.high - range.low;
  const rangeAtr = rangeWidth / m5.atr14;
  if (!(rangeWidth > 0) || rangeAtr < cfg.minRangeAtr || rangeAtr > cfg.maxRangeAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'compression_filter' };
  }

  const candleRange = signal.high - signal.low;
  const body = Math.abs(signal.close - signal.open);
  if (!(candleRange > 0) || body / m5.atr14 < cfg.minBodyAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'impulse_body_filter' };
  }

  const closeLocation = (signal.close - signal.low) / candleRange;
  const volumeRatio = range.averageVolume > 0 ? n(signal.volume) / range.averageVolume : 0;
  if (range.averageVolume > 0 && volumeRatio < cfg.minVolumeRatio) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'volume_expansion_filter' };
  }

  const breakoutDistanceUp = signal.close - range.high;
  const breakoutDistanceDown = range.low - signal.close;
  const buyBreakout = trendUp &&
    breakoutDistanceUp >= cfg.breakoutAtr * m5.atr14 &&
    closeLocation >= cfg.minCloseLocation &&
    m5.rsi14 >= cfg.buyRsiMin && m5.rsi14 <= cfg.buyRsiMax &&
    signal.close >= m5.ema20 &&
    (signal.close - m5.ema20) / m5.atr14 <= cfg.maxExtensionAtr;
  const sellBreakout = trendDown &&
    breakoutDistanceDown >= cfg.breakoutAtr * m5.atr14 &&
    closeLocation <= 1 - cfg.minCloseLocation &&
    m5.rsi14 >= cfg.sellRsiMin && m5.rsi14 <= cfg.sellRsiMax &&
    signal.close <= m5.ema20 &&
    (m5.ema20 - signal.close) / m5.atr14 <= cfg.maxExtensionAtr;

  if (!buyBreakout && !sellBreakout) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'breakout_trigger_filter' };
  }

  const side = buyBreakout ? 'BUY' : 'SELL';
  const referenceEntry = signal.close;
  const stop = side === 'BUY'
    ? Math.min(range.low - cfg.stopBufferAtr * m5.atr14, signal.low - 0.05 * m5.atr14)
    : Math.max(range.high + cfg.stopBufferAtr * m5.atr14, signal.high + 0.05 * m5.atr14);
  const stopDistance = Math.abs(referenceEntry - stop);
  const stopAtr = stopDistance / m5.atr14;
  if (stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'stop_distance_filter' };
  }

  const target = side === 'BUY'
    ? referenceEntry + cfg.takeProfitR * stopDistance
    : referenceEntry - cfg.takeProfitR * stopDistance;

  return {
    candidate: side,
    trend: side === 'BUY' ? 'UP' : 'DOWN',
    setup_type: 'H1_TREND_M5_COMPRESSION_BREAKOUT',
    entry_reference: referenceEntry,
    stop_loss: stop,
    take_profit: target,
    risk_reward: cfg.takeProfitR,
    diagnostics: {
      hour_utc: hour,
      range_high: range.high,
      range_low: range.low,
      range_atr: rangeAtr,
      body_atr: body / m5.atr14,
      close_location: closeLocation,
      volume_ratio: volumeRatio,
      stop_atr: stopAtr,
      breakout_atr: side === 'BUY' ? breakoutDistanceUp / m5.atr14 : breakoutDistanceDown / m5.atr14
    },
    reason: 'trend_compression_breakout_confirmed'
  };
}
