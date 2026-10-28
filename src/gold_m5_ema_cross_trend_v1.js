// M5 EMA20/EMA50 crossover in an aligned H1 trend — research-only V1.
// Entry is a fresh M5 EMA crossover, not a range breakout, liquidity sweep,
// EMA pullback/reclaim, or halfback retracement. This module never places orders.
const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function isContiguous(bars) {
  for (let i = 1; i < bars.length; i++) {
    if (!Number.isFinite(Number(bars[i - 1]?.time)) ||
        !Number.isFinite(Number(bars[i]?.time)) ||
        Number(bars[i].time) - Number(bars[i - 1].time) !== 300) return false;
  }
  return true;
}

export function buildGoldM5EmaCrossTrendV1Setup(features = {}, config = {}) {
  const cfg = {
    stopLookbackBars: Math.max(3, Math.floor(num(config.stopLookbackBars, 8))),
    minBodyAtr: Math.max(0, num(config.minBodyAtr, 0.20)),
    minCloseLocationBuy: clamp(num(config.minCloseLocationBuy, 0.60), 0.5, 0.99),
    maxCloseLocationSell: clamp(num(config.maxCloseLocationSell, 0.40), 0.01, 0.5),
    minH1TrendSeparationAtr: Math.max(0, num(config.minH1TrendSeparationAtr, 0.15)),
    maxH1DistanceEma20Atr: Math.max(0.1, num(config.maxH1DistanceEma20Atr, 2.00)),
    minH1RsiBuy: clamp(num(config.minH1RsiBuy, 52), 1, 99),
    maxH1RsiSell: clamp(num(config.maxH1RsiSell, 48), 1, 99),
    stopBufferAtr: Math.max(0, num(config.stopBufferAtr, 0.10)),
    minStopAtr: Math.max(0.1, num(config.minStopAtr, 0.40)),
    maxStopAtr: Math.max(0.2, num(config.maxStopAtr, 2.00)),
    takeProfitR: Math.max(1, num(config.takeProfitR, 1.50)),
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionEndUtc, 20)))),
    m5Atr: num(features?.m5?.atr14, 0)
  };

  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signal = bars.at(-1);
  const previous = bars.at(-2);
  if (!(cfg.m5Atr > 0) || !signal || !previous ||
      bars.length < cfg.stopLookbackBars) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'insufficient_m5_history_or_atr' };
  }

  const requiredBars = bars.slice(-cfg.stopLookbackBars);
  if (!isContiguous(requiredBars)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'm5_data_gap' };
  }
  const requiredBarValues = [previous.ema20, previous.ema50, signal.ema20, signal.ema50,
    signal.open, signal.high, signal.low, signal.close];
  if (!requiredBarValues.every((v) => Number.isFinite(Number(v))) ||
      !(Number(signal.high) > Number(signal.low))) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'invalid_m5_crossover_data' };
  }

  const h1 = features.h1 || {};
  const requiredH1 = [h1.close, h1.ema20, h1.ema50, h1.rsi14, h1.atr14];
  if (!requiredH1.every((v) => Number.isFinite(Number(v))) || !(Number(h1.atr14) > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_h1_trend_features' };
  }

  const hour = new Date(Number(signal.time) * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };

  const h1SeparationAtr = Math.abs(Number(h1.ema20) - Number(h1.ema50)) / Number(h1.atr14);
  const h1DistanceEma20Atr = Math.abs(Number(h1.close) - Number(h1.ema20)) / Number(h1.atr14);
  if (h1SeparationAtr < cfg.minH1TrendSeparationAtr) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_trend_separation_filter',
      diagnostics: { h1_separation_atr: h1SeparationAtr } };
  }
  if (h1DistanceEma20Atr > cfg.maxH1DistanceEma20Atr) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_extension_filter',
      diagnostics: { h1_distance_ema20_atr: h1DistanceEma20Atr } };
  }

  const h1Up = Number(h1.close) > Number(h1.ema50) &&
    Number(h1.ema20) > Number(h1.ema50) && Number(h1.rsi14) >= cfg.minH1RsiBuy;
  const h1Down = Number(h1.close) < Number(h1.ema50) &&
    Number(h1.ema20) < Number(h1.ema50) && Number(h1.rsi14) <= cfg.maxH1RsiSell;
  if (!h1Up && !h1Down) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_direction_filter' };
  }

  // The signal must cross on this completed M5 candle; persistent EMA alignment
  // alone is not an entry. Only already-closed bars are inspected.
  const crossUp = Number(previous.ema20) <= Number(previous.ema50) &&
    Number(signal.ema20) > Number(signal.ema50);
  const crossDown = Number(previous.ema20) >= Number(previous.ema50) &&
    Number(signal.ema20) < Number(signal.ema50);
  const candleRange = Number(signal.high) - Number(signal.low);
  const body = Math.abs(Number(signal.close) - Number(signal.open));
  const closeLocation = (Number(signal.close) - Number(signal.low)) / candleRange;
  const diagnostics = {
    m5_cross_up: crossUp,
    m5_cross_down: crossDown,
    h1_separation_atr: h1SeparationAtr,
    h1_distance_ema20_atr: h1DistanceEma20Atr,
    m5_body_atr: body / cfg.m5Atr,
    m5_close_location: closeLocation,
    stop_lookback_bars: cfg.stopLookbackBars,
    m5_atr: cfg.m5Atr
  };
  if (body / cfg.m5Atr < cfg.minBodyAtr) {
    return { candidate: 'WAIT', trend: h1Up ? 'UP' : 'DOWN', reason: 'crossover_body_filter', diagnostics };
  }

  let side;
  if (h1Up && crossUp && Number(signal.close) > Number(signal.open) &&
      closeLocation >= cfg.minCloseLocationBuy) {
    side = 'BUY';
  } else if (h1Down && crossDown && Number(signal.close) < Number(signal.open) &&
      closeLocation <= cfg.maxCloseLocationSell) {
    side = 'SELL';
  } else {
    return { candidate: 'WAIT', trend: h1Up ? 'UP' : h1Down ? 'DOWN' : 'RANGE',
      reason: 'no_aligned_fresh_ema_cross', diagnostics };
  }

  const stopBars = bars.slice(-cfg.stopLookbackBars);
  const stop = side === 'BUY'
    ? Math.min(...stopBars.map((b) => Number(b.low))) - cfg.stopBufferAtr * cfg.m5Atr
    : Math.max(...stopBars.map((b) => Number(b.high))) + cfg.stopBufferAtr * cfg.m5Atr;
  const entryReference = Number(signal.close);
  const stopDistance = Math.abs(entryReference - stop);
  const stopAtr = stopDistance / cfg.m5Atr;
  diagnostics.stop_atr = stopAtr;
  diagnostics.entry_reference = entryReference;
  if (!(stop > 0) || !(stopDistance > 0) || stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: side === 'BUY' ? 'UP' : 'DOWN',
      reason: 'stop_distance_filter', diagnostics };
  }

  const target = side === 'BUY'
    ? entryReference + cfg.takeProfitR * stopDistance
    : entryReference - cfg.takeProfitR * stopDistance;
  return {
    candidate: side,
    trend: side === 'BUY' ? 'UP' : 'DOWN',
    setup_type: 'H1_TREND_M5_EMA20_50_FRESH_CROSS',
    entry_reference: entryReference,
    stop_loss: stop,
    take_profit: target,
    risk_reward: cfg.takeProfitR,
    diagnostics,
    reason: 'aligned_fresh_ema_cross'
  };
}
