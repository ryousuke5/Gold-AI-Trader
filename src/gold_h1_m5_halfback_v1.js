// GOLD H1 trend + M5 halfback V1.
// Research/monitor-only deterministic strategy. Confirmed pivots use only bars
// available at the signal close; no future candles are inspected.
const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function isContiguous(bars, start, end) {
  for (let i = start + 1; i <= end; i++) {
    if (!Number.isFinite(Number(bars[i - 1]?.time)) ||
        !Number.isFinite(Number(bars[i]?.time)) ||
        Number(bars[i].time) - Number(bars[i - 1].time) !== 300) return false;
  }
  return true;
}

function confirmedPivots(bars, left, right) {
  const highs = [];
  const lows = [];
  // i + right < bars.length means every confirmation candle is already closed.
  for (let i = left; i < bars.length - right; i++) {
    const bar = bars[i];
    if (![bar?.time, bar?.high, bar?.low].every((v) => Number.isFinite(Number(v)))) continue;
    const start = i - left;
    const end = i + right;
    if (!isContiguous(bars, start, end)) continue;
    const leftBars = bars.slice(start, i);
    const rightBars = bars.slice(i + 1, end + 1);
    if (leftBars.every((b) => Number(bar.high) > Number(b.high)) &&
        rightBars.every((b) => Number(bar.high) >= Number(b.high))) {
      highs.push({ index: i, price: Number(bar.high), time: Number(bar.time) });
    }
    if (leftBars.every((b) => Number(bar.low) < Number(b.low)) &&
        rightBars.every((b) => Number(bar.low) <= Number(b.low))) {
      lows.push({ index: i, price: Number(bar.low), time: Number(bar.time) });
    }
  }
  return { highs, lows };
}

function chooseImpulse({ bars, pivots, side, cfg }) {
  const lastIndex = bars.length - 1;
  if (side === 'BUY') {
    for (let h = pivots.highs.length - 1; h >= 0; h--) {
      const high = pivots.highs[h];
      if (lastIndex - high.index > cfg.maxImpulseBars) continue;
      for (let l = pivots.lows.length - 1; l >= 0; l--) {
        const low = pivots.lows[l];
        if (low.index >= high.index) continue;
        const barsApart = high.index - low.index;
        if (barsApart < cfg.minImpulseBars || barsApart > cfg.maxImpulseBars) continue;
        if (!isContiguous(bars, low.index, lastIndex)) continue;
        const range = high.price - low.price;
        const rangeAtr = range / cfg.m5Atr;
        if (range > 0 && rangeAtr >= cfg.minImpulseAtr) return { low, high, range, rangeAtr };
        break;
      }
    }
  } else {
    for (let l = pivots.lows.length - 1; l >= 0; l--) {
      const low = pivots.lows[l];
      if (lastIndex - low.index > cfg.maxImpulseBars) continue;
      for (let h = pivots.highs.length - 1; h >= 0; h--) {
        const high = pivots.highs[h];
        if (high.index >= low.index) continue;
        const barsApart = low.index - high.index;
        if (barsApart < cfg.minImpulseBars || barsApart > cfg.maxImpulseBars) continue;
        if (!isContiguous(bars, high.index, lastIndex)) continue;
        const range = high.price - low.price;
        const rangeAtr = range / cfg.m5Atr;
        if (range > 0 && rangeAtr >= cfg.minImpulseAtr) return { high, low, range, rangeAtr };
        break;
      }
    }
  }
  return null;
}

