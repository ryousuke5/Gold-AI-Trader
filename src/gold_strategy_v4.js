const n = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

function contiguous(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return false;
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].time - bars[i - 1].time !== 300) return false;
  }
  return true;
}

function rangeBefore(bars, breakoutIndex, lookback) {
  if (breakoutIndex < lookback) return null;
  const prior = bars.slice(breakoutIndex - lookback, breakoutIndex);
  if (prior.length !== lookback || !contiguous(prior)) return null;
  return {
    high: Math.max(...prior.map((b) => b.high)),
    low: Math.min(...prior.map((b) => b.low)),
    averageVolume: prior.reduce((sum, b) => sum + Math.max(0, n(b.volume)), 0) / prior.length
  };
}

function retestTouches(bars, breakoutIndex, signalIndex, side, level, atr, toleranceAtr, maxDepthAtr) {
  const touches = [];
  for (let i = breakoutIndex + 1; i <= signalIndex; i += 1) {
    const b = bars[i];
    if (side === 'BUY') {
      const depth = (level - b.low) / atr;
      const touched = b.low <= level + toleranceAtr * atr && depth <= maxDepthAtr;
      if (touched) touches.push({ index: i, time: b.time, low: b.low, high: b.high });
    } else {
      const depth = (b.high - level) / atr;
      const touched = b.high >= level - toleranceAtr * atr && depth <= maxDepthAtr;
      if (touched) touches.push({ index: i, time: b.time, low: b.low, high: b.high });
    }
  }
  return touches;
}

