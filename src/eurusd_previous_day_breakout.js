function londonParts(timeSeconds) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(new Date(timeSeconds * 1000));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour)
  };
}

function average(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function rsiBuy(rsi, min, max) {
  return rsi >= min && rsi <= max;
}

function rsiSell(rsi, min, max) {
  return rsi >= min && rsi <= max;
}

export function buildEurUsdPreviousDayBreakoutSetup({ signalBar, previousBar, h1Bar, previousDay, config = {} }) {
  const sessionStartHour = Number(config.sessionStartHour ?? process.env.PREV_DAY_SESSION_START_HOUR ?? 7);
  const sessionEndHour = Number(config.sessionEndHour ?? process.env.PREV_DAY_SESSION_END_HOUR ?? 16);
  const breakoutMinAtr = Number(config.breakoutMinAtr ?? process.env.PREV_DAY_BREAKOUT_MIN_ATR ?? 0.05);
  const minBodyAtr = Number(config.minBodyAtr ?? process.env.PREV_DAY_BREAKOUT_MIN_BODY_ATR ?? 0.25);
  const minCloseLocation = Number(config.minCloseLocation ?? process.env.PREV_DAY_BREAKOUT_MIN_CLOSE_LOCATION ?? 0.60);
  const buyRsiMin = Number(config.buyRsiMin ?? process.env.PREV_DAY_BREAKOUT_BUY_RSI_MIN ?? 48);
  const buyRsiMax = Number(config.buyRsiMax ?? process.env.PREV_DAY_BREAKOUT_BUY_RSI_MAX ?? 70);
  const sellRsiMin = Number(config.sellRsiMin ?? process.env.PREV_DAY_BREAKOUT_SELL_RSI_MIN ?? 30);
  const sellRsiMax = Number(config.sellRsiMax ?? process.env.PREV_DAY_BREAKOUT_SELL_RSI_MAX ?? 52);
  const minStopAtr = Number(config.minStopAtr ?? 0.50);
  const maxStopAtr = Number(config.maxStopAtr ?? 1.50);
  const tpR = Number(config.takeProfitR ?? 2);
  const maxSpreadPips = Number(config.maxSpreadPips ?? 1.20);
  const maxSpreadToTpPct = Number(config.maxSpreadToTpPct ?? 12);
  const spreadPips = Number(config.spreadPips ?? 0.8);

  if (!signalBar || !h1Bar || !previousDay) {
    return { candidate: 'WAIT', setup_type: 'NONE', reasons: ['missing_context'] };
  }

  const london = londonParts(signalBar.time);
  const inSession = london.hour >= sessionStartHour && london.hour < sessionEndHour;
  if (!inSession) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['outside_london_session'], session_hour: london.hour };
  }

  const atr = signalBar.atr14;
  if (!(atr > 0)) return { candidate: 'WAIT', setup_type: 'NONE', reasons: ['invalid_m15_atr'] };

  const spread = spreadPips * 0.0001;
  const spreadAtrPct = spread / atr * 100;
  if (spreadPips > maxSpreadPips || spreadAtrPct > 15) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['spread_filter_failed'], spread_pips: spreadPips, spread_atr_pct: spreadAtrPct };
  }

  const candleRange = Math.max(0, signalBar.high - signalBar.low);
  const bodyAtr = atr > 0 ? Math.abs(signalBar.close - signalBar.open) / atr : 0;
  const closeLocation = candleRange > 0 ? (signalBar.close - signalBar.low) / candleRange : 0;
  const buyTrend = h1Bar.trend === 'UP' && signalBar.ema20 > signalBar.ema50;
  const sellTrend = h1Bar.trend === 'DOWN' && signalBar.ema20 < signalBar.ema50;
  const previousInsideHigh = previousBar.close <= previousDay.high;
  const previousInsideLow = previousBar.close >= previousDay.low;

  const buy =
    buyTrend &&
    rsiBuy(signalBar.rsi14, buyRsiMin, buyRsiMax) &&
    previousInsideHigh &&
    signalBar.close > previousDay.high + atr * breakoutMinAtr &&
    bodyAtr >= minBodyAtr &&
    closeLocation >= minCloseLocation;

  const sell =
    sellTrend &&
    rsiSell(signalBar.rsi14, sellRsiMin, sellRsiMax) &&
    previousInsideLow &&
    signalBar.close < previousDay.low - atr * breakoutMinAtr &&
    bodyAtr >= minBodyAtr &&
    closeLocation <= 1 - minCloseLocation;

  let candidate = buy ? 'BUY' : sell ? 'SELL' : 'WAIT';
  if (candidate === 'WAIT') {
    return {
      candidate,
      setup_type: 'NONE',
      trend: h1Bar.trend,
      session_hour: london.hour,
      previous_day: previousDay,
      body_atr: bodyAtr,
      close_location: closeLocation,
      breakout_distance_atr: h1Bar.trend === 'UP'
        ? (signalBar.close - previousDay.high) / atr
        : (previousDay.low - signalBar.close) / atr,
      reasons: []
    };
  }

  const entry = candidate === 'BUY' ? signalBar.close + spread / 2 : signalBar.close - spread / 2;
  const stopLoss = candidate === 'BUY'
    ? previousDay.high - atr * 0.75
    : previousDay.low + atr * 0.75;
  const stopDistance = Math.abs(entry - stopLoss);
  const stopAtr = stopDistance / atr;
  if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['stop_distance_outside_atr_band'], stop_atr: stopAtr };
  }

  const takeProfit = candidate === 'BUY' ? entry + stopDistance * tpR : entry - stopDistance * tpR;
  const spreadToTpPct = spread / Math.abs(takeProfit - entry) * 100;
  if (spreadToTpPct > maxSpreadToTpPct) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Bar.trend, reasons: ['spread_too_large_vs_target'], spread_to_tp_pct: spreadToTpPct };
  }

  return {
    candidate,
    setup_type: 'PREVIOUS_DAY_BREAKOUT',
    trend: h1Bar.trend,
    session_hour: london.hour,
    previous_day: previousDay,
    range_high: previousDay.high,
    range_low: previousDay.low,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: tpR,
    stop_atr: stopAtr,
    breakout_distance_atr: candidate === 'BUY'
      ? (signalBar.close - previousDay.high) / atr
      : (previousDay.low - signalBar.close) / atr,
    body_atr: bodyAtr,
    close_location: closeLocation,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    spread_to_tp_pct: spreadToTpPct,
    reasons: []
  };
}