export function buildGoldH1M5HalfbackV1Setup(features = {}, config = {}) {
  const cfg = {
    swingLeftBars: Math.max(1, Math.floor(num(config.swingLeftBars, 2))),
    swingRightBars: Math.max(1, Math.floor(num(config.swingRightBars, 2))),
    minImpulseBars: Math.max(3, Math.floor(num(config.minImpulseBars, 5))),
    maxImpulseBars: Math.max(6, Math.floor(num(config.maxImpulseBars, 40))),
    minImpulseAtr: Math.max(0.1, num(config.minImpulseAtr, 1.5)),
    retracementMin: clamp(num(config.retracementMin, 0.45), 0.1, 0.9),
    retracementMax: clamp(num(config.retracementMax, 0.55), 0.1, 0.9),
    minBodyAtr: Math.max(0, num(config.minBodyAtr, 0.25)),
    minH1RsiBuy: clamp(num(config.minH1RsiBuy, 50), 1, 99),
    maxH1RsiBuy: clamp(num(config.maxH1RsiBuy, 72), 1, 99),
    minH1RsiSell: clamp(num(config.minH1RsiSell, 28), 1, 99),
    maxH1RsiSell: clamp(num(config.maxH1RsiSell, 50), 1, 99),
    minCloseLocationBuy: clamp(num(config.minCloseLocationBuy, 0.60), 0.5, 0.99),
    maxCloseLocationSell: clamp(num(config.maxCloseLocationSell, 0.40), 0.01, 0.5),
    stopBufferAtr: Math.max(0, num(config.stopBufferAtr, 0.15)),
    minStopAtr: Math.max(0.1, num(config.minStopAtr, 0.5)),
    maxStopAtr: Math.max(0.2, num(config.maxStopAtr, 2.5)),
    takeProfitR: Math.max(1, num(config.takeProfitR, 2)),
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionEndUtc, 20)))),
    m5Atr: num(features?.m5?.atr14, 0)
  };
  if (cfg.retracementMin > cfg.retracementMax || !(cfg.m5Atr > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'invalid_halfback_config_or_atr' };
  }

  const m5 = features.m5 || {};
  const h1 = features.h1 || {};
  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signal = bars.at(-1);
  const pullback = bars.at(-2);
  const required = [
    h1.close, h1.ema20, h1.ema50, h1.ema200, h1.rsi14, h1.atr14,
    m5.atr14,
    signal?.time, signal?.open, signal?.high, signal?.low, signal?.close,
    pullback?.time, pullback?.high, pullback?.low, pullback?.close
  ];
  if (!signal || !pullback || !required.every((v) => Number.isFinite(Number(v))) ||
      !(Number(h1.atr14) > 0) || !(Number(m5.atr14) > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }
  if (Number(signal.time) - Number(pullback.time) !== 300) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'noncontiguous_confirmation_bars' };
  }
  if (Number.isFinite(Number(features.barTime)) &&
      Number(features.barTime) > 0 && Number(signal.time) !== Number(features.barTime)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'm5_bar_time_mismatch' };
  }
  if (bars.length < cfg.swingLeftBars + cfg.swingRightBars + 5) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'insufficient_confirmed_swing_history' };
  }

  const hour = new Date(Number(signal.time) * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };

  const trendUp = Number(h1.close) > Number(h1.ema20) &&
    Number(h1.ema20) > Number(h1.ema50) &&
    Number(h1.ema50) > Number(h1.ema200) &&
    Number(h1.rsi14) >= cfg.minH1RsiBuy &&
    Number(h1.rsi14) <= cfg.maxH1RsiBuy;
  const trendDown = Number(h1.close) < Number(h1.ema20) &&
    Number(h1.ema20) < Number(h1.ema50) &&
    Number(h1.ema50) < Number(h1.ema200) &&
    Number(h1.rsi14) >= cfg.minH1RsiSell &&
    Number(h1.rsi14) <= cfg.maxH1RsiSell;
  if (!trendUp && !trendDown) return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_trend_filter' };

  const side = trendUp ? 'BUY' : 'SELL';
  const pivots = confirmedPivots(bars, cfg.swingLeftBars, cfg.swingRightBars);
  const impulse = chooseImpulse({ bars, pivots, side, cfg });
  if (!impulse) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'no_recent_confirmed_impulse' };
  }

  const range = impulse.range;
  const pullbackDepth = side === 'BUY'
    ? (impulse.high.price - Number(pullback.low)) / range
    : (Number(pullback.high) - impulse.low.price) / range;
  const zoneTouched = pullbackDepth >= cfg.retracementMin && pullbackDepth <= cfg.retracementMax;
  const diagnostics = {
    retracement_min: cfg.retracementMin,
    retracement_max: cfg.retracementMax,
    observed_retracement: pullbackDepth,
    impulse_range: range,
    impulse_range_atr: impulse.rangeAtr,
    impulse_low: impulse.low.price,
    impulse_high: impulse.high.price,
    impulse_low_time: impulse.low.time,
    impulse_high_time: impulse.high.time,
    impulse_bars: Math.abs(impulse.high.index - impulse.low.index),
    confirmed_pivot_highs: pivots.highs.length,
    confirmed_pivot_lows: pivots.lows.length,
    swing_left_bars: cfg.swingLeftBars,
    swing_right_bars: cfg.swingRightBars,
    m5_atr: cfg.m5Atr
  };
  if (!zoneTouched) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'halfback_zone_not_touched', diagnostics };
  }

  const candleRange = Number(signal.high) - Number(signal.low);
  const body = Math.abs(Number(signal.close) - Number(signal.open));
  if (!(candleRange > 0)) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'invalid_confirmation_candle', diagnostics };
  }
  const closeLocation = (Number(signal.close) - Number(signal.low)) / candleRange;
  if (body / cfg.m5Atr < cfg.minBodyAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'confirmation_body_filter', diagnostics };
  }
  if (side === 'BUY') {
    if (!(Number(signal.close) > Number(signal.open) &&
          Number(signal.close) > Number(pullback.high))) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'bullish_reconfirmation_failed', diagnostics };
    }
    if (closeLocation < cfg.minCloseLocationBuy) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'confirmation_close_location_filter', diagnostics };
    }
  } else {
    if (!(Number(signal.close) < Number(signal.open) &&
          Number(signal.close) < Number(pullback.low))) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'bearish_reconfirmation_failed', diagnostics };
    }
    if (closeLocation > cfg.maxCloseLocationSell) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'confirmation_close_location_filter', diagnostics };
    }
  }

  const recentSwingBars = bars.slice(-5);
  const stop = side === 'BUY'
    ? Math.min(...recentSwingBars.map((b) => Number(b.low))) - cfg.stopBufferAtr * cfg.m5Atr
    : Math.max(...recentSwingBars.map((b) => Number(b.high))) + cfg.stopBufferAtr * cfg.m5Atr;
  const entryReference = Number(signal.close);
  const stopDistance = Math.abs(entryReference - stop);
  const stopAtr = stopDistance / cfg.m5Atr;
  diagnostics.confirmation_body_atr = body / cfg.m5Atr;
  diagnostics.confirmation_close_location = closeLocation;
  diagnostics.stop_atr = stopAtr;
  diagnostics.entry_reference = entryReference;
  if (!(stop > 0) || !(stopDistance > 0) || stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'stop_distance_filter', diagnostics };
  }
  const target = side === 'BUY'
    ? entryReference + cfg.takeProfitR * stopDistance
    : entryReference - cfg.takeProfitR * stopDistance;
  return {
    candidate: side,
    trend: side === 'BUY' ? 'UP' : 'DOWN',
    setup_type: 'H1_TREND_M5_HALFBACK_50',
    entry_reference: entryReference,
    stop_loss: stop,
    take_profit: target,
    risk_reward: cfg.takeProfitR,
    diagnostics,
    reason: 'halfback_reconfirmed'
  };
}
