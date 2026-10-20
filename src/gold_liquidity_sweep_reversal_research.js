// Research-only countertrend entry: sweep beyond a prior range and close back inside.
// This module is available only to the offline backtester; production signal routing is unchanged.
const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function buildGoldLiquiditySweepReversalSetup(features = {}, config = {}) {
  const cfg = {
    rangeLookback: Math.min(60, Math.max(6, Math.floor(num(config.rangeLookback, 24)))),
    minSweepAtr: Math.max(0.01, num(config.minSweepAtr, 0.10)),
    closeBackAtr: Math.max(0, num(config.closeBackAtr, 0.05)),
    buyRsiMax: Math.min(50, Math.max(10, num(config.buyRsiMax, 40))),
    sellRsiMin: Math.min(90, Math.max(50, num(config.sellRsiMin, 60))),
    minCloseLocation: Math.min(0.95, Math.max(0.50, num(config.minCloseLocation, 0.60))),
    maxCloseLocation: Math.min(0.50, Math.max(0.05, num(config.maxCloseLocation, 0.40))),
    stopBufferAtr: Math.max(0, num(config.stopBufferAtr, 0.10)),
    minStopAtr: Math.max(0.1, num(config.minStopAtr, 0.50)),
    maxStopAtr: Math.max(0.2, num(config.maxStopAtr, 2.50)),
    takeProfitR: Math.max(1.0, num(config.takeProfitR, 1.50)),
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionEndUtc, 20))))
  };
  const m5 = features.m5 || {};
  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signal = bars.at(-1);
  if (!signal || bars.length < cfg.rangeLookback + 1 ||
      ![signal.time,signal.open,signal.high,signal.low,signal.close,m5.rsi14,m5.atr14].every(Number.isFinite) ||
      !(m5.atr14 > 0) || !(signal.high >= signal.low) || !(signal.high >= signal.open) ||
      !(signal.high >= signal.close) || !(signal.low <= signal.open) || !(signal.low <= signal.close)) {
    return { candidate:'WAIT', trend:'RANGE', reason:'missing_or_invalid_features' };
  }
  const hour = new Date(signal.time * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate:'WAIT', trend:'OUT_OF_SESSION', reason:'session_filter' };
  // Only completed candles strictly before the signal candle define the range.
  const prior = bars.slice(-(cfg.rangeLookback + 1), -1);
  if (prior.length !== cfg.rangeLookback || prior.some((b)=>![b.high,b.low].every(Number.isFinite))) {
    return { candidate:'WAIT', trend:'RANGE', reason:'insufficient_range_history' };
  }
  const priorHigh = Math.max(...prior.map((b)=>b.high));
  const priorLow = Math.min(...prior.map((b)=>b.low));
  const atr = m5.atr14;
  const candleRange = signal.high - signal.low;
  if (!(priorHigh > priorLow) || !(candleRange > 0)) {
    return { candidate:'WAIT', trend:'RANGE', reason:'invalid_range_geometry' };
  }
  const closeLocation = (signal.close - signal.low) / candleRange;
  const buySweepAtr = (priorLow - signal.low) / atr;
  const sellSweepAtr = (signal.high - priorHigh) / atr;
  // One-side penetration + directional body + close back inside the old range.
  const buySignal = buySweepAtr >= cfg.minSweepAtr &&
    signal.close > priorLow + cfg.closeBackAtr * atr && signal.close <= priorHigh &&
    signal.close > signal.open && closeLocation >= cfg.minCloseLocation && m5.rsi14 <= cfg.buyRsiMax;
  const sellSignal = sellSweepAtr >= cfg.minSweepAtr &&
    signal.close < priorHigh - cfg.closeBackAtr * atr && signal.close >= priorLow &&
    signal.close < signal.open && closeLocation <= cfg.maxCloseLocation && m5.rsi14 >= cfg.sellRsiMin;
  if (buySignal && sellSignal) return { candidate:'WAIT', trend:'RANGE', reason:'ambiguous_double_sweep' };
  if (!buySignal && !sellSignal) {
    return { candidate:'WAIT', trend:'RANGE',
      reason: buySweepAtr >= cfg.minSweepAtr || sellSweepAtr >= cfg.minSweepAtr
        ? 'sweep_reversal_confirmation_filter' : 'no_liquidity_sweep' };
  }
  const side = buySignal ? 'BUY' : 'SELL';
  const entryReference = signal.close;
  const stop = side === 'BUY' ? signal.low - cfg.stopBufferAtr * atr : signal.high + cfg.stopBufferAtr * atr;
  const stopDistance = Math.abs(entryReference - stop);
  const stopAtr = stopDistance / atr;
  const diagnostics = {
    prior_range_high:priorHigh, prior_range_low:priorLow, range_lookback_bars:cfg.rangeLookback,
    sweep_min_atr:cfg.minSweepAtr, buy_sweep_atr:buySweepAtr, sell_sweep_atr:sellSweepAtr,
    close_back_inside_atr:side==='BUY'?(signal.close-priorLow)/atr:(priorHigh-signal.close)/atr,
    close_location:closeLocation, m5_rsi14:m5.rsi14, stop_atr:stopAtr, entry_reference:entryReference
  };
  if (stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate:'WAIT', trend:'RANGE', reason:'stop_distance_filter', diagnostics };
  }
  const target = side === 'BUY' ? entryReference + cfg.takeProfitR * stopDistance : entryReference - cfg.takeProfitR * stopDistance;
  return { candidate:side, trend:'RANGE', setup_type:'M5_LIQUIDITY_SWEEP_CLOSE_BACK_REVERSAL',
    entry_reference:entryReference, stop_loss:stop, take_profit:target, risk_reward:cfg.takeProfitR,
    diagnostics, reason:'liquidity_sweep_reversal_confirmed' };
}