export function buildGoldV4Setup(features = {}, config = {}) {
  const cfg = {
    rangeLookback: Math.max(4, Math.floor(n(config.rangeLookback, 12))),
    minRangeAtr: Math.max(0.1, n(config.minRangeAtr, 0.60)),
    maxRangeAtr: Math.max(0.2, n(config.maxRangeAtr, 2.40)),
    breakoutAtr: Math.max(0.01, n(config.breakoutAtr, 0.10)),
    breakoutBodyAtr: Math.max(0.05, n(config.breakoutBodyAtr, 0.45)),
    breakoutCloseLocation: Math.min(0.95, Math.max(0.50, n(config.breakoutCloseLocation, 0.70))),
    breakoutVolumeRatio: Math.max(0.1, n(config.breakoutVolumeRatio, 1.15)),
    maxRetestBars: Math.max(1, Math.floor(n(config.maxRetestBars, 4))),
    retestToleranceAtr: Math.max(0.01, n(config.retestToleranceAtr, 0.20)),
    maxRetestDepthAtr: Math.max(0.05, n(config.maxRetestDepthAtr, 0.35)),
    retestBodyAtr: Math.max(0.02, n(config.retestBodyAtr, 0.15)),
    retestCloseLocation: Math.min(0.95, Math.max(0.50, n(config.retestCloseLocation, 0.60))),
    confirmationBufferAtr: Math.max(0, n(config.confirmationBufferAtr, 0.05)),
    maxExtensionAtr: Math.max(0.1, n(config.maxExtensionAtr, 1.30)),
    stopBufferAtr: Math.max(0, n(config.stopBufferAtr, 0.15)),
    minStopAtr: Math.max(0.1, n(config.minStopAtr, 0.70)),
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
  const signalIndex = bars.length - 1;
  const signal = bars[signalIndex];

  const values = [h1.close, h1.ema20, h1.ema50, h1.ema200, h1.rsi14, h1.atr14, m5.ema20, m5.rsi14, m5.atr14];
  if (!signal || bars.length < cfg.rangeLookback + 2 || !values.every(Number.isFinite) || !(m5.atr14 > 0) || !(h1.atr14 > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }

  const recentWindow = bars.slice(Math.max(0, bars.length - (cfg.rangeLookback + cfg.maxRetestBars + 2)));
  if (!contiguous(recentWindow)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'noncontiguous_recent_history' };
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

  const earliestBreakout = Math.max(cfg.rangeLookback, signalIndex - cfg.maxRetestBars);
  for (let breakoutIndex = signalIndex - 1; breakoutIndex >= earliestBreakout; breakoutIndex -= 1) {
    const age = signalIndex - breakoutIndex;
    if (age < 1 || age > cfg.maxRetestBars) continue;

    const breakout = bars[breakoutIndex];
    const range = rangeBefore(bars, breakoutIndex, cfg.rangeLookback);
    if (!range) continue;

    const breakoutAtr = n(breakout.atr14, m5.atr14);
    if (!(breakoutAtr > 0)) continue;
    const rangeWidth = range.high - range.low;
    const rangeAtr = rangeWidth / breakoutAtr;
    if (!(rangeWidth > 0) || rangeAtr < cfg.minRangeAtr || rangeAtr > cfg.maxRangeAtr) continue;

    const breakoutRange = breakout.high - breakout.low;
    const breakoutBody = Math.abs(breakout.close - breakout.open);
    if (!(breakoutRange > 0) || breakoutBody / breakoutAtr < cfg.breakoutBodyAtr) continue;

    const breakoutCloseLocation = (breakout.close - breakout.low) / breakoutRange;
    const breakoutVolumeRatio = range.averageVolume > 0 ? n(breakout.volume) / range.averageVolume : 0;
    if (range.averageVolume > 0 && breakoutVolumeRatio < cfg.breakoutVolumeRatio) continue;

    const buyBreak = trendUp &&
      breakout.close > breakout.open &&
      breakout.close >= range.high + cfg.breakoutAtr * breakoutAtr &&
      breakoutCloseLocation >= cfg.breakoutCloseLocation;
    const sellBreak = trendDown &&
      breakout.close < breakout.open &&
      breakout.close <= range.low - cfg.breakoutAtr * breakoutAtr &&
      breakoutCloseLocation <= 1 - cfg.breakoutCloseLocation;

    if (!buyBreak && !sellBreak) continue;

    const side = buyBreak ? 'BUY' : 'SELL';
    const level = side === 'BUY' ? range.high : range.low;
    const touches = retestTouches(
      bars, breakoutIndex, signalIndex, side, level, m5.atr14,
      cfg.retestToleranceAtr, cfg.maxRetestDepthAtr
    );
    if (!touches.length) continue;

    const signalRange = signal.high - signal.low;
    const signalBody = Math.abs(signal.close - signal.open);
    if (!(signalRange > 0) || signalBody / m5.atr14 < cfg.retestBodyAtr) continue;

    const signalCloseLocation = (signal.close - signal.low) / signalRange;
    const buyConfirmed = side === 'BUY' &&
      signal.close > signal.open &&
      signal.close >= level + cfg.confirmationBufferAtr * m5.atr14 &&
      signalCloseLocation >= cfg.retestCloseLocation &&
      signal.close >= m5.ema20 &&
      (signal.close - m5.ema20) / m5.atr14 <= cfg.maxExtensionAtr;
    const sellConfirmed = side === 'SELL' &&
      signal.close < signal.open &&
      signal.close <= level - cfg.confirmationBufferAtr * m5.atr14 &&
      signalCloseLocation <= 1 - cfg.retestCloseLocation &&
      signal.close <= m5.ema20 &&
      (m5.ema20 - signal.close) / m5.atr14 <= cfg.maxExtensionAtr;

    if (!buyConfirmed && !sellConfirmed) continue;

    const retestLow = Math.min(...touches.map((t) => t.low));
    const retestHigh = Math.max(...touches.map((t) => t.high));
    const referenceEntry = signal.close;
    const stop = side === 'BUY'
      ? retestLow - cfg.stopBufferAtr * m5.atr14
      : retestHigh + cfg.stopBufferAtr * m5.atr14;
    const stopDistance = Math.abs(referenceEntry - stop);
    const stopAtr = stopDistance / m5.atr14;
    if (!(stopDistance > 0) || stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) continue;

    const target = side === 'BUY'
      ? referenceEntry + cfg.takeProfitR * stopDistance
      : referenceEntry - cfg.takeProfitR * stopDistance;

    return {
      candidate: side,
      trend: side === 'BUY' ? 'UP' : 'DOWN',
      setup_type: 'H1_TREND_RANGE_BREAKOUT_RETEST',
      entry_reference: referenceEntry,
      stop_loss: stop,
      take_profit: target,
      risk_reward: cfg.takeProfitR,
      diagnostics: {
        hour_utc: hour,
        breakout_time: breakout.time,
        breakout_age_bars: age,
        breakout_level: level,
        range_high: range.high,
        range_low: range.low,
        range_atr: rangeAtr,
        breakout_body_atr: breakoutBody / breakoutAtr,
        breakout_close_location: breakoutCloseLocation,
        breakout_volume_ratio: breakoutVolumeRatio,
        retest_count: touches.length,
        retest_low: retestLow,
        retest_high: retestHigh,
        retest_depth_atr: side === 'BUY'
          ? (level - retestLow) / m5.atr14
          : (retestHigh - level) / m5.atr14,
        confirmation_close_location: signalCloseLocation,
        stop_atr: stopAtr
      },
      reason: 'breakout_retest_confirmed'
    };
  }

  return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'no_valid_breakout_retest' };
}