export function londonDayKey(timeSeconds) {
  return londonParts(timeSeconds).date;
}

export function buildPreviousTradingDayMap(bars) {
  const days = new Map();
  for (const bar of bars) {
    const day = londonDayKey(bar.time);
    const row = days.get(day) || { date: day, high: -Infinity, low: Infinity, bars: 0 };
    row.high = Math.max(row.high, bar.high);
    row.low = Math.min(row.low, bar.low);
    row.bars++;
    days.set(day, row);
  }
  return days;
}

function isLondonWeekday(date) {
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

export function latestPreviousTradingDay(dayMap, signalTime) {
  const currentDay = londonDayKey(signalTime);
  let best = null;
  for (const [date, row] of dayMap.entries()) {
    if (!isLondonWeekday(date)) continue;
    if (date < currentDay && row.bars > 0 && (!best || date > best.date)) best = row;
  }
  return best;
}

export function scorePreviousDaySetup(setup) {
  if (setup.candidate === 'WAIT') return 0;
  let score = 0;
  if (setup.trend === 'UP' || setup.trend === 'DOWN') score += 25;
  if (setup.breakout_distance_atr >= 0.05) score += 20;
  if (setup.body_atr >= 0.25) score += 20;
  if (setup.risk_reward >= 2) score += 20;
  if (setup.spread_to_tp_pct <= 12) score += 15;
  return score;
}
