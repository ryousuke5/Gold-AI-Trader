// M5 failed-breakout reversal V1.
// Independent research-only entry hypothesis: fade a sweep beyond the prior
// M5 range when the completed candle closes back inside the range, in a
// non-extended H1 EMA regime. This module does not place orders.
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

export function buildGoldM5FailedBreakoutV1Setup(features = {}, config = {}) {
  const cfg = {
    rangeLookbackBars: Math.max(6, Math.floor(num(config.rangeLookbackBars, 12))),
    minSweepAtr: Math.max(0.01, num(config.minSweepAtr, 0.10)),
    minBodyAtr: Math.max(0, num(config.minBodyAtr, 0.25)),
    minRejectionWickAtr: Math.max(0, num(config.minRejectionWickAtr, 0.10)),
    minCloseLocationBuy: clamp(num(config.minCloseLocationBuy, 0.60), 0.5, 0.99),
    maxCloseLocationSell: clamp(num(config.maxCloseLocationSell, 0.40), 0.01, 0.5),
    maxH1EmaSpreadAtr: Math.max(0.05, num(config.maxH1EmaSpreadAtr, 0.60)),
    maxH1CloseDistanceEma20Atr: Math.max(0.1, num(config.maxH1CloseDistanceEma20Atr, 1.25)),
    stopBufferAtr: Math.max(0, num(config.stopBufferAtr, 0.10)),
    minStopAtr: Math.max(0.1, num(config.minStopAtr, 0.25)),
    maxStopAtr: Math.max(0.2, num(config.maxStopAtr, 2.00)),
    takeProfitR: Math.max(1, num(config.takeProfitR, 1.50)),
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionEndUtc, 20)))),
    m5Atr: num(features?.m5?.atr14, 0)
  };

  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signal = bars.at(-1);
  if (!(cfg.m5Atr > 0) || !signal ||
      bars.length < cfg.rangeLookbackBars + 1) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'insufficient_range_or_atr_data' };
  }

  const h1 = features.h1 || {};
  const requiredH1 = [h1.close, h1.ema20, h1.ema50, h1.atr14];
  if (!requiredH1.every((v) => Number.isFinite(Number(v))) || !(Number(h1.atr14) > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_h1_regime_features' };
  }

  const start = bars.length - cfg.rangeLookbackBars - 1;
  const end = bars.length - 1;
  if (!isContiguous(bars, start, end)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'noncontiguous_range_bars' };
  }

  const hour = new Date(Number(signal.time) * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };

  const h1Atr = Number(h1.atr14);
  const h1EmaSpreadAtr = Math.abs(Number(h1.ema20) - Number(h1.ema50)) / h1Atr;
  const h1CloseDistanceEma20Atr = Math.abs(Number(h1.close) - Number(h1.ema20)) / h1Atr;
  const diagnostics = {
    range_lookback_bars: cfg.rangeLookbackBars,
    min_sweep_atr: cfg.minSweepAtr,
    h1_ema_spread_atr: h1EmaSpreadAtr,
    h1_close_distance_ema20_atr: h1CloseDistanceEma20Atr,
    max_h1_ema_spread_atr: cfg.maxH1EmaSpreadAtr,
    max_h1_close_distance_ema20_atr: cfg.maxH1CloseDistanceEma20Atr,
    m5_atr: cfg.m5Atr
  };
  if (h1EmaSpreadAtr > cfg.maxH1EmaSpreadAtr ||
      h1CloseDistanceEma20Atr > cfg.maxH1CloseDistanceEma20Atr) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_not_range_like', diagnostics };
  }

  const previousRange = bars.slice(start, end);
  const rangeHigh = Math.max(...previousRange.map((b) => Number(b.high)));
  const rangeLow = Math.min(...previousRange.map((b) => Number(b.low)));
  const open = Number(signal.open);
  const high = Number(signal.high);
  const low = Number(signal.low);
  const close = Number(signal.close);
  if (![signal.time, open, high, low, close].every((v) => Number.isFinite(Number(v))) ||
      !(high > low) || !(rangeHigh > rangeLow)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'invalid_ohlc_or_range', diagnostics };
  }

  const insideRange = close < rangeHigh && close > rangeLow;
  const candleRange = high - low;
  const bodyAtr = Math.abs(close - open) / cfg.m5Atr;
  const closeLocation = (close - low) / candleRange;
  const upperWickAtr = (high - Math.max(open, close)) / cfg.m5Atr;
  const lowerWickAtr = (Math.min(open, close) - low) / cfg.m5Atr;
  const sweptHighByAtr = (high - rangeHigh) / cfg.m5Atr;
  const sweptLowByAtr = (rangeLow - low) / cfg.m5Atr;
  diagnostics.range_high = rangeHigh;
  diagnostics.range_low = rangeLow;
  diagnostics.range_width_atr = (rangeHigh - rangeLow) / cfg.m5Atr;
  diagnostics.swept_high_atr = sweptHighByAtr;
  diagnostics.swept_low_atr = sweptLowByAtr;
  diagnostics.confirmation_body_atr = bodyAtr;
  diagnostics.confirmation_close_location = closeLocation;
  diagnostics.upper_wick_atr = upperWickAtr;
  diagnostics.lower_wick_atr = lowerWickAtr;
  diagnostics.inside_range_close = insideRange;

  if (!insideRange) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'failed_breakout_did_not_close_inside', diagnostics };
  }
  if (bodyAtr < cfg.minBodyAtr) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'reversal_body_too_small', diagnostics };
  }

  const sweptHigh = sweptHighByAtr >= cfg.minSweepAtr;
  const sweptLow = sweptLowByAtr >= cfg.minSweepAtr;
  if (sweptHigh && sweptLow) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'ambiguous_double_sweep', diagnostics };
  }

  let side = null;
  if (sweptLow && close > open &&
      lowerWickAtr >= cfg.minRejectionWickAtr &&
      closeLocation >= cfg.minCloseLocationBuy) {
    side = 'BUY';
  } else if (sweptHigh && close < open &&
      upperWickAtr >= cfg.minRejectionWickAtr &&
      closeLocation <= cfg.maxCloseLocationSell) {
    side = 'SELL';
  }
  if (!side) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'sweep_rejection_not_confirmed', diagnostics };
  }

  const entryReference = close;
  const stop = side === 'BUY'
    ? low - cfg.stopBufferAtr * cfg.m5Atr
    : high + cfg.stopBufferAtr * cfg.m5Atr;
  const stopDistance = Math.abs(entryReference - stop);
  const stopAtr = stopDistance / cfg.m5Atr;
  diagnostics.entry_reference = entryReference;
  diagnostics.stop_atr = stopAtr;
  diagnostics.stop_buffer_atr = cfg.stopBufferAtr;
  diagnostics.take_profit_r = cfg.takeProfitR;
  if (!(stop > 0) || !(stopDistance > 0) ||
      stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'stop_distance_filter', diagnostics };
  }

  const target = side === 'BUY'
    ? entryReference + cfg.takeProfitR * stopDistance
    : entryReference - cfg.takeProfitR * stopDistance;
  return {
    candidate: side,
    trend: 'RANGE',
    setup_type: 'M5_FAILED_BREAKOUT_REVERSAL_V1',
    entry_reference: entryReference,
    stop_loss: stop,
    take_profit: target,
    risk_reward: cfg.takeProfitR,
    diagnostics,
    reason: 'failed_breakout_reversal_confirmed'
  };
}
