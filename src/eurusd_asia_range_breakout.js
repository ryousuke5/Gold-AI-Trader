const LONDON_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false
});

function londonParts(timeSeconds) {
  const parts = LONDON_FORMATTER.formatToParts(new Date(timeSeconds * 1000));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour)
  };
}

function numeric(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

export function londonSessionBucket(timeSeconds) {
  return londonParts(timeSeconds).date;
}

export function buildLondonAsiaRangeMap(bars, {
  startHour = 0,
  endHour = 6
} = {}) {
  const map = new Map();
  for (const bar of bars) {
    const local = londonParts(bar.time);
    if (local.hour < startHour || local.hour >= endHour) continue;
    const row = map.get(local.date) || {
      date: local.date,
      high: -Infinity,
      low: Infinity,
      bars: 0
    };
    row.high = Math.max(row.high, bar.high);
    row.low = Math.min(row.low, bar.low);
    row.bars++;
    map.set(local.date, row);
  }
  return map;
}

export function buildEurUsdAsiaRangeBreakoutSetup({
  signalBar,
  previousBar,
  h1Bar,
  asiaRange,
  config = {}
}) {
  const breakoutStartHour = numeric(config.breakoutStartHour ?? process.env.ASIA_BREAKOUT_START_HOUR, 7);
  const breakoutEndHour = numeric(config.breakoutEndHour ?? process.env.ASIA_BREAKOUT_END_HOUR, 12);
  const breakoutMinAtr = numeric(config.breakoutMinAtr ?? process.env.ASIA_BREAKOUT_MIN_ATR, 0.05);
  const minBodyAtr = numeric(config.minBodyAtr ?? process.env.ASIA_BREAKOUT_MIN_BODY_ATR, 0.25);
  const minCloseLocation = numeric(config.minCloseLocation ?? process.env.ASIA_BREAKOUT_MIN_CLOSE_LOCATION, 0.60);
  const buyRsiMin = numeric(config.buyRsiMin ?? process.env.ASIA_BREAKOUT_BUY_RSI_MIN, 48);
  const buyRsiMax = numeric(config.buyRsiMax ?? process.env.ASIA_BREAKOUT_BUY_RSI_MAX, 70);
  const sellRsiMin = numeric(config.sellRsiMin ?? process.env.ASIA_BREAKOUT_SELL_RSI_MIN, 30);
  const sellRsiMax = numeric(config.sellRsiMax ?? process.env.ASIA_BREAKOUT_SELL_RSI_MAX, 52);
  const minRangeAtr = numeric(config.minRangeAtr ?? process.env.ASIA_RANGE_MIN_ATR, 0.30);
  const maxRangeAtr = numeric(config.maxRangeAtr ?? process.env.ASIA_RANGE_MAX_ATR, 1.75);
  const maxSpreadPips = numeric(config.maxSpreadPips, 1.20);
  const spreadToTpMax = numeric(config.maxSpreadToTpPct, 12);
  const minStopAtr = numeric(config.minStopAtr, 0.50);
  const maxStopAtr = numeric(config.maxStopAtr, 1.50);
  const tpR = numeric(config.takeProfitR, 2);
  const spreadPips = numeric(config.spreadPips, 0.8);

  if (!signalBar || !previousBar || !h1Bar || !asiaRange || asiaRange.bars < 8) {
    return { candidate: 'WAIT', setup_type: 'NONE', reasons: ['insufficient_asia_range'] };
  }

  const local = londonParts(signalBar.time);
  if (local.hour < breakoutStartHour || local.hour >= breakoutEndHour) {
    return {
      candidate: 'WAIT',
      setup_type: 'NONE',
      trend: h1Bar.trend,
      session_hour: local.hour,
      reasons: ['outside_london_breakout_window']
    };
  }

  const atr = numeric(signalBar.atr14);
  if (!(atr > 0)) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['invalid_m15_atr'] };
  }

  const spread = spreadPips * 0.0001;
  const spreadAtrPct = spread / atr * 100;
  if (spreadPips > maxSpreadPips || spreadAtrPct > 15) {
    return {
      candidate: 'WAIT',
      setup_type: 'NONE',
      trend: h1Bar.trend,
      reasons: ['spread_filter_failed'],
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct
    };
  }

  const rangeWidth = asiaRange.high - asiaRange.low;
  const rangeWidthAtr = rangeWidth / atr;
  if (!(rangeWidthAtr >= minRangeAtr && rangeWidthAtr <= maxRangeAtr)) {
    return {
      candidate: 'WAIT',
      setup_type: 'NONE',
      trend: h1Bar.trend,
      range_high: asiaRange.high,
      range_low: asiaRange.low,
      range_width_atr: rangeWidthAtr,
      reasons: ['asia_range_width_outside_atr_band']
    };
  }

  const candleRange = Math.max(0, signalBar.high - signalBar.low);
  const bodyAtr = Math.abs(signalBar.close - signalBar.open) / atr;
  const closeLocation = candleRange > 0 ? (signalBar.close - signalBar.low) / candleRange : 0;
  const buyTrend = h1Bar.trend === 'UP' && signalBar.ema20 > signalBar.ema50;
  const sellTrend = h1Bar.trend === 'DOWN' && signalBar.ema20 < signalBar.ema50;

  const buy =
    buyTrend &&
    signalBar.rsi14 >= buyRsiMin &&
    signalBar.rsi14 <= buyRsiMax &&
    previousBar.close <= asiaRange.high &&
    signalBar.close > asiaRange.high + atr * breakoutMinAtr &&
    bodyAtr >= minBodyAtr &&
    closeLocation >= minCloseLocation;

  const sell =
    sellTrend &&
    signalBar.rsi14 >= sellRsiMin &&
    signalBar.rsi14 <= sellRsiMax &&
    previousBar.close >= asiaRange.low &&
    signalBar.close < asiaRange.low - atr * breakoutMinAtr &&
    bodyAtr >= minBodyAtr &&
    closeLocation <= 1 - minCloseLocation;

  if (h1Bar.trend !== 'UP' && h1Bar.trend !== 'DOWN') {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['h1_trend_not_directional'] };
  }
  const directionUp = h1Bar.trend === 'UP';
  const trendAligned = directionUp ? signalBar.ema20 > signalBar.ema50 : signalBar.ema20 < signalBar.ema50;
  if (!trendAligned) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['m15_ema_not_aligned'] };
  }

  const rsiOk = directionUp
    ? signalBar.rsi14 >= buyRsiMin && signalBar.rsi14 <= buyRsiMax
    : signalBar.rsi14 >= sellRsiMin && signalBar.rsi14 <= sellRsiMax;
  if (!rsiOk) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['rsi_filter_failed'] };
  }

  const priorInside = directionUp
    ? previousBar.close <= asiaRange.high
    : previousBar.close >= asiaRange.low;
  if (!priorInside) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['previous_bar_already_outside_range'] };
  }

  const breakoutOk = directionUp
    ? signalBar.close > asiaRange.high + atr * breakoutMinAtr
    : signalBar.close < asiaRange.low - atr * breakoutMinAtr;
  if (!breakoutOk) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['breakout_penetration_failed'] };
  }

  if (bodyAtr < minBodyAtr) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['breakout_body_failed'] };
  }
  const closeLocationOk = directionUp
    ? closeLocation >= minCloseLocation
    : closeLocation <= 1 - minCloseLocation;
  if (!closeLocationOk) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['close_location_failed'] };
  }

  const candidate = directionUp ? 'BUY' : 'SELL';

  const entry = candidate === 'BUY' ? signalBar.close + spread / 2 : signalBar.close - spread / 2;
  const stopLoss = candidate === 'BUY'
    ? asiaRange.low - atr * 0.15
    : asiaRange.high + atr * 0.15;
  const stopDistance = Math.abs(entry - stopLoss);
  const stopAtr = stopDistance / atr;
  if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
    return {
      candidate: 'WAIT',
      setup_type: 'NONE',
      trend: h1Bar.trend,
      reasons: ['stop_distance_outside_atr_band'],
      stop_atr: stopAtr
    };
  }

  const takeProfit = candidate === 'BUY'
    ? entry + stopDistance * tpR
    : entry - stopDistance * tpR;
  const spreadToTpPct = spread / Math.abs(takeProfit - entry) * 100;
  if (spreadToTpPct > spreadToTpMax) {
    return {
      candidate: 'WAIT',
      setup_type: 'NONE',
      trend: h1Bar.trend,
      reasons: ['spread_too_large_vs_target'],
      spread_to_tp_pct: spreadToTpPct
    };
  }

  return {
    candidate,
    setup_type: 'ASIA_RANGE_LONDON_BREAKOUT',
    trend: h1Bar.trend,
    session_date: local.date,
    session_hour: local.hour,
    range_high: asiaRange.high,
    range_low: asiaRange.low,
    range_width: rangeWidth,
    range_width_atr: rangeWidthAtr,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: tpR,
    stop_atr: stopAtr,
    breakout_distance_atr: candidate === 'BUY'
      ? (signalBar.close - asiaRange.high) / atr
      : (asiaRange.low - signalBar.close) / atr,
    body_atr: bodyAtr,
    close_location: closeLocation,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    spread_to_tp_pct: spreadToTpPct,
    reasons: []
  };
}
