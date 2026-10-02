function num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeBars(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((b) => ({
      time: num(b?.time),
      open: num(b?.open),
      high: num(b?.high),
      low: num(b?.low),
      close: num(b?.close),
      volume: num(b?.volume)
    }))
    .filter((b) => b.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(-80);
}

function sortBarsAscending(bars) {
  return [...bars].sort((a, b) => a.time - b.time);
}

function emaLast(values, period) {
  const alpha = 2 / (period + 1);
  let prev = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    prev = prev === null ? value : alpha * value + (1 - alpha) * prev;
  }
  return prev;
}

function maxHigh(bars) {
  return bars.reduce((max, b) => Math.max(max, b.high), -Infinity);
}

function minLow(bars) {
  return bars.reduce((min, b) => Math.min(min, b.low), Infinity);
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : 0;
}

export function normalizeEurUsdFeatures(input = {}) {
  const bid = num(input.bid);
  const ask = num(input.ask);
  const rawSpread = num(input.spread);
  const spread = rawSpread > 0 ? rawSpread : Math.max(0, ask - bid);
  return {
    bid,
    ask,
    point: num(input.point),
    spread,
    spreadPoints: num(
      input.spread_points,
      input.spread_points === undefined && num(input.point) > 0 ? spread / num(input.point) : 0
    ),
    barTime: num(input.bar_time),
    m15: {
      ema20: num(input.m15?.ema20),
      ema50: num(input.m15?.ema50),
      rsi14: num(input.m15?.rsi14),
      atr14: num(input.m15?.atr14)
    },
    h1: {
      close: num(input.h1?.close),
      ema20: num(input.h1?.ema20),
      ema50: num(input.h1?.ema50),
      ema200: num(input.h1?.ema200),
      rsi14: num(input.h1?.rsi14),
      atr14: num(input.h1?.atr14)
    },
    recentM15: normalizeBars(input.recent_m15),
    recentH1: normalizeBars(input.recent_h1)
  };
}

export function validateEurUsdFeatures(f) {
  const errors = [];
  if (!(f.bid > 0) || !(f.ask > 0)) errors.push('invalid_price');
  if (f.ask < f.bid) errors.push('ask_below_bid');
  if (!(f.point > 0)) errors.push('missing_point');
  if (!(f.spread >= 0)) errors.push('invalid_spread');
  if (!(f.spreadPoints >= 0)) errors.push('invalid_spread_points');
  if (!(f.barTime > 0)) errors.push('missing_bar_time');

  const required = [
    ['m15.ema20', f.m15?.ema20],
    ['m15.ema50', f.m15?.ema50],
    ['m15.rsi14', f.m15?.rsi14],
    ['m15.atr14', f.m15?.atr14],
    ['h1.close', f.h1?.close],
    ['h1.ema20', f.h1?.ema20],
    ['h1.ema50', f.h1?.ema50],
    ['h1.ema200', f.h1?.ema200],
    ['h1.rsi14', f.h1?.rsi14],
    ['h1.atr14', f.h1?.atr14]
  ];
  for (const [name, value] of required) {
    if (!(Number(value) > 0) && !name.endsWith('rsi14')) errors.push(`invalid_${name}`);
  }
  if (f.m15.rsi14 < 0 || f.m15.rsi14 > 100) errors.push('invalid_m15_rsi');
  if (f.h1.rsi14 < 0 || f.h1.rsi14 > 100) errors.push('invalid_h1_rsi');

  if (f.recentM15.length < 7) errors.push('insufficient_recent_m15_bars');
  if (f.recentM15.length > 0) {
    const latestM15 = f.recentM15[f.recentM15.length - 1];
    if (latestM15.time !== f.barTime) errors.push('m15_bar_time_mismatch');
    if (f.recentM15.length > 1) {
      const latestDelta = latestM15.time - f.recentM15[f.recentM15.length - 2].time;
      if (latestDelta !== 900) errors.push('latest_m15_bars_not_15_minutes_apart');
    }
  }
  for (const [i, b] of f.recentM15.entries()) {
    if (!(b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close)) {
      errors.push(`invalid_recent_m15_bar_${i}`);
    }
  }
  for (const [i, b] of f.recentH1.entries()) {
    if (!(b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close)) {
      errors.push(`invalid_recent_h1_bar_${i}`);
    }
  }
  if (f.ask > 0 && f.bid > 0 && f.spread > 0) {
    const mismatch = Math.abs((f.ask - f.bid) - f.spread);
    if (mismatch > Math.max(f.point * 2, 1e-10)) errors.push('spread_price_mismatch');
  }
  return errors;
}

export function eurUsdH1Trend(f) {
  const h = f.h1;
  const up = h.close > 0 && h.ema20 > h.ema50 && h.ema50 > h.ema200 && h.close >= h.ema20;
  const down = h.close > 0 && h.ema20 < h.ema50 && h.ema50 < h.ema200 && h.close <= h.ema20;
  if (up) return 'UP';
  if (down) return 'DOWN';
  return 'RANGE';
}

function rsiInBuyContinuationZone(rsi, min, max) {
  return rsi >= min && rsi <= max;
}

function rsiInSellContinuationZone(rsi, min, max) {
  return rsi >= min && rsi <= max;
}

/**
 * High-quality EURUSD M15 range-breakout setup.
 *
 * The technical engine is deliberately deterministic:
 * - H1 EMA20/50/200 must establish a clear trend.
 * - The latest completed M15 candle must break a compact recent range.
 * - Breakout penetration, candle body, close location and (when available) tick volume
 *   must confirm that this is more than a one-tick/one-pip probe.
 * - Spread, stop distance and spread-to-target economics must remain acceptable.
 *
 * The AI layer is intentionally NOT used here; it is an environment filter downstream.
 */
export function buildEurUsdTrendPullbackSetup(f, options = {}) {
  const primary = buildEurUsdSetup(f, options);
  if (primary.candidate !== 'WAIT') return primary;

  if (String(options.pullbackEnabled ?? process.env.EURUSD_PULLBACK_ENABLED ?? 'false').toLowerCase() === 'false') {
    return primary;
  }

  const trend = eurUsdH1Trend(f);
  if (trend !== 'UP' && trend !== 'DOWN') return primary;

  const bars = sortBarsAscending(f.recentM15);
  const atr = Number(f.m15?.atr14 || 0);
  if (!(atr > 0) || bars.length < 30) return primary;

  const maxAge = Math.max(2, Math.floor(Number(options.pullbackMaxAgeBars ?? process.env.EURUSD_PULLBACK_MAX_AGE_BARS ?? 5)));
  const emaToleranceAtr = Math.max(0.05, Number(options.pullbackEmaToleranceAtr ?? process.env.EURUSD_PULLBACK_EMA_TOLERANCE_ATR ?? 0.20));
  const minBodyAtr = Math.max(0.05, Number(options.pullbackMinBodyAtr ?? process.env.EURUSD_PULLBACK_MIN_BODY_ATR ?? 0.15));
  const minCloseLocation = Math.min(0.95, Math.max(0.5, Number(options.pullbackMinCloseLocation ?? process.env.EURUSD_PULLBACK_MIN_CLOSE_LOCATION ?? 0.60)));
  const minImpulseBreakAtr = Math.max(0.02, Number(options.pullbackMinImpulseBreakAtr ?? process.env.EURUSD_PULLBACK_MIN_IMPULSE_BREAK_ATR ?? 0.04));
  const minVolumeRatio = Math.max(0.5, Number(options.minVolumeRatio ?? process.env.EURUSD_BREAKOUT_MIN_VOLUME_RATIO ?? 1.10));
  const requireVolume = String(options.requireVolume ?? process.env.EURUSD_BREAKOUT_REQUIRE_VOLUME ?? 'true').toLowerCase() !== 'false';
  const buyRsiMin = Math.max(1, Number(options.pullbackBuyRsiMin ?? process.env.EURUSD_PULLBACK_BUY_RSI_MIN ?? 48));
  const buyRsiMax = Math.min(99, Number(options.pullbackBuyRsiMax ?? process.env.EURUSD_PULLBACK_BUY_RSI_MAX ?? 66));
  const sellRsiMin = Math.max(1, Number(options.pullbackSellRsiMin ?? process.env.EURUSD_PULLBACK_SELL_RSI_MIN ?? 34));
  const sellRsiMax = Math.min(99, Number(options.pullbackSellRsiMax ?? process.env.EURUSD_PULLBACK_SELL_RSI_MAX ?? 52));
  const stopBufferAtr = Math.max(0.10, Number(options.pullbackStopBufferAtr ?? process.env.EURUSD_PULLBACK_STOP_BUFFER_ATR ?? 0.15));
  const minStopAtr = Math.max(0.1, Number(options.minStopAtr ?? process.env.EURUSD_MIN_STOP_ATR ?? 0.50));
  const maxStopAtr = Math.max(minStopAtr, Number(options.maxStopAtr ?? process.env.EURUSD_MAX_STOP_ATR ?? 1.50));
  const tpR = Math.max(1.2, Number(options.pullbackTakeProfitR ?? process.env.EURUSD_PULLBACK_TAKE_PROFIT_R ?? 2));

  const closes = bars.map((b) => b.close);
  const ema20Series = [];
  let ema20 = null;
  const alpha20 = 2 / 21;
  for (const close of closes) {
    ema20 = ema20 === null ? close : alpha20 * close + (1 - alpha20) * ema20;
    ema20Series.push(ema20);
  }

  const latest = bars[bars.length - 1];
  const latestEma20 = ema20Series[ema20Series.length - 1];
  const latestEma50 = emaLast(closes, 50);
  const latestRange = Math.max(0, latest.high - latest.low);
  const latestBodyAtr = latestRange > 0 ? Math.abs(latest.close - latest.open) / atr : 0;
  const latestCloseLocation = latestRange > 0 ? (latest.close - latest.low) / latestRange : 0;

  const priorVolumes = bars.slice(-9, -1).map((b) => b.volume).filter((v) => v > 0);
  const averagePriorVolume = average(priorVolumes);
  const latestVolumeAvailable = latest.volume > 0 && averagePriorVolume > 0;
  const latestVolumeRatio = averagePriorVolume > 0 ? latest.volume / averagePriorVolume : 0;
  const latestVolumeGate = !latestVolumeAvailable ? true : (requireVolume ? latestVolumeRatio >= minVolumeRatio : true);

  for (let age = 1; age <= maxAge; age++) {
    const pivotIndex = bars.length - 1 - age;
    if (pivotIndex < 4) continue;

    const pivotEma20 = ema20Series[pivotIndex];
    const touchTolerance = atr * emaToleranceAtr;
    const pullbackWindow = bars.slice(Math.max(1, pivotIndex - 2), pivotIndex + 1);

    const touched = trend === 'UP'
      ? bars[pivotIndex].low <= pivotEma20 + touchTolerance && bars[pivotIndex].close >= pivotEma20 - atr * 0.10
      : bars[pivotIndex].high >= pivotEma20 - touchTolerance && bars[pivotIndex].close <= pivotEma20 + atr * 0.10;
    if (!touched) continue;

    const counterCandle = trend === 'UP'
      ? pullbackWindow.some((b) => b.close < b.open)
      : pullbackWindow.some((b) => b.close > b.open);
    if (!counterCandle) continue;

    const triggerWindow = bars.slice(pivotIndex, bars.length - 1);
    if (!triggerWindow.length) continue;
    const triggerLevel = trend === 'UP'
      ? Math.max(...triggerWindow.map((b) => b.high))
      : Math.min(...triggerWindow.map((b) => b.low));
    const triggerBreak = trend === 'UP'
      ? latest.close >= triggerLevel + atr * minImpulseBreakAtr
      : latest.close <= triggerLevel - atr * minImpulseBreakAtr;
    if (!triggerBreak) continue;

    const aligned = trend === 'UP'
      ? latestEma20 > latestEma50 && latest.close > latestEma20 && f.m15.ema20 > f.m15.ema50
      : latestEma20 < latestEma50 && latest.close < latestEma20 && f.m15.ema20 < f.m15.ema50;
    if (!aligned) continue;

    const rsiOkay = trend === 'UP'
      ? f.m15.rsi14 >= buyRsiMin && f.m15.rsi14 <= buyRsiMax
      : f.m15.rsi14 >= sellRsiMin && f.m15.rsi14 <= sellRsiMax;
    if (!rsiOkay || latestBodyAtr < minBodyAtr || !latestVolumeGate) continue;

    if (trend === 'UP' && latestCloseLocation < minCloseLocation) continue;
    if (trend === 'DOWN' && latestCloseLocation > 1 - minCloseLocation) continue;

    const candidate = trend === 'UP' ? 'BUY' : 'SELL';
    const pullbackSwing = candidate === 'BUY'
      ? Math.min(...pullbackWindow.map((b) => b.low))
      : Math.max(...pullbackWindow.map((b) => b.high));
    const entry = candidate === 'BUY' ? f.ask : f.bid;
    const rawStop = candidate === 'BUY'
      ? pullbackSwing - atr * stopBufferAtr
      : pullbackSwing + atr * stopBufferAtr;
    const minimumStop = atr * minStopAtr;
    const stopLoss = candidate === 'BUY'
      ? Math.min(rawStop, entry - minimumStop)
      : Math.max(rawStop, entry + minimumStop);
    const stopDistance = Math.abs(entry - stopLoss);
    const stopAtr = stopDistance / atr;
    if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) continue;

    const takeProfit = candidate === 'BUY'
      ? entry + stopDistance * tpR
      : entry - stopDistance * tpR;
    const spreadToTpPct = Math.abs(takeProfit - entry) > 0
      ? (f.spread / Math.abs(takeProfit - entry)) * 100
      : Infinity;
    if (spreadToTpPct > Number(options.maxSpreadToTpPct ?? process.env.EURUSD_MAX_SPREAD_TO_TP_PCT ?? 12)) continue;

    return {
      frequency_mode: String(options.frequencyMode ?? process.env.EURUSD_FREQUENCY_MODE ?? 'balanced-weekly').toLowerCase(),
      target_trades_per_week: Math.max(0, Number(options.targetTradesPerWeek ?? process.env.EURUSD_TARGET_TRADES_PER_WEEK ?? 1)),
      candidate,
      quality_score: 95,
      setup_type: 'TREND_PULLBACK',
      trend,
      entry,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      risk_reward: tpR,
      range_high: 0,
      range_low: 0,
      range_width: 0,
      range_width_atr: 0,
      breakout_distance_atr: minImpulseBreakAtr,
      breakout_body_atr: latestBodyAtr,
      breakout_close_location: latestCloseLocation,
      volume_ratio: latestVolumeRatio,
      volume_data_available: latestVolumeAvailable,
      volume_confirmation: latestVolumeAvailable ? latestVolumeRatio >= minVolumeRatio : false,
      volume_gate_passed: latestVolumeGate,
      spread_pips: f.spread / 0.0001,
      spread_atr_pct: atr > 0 ? (f.spread / atr) * 100 : Infinity,
      spread_to_tp_pct: spreadToTpPct,
      stop_atr: stopAtr,
      pullback_ema20: latestEma20,
      pullback_swing: pullbackSwing,
      pullback_bars: age,
      reasons: []
    };
  }

  return primary;
}

export function buildEurUsdSetup(f, options = {}) {
  const frequencyMode = String(options.frequencyMode ?? process.env.EURUSD_FREQUENCY_MODE ?? 'high-quality').toLowerCase();
  const targetTradesPerWeek = Math.max(0, Number(options.targetTradesPerWeek ?? process.env.EURUSD_TARGET_TRADES_PER_WEEK ?? 1));
  const rangeLookback = Math.max(4, Math.floor(Number(options.rangeLookback ?? process.env.EURUSD_RANGE_LOOKBACK ?? 6)));
  const minRangeAtr = Math.max(0.1, Number(options.minRangeAtr ?? process.env.EURUSD_MIN_RANGE_ATR ?? 0.75));
  const maxRangeAtr = Math.max(minRangeAtr, Number(options.maxRangeAtr ?? process.env.EURUSD_MAX_RANGE_ATR ?? 2.00));
  const breakoutAtr = Math.max(0.02, Number(options.breakoutAtr ?? process.env.EURUSD_BREAKOUT_MIN_ATR ?? 0.10));
  const minBodyAtr = Math.max(0.05, Number(options.minBodyAtr ?? process.env.EURUSD_BREAKOUT_MIN_BODY_ATR ?? 0.35));
  const minCloseLocation = Math.min(0.99, Math.max(0.5, Number(options.minCloseLocation ?? process.env.EURUSD_BREAKOUT_MIN_CLOSE_LOCATION ?? 0.70)));
  const minVolumeRatio = Math.max(0.5, Number(options.minVolumeRatio ?? process.env.EURUSD_BREAKOUT_MIN_VOLUME_RATIO ?? 1.10));
  const requireVolume = String(options.requireVolume ?? process.env.EURUSD_BREAKOUT_REQUIRE_VOLUME ?? 'true').toLowerCase() !== 'false';
  const maxSpreadPips = Math.max(0.1, Number(options.maxSpreadPips ?? process.env.EURUSD_MAX_SPREAD_PIPS ?? 1.20));
  const maxSpreadAtrPct = Math.max(1, Number(options.maxSpreadAtrPct ?? process.env.EURUSD_MAX_SPREAD_ATR_PCT ?? 15));
  const minStopAtr = Math.max(0.1, Number(options.minStopAtr ?? process.env.EURUSD_MIN_STOP_ATR ?? 0.50));
  const maxStopAtr = Math.max(minStopAtr, Number(options.maxStopAtr ?? process.env.EURUSD_MAX_STOP_ATR ?? 1.50));
  const tpR = Math.max(1.2, Number(options.takeProfitR ?? process.env.EURUSD_TAKE_PROFIT_R ?? 2.00));
  const spreadToTpPctMax = Math.max(1, Number(options.maxSpreadToTpPct ?? process.env.EURUSD_MAX_SPREAD_TO_TP_PCT ?? 12));
  const buyRsiMin = Math.max(1, Number(options.buyRsiMin ?? process.env.EURUSD_BREAKOUT_BUY_RSI_MIN ?? 50));
  const buyRsiMax = Math.min(99, Number(options.buyRsiMax ?? process.env.EURUSD_BREAKOUT_BUY_RSI_MAX ?? 68));
  const sellRsiMin = Math.max(1, Number(options.sellRsiMin ?? process.env.EURUSD_BREAKOUT_SELL_RSI_MIN ?? 32));
  const sellRsiMax = Math.min(99, Number(options.sellRsiMax ?? process.env.EURUSD_BREAKOUT_SELL_RSI_MAX ?? 50));

  const trend = eurUsdH1Trend(f);
  const bars = sortBarsAscending(f.recentM15);
  if (bars.length < rangeLookback + 1) {
    return {
      frequency_mode: frequencyMode,
      target_trades_per_week: targetTradesPerWeek,
      candidate: 'WAIT',
      quality_score: 0,
      setup_type: 'NONE',
      trend,
      entry: 0,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: 0,
      range_high: 0,
      range_low: 0,
      range_width: 0,
      range_width_atr: 0,
      breakout_distance_atr: 0,
      breakout_body_atr: 0,
      breakout_close_location: 0,
      volume_ratio: 0,
      volume_confirmation: false,
      spread_pips: 0,
      spread_atr_pct: 0,
      spread_to_tp_pct: 0,
      reasons: ['insufficient_recent_m15_bars']
    };
  }

  const latest = bars[bars.length - 1];
  if (f.barTime > 0 && latest.time !== f.barTime) {
    return {
      frequency_mode: frequencyMode,
      target_trades_per_week: targetTradesPerWeek,
      candidate: 'WAIT',
      quality_score: 0,
      setup_type: 'NONE',
      trend,
      entry: 0,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: 0,
      range_high: 0,
      range_low: 0,
      range_width: 0,
      range_width_atr: 0,
      breakout_distance_atr: 0,
      breakout_body_atr: 0,
      breakout_close_location: 0,
      volume_ratio: 0,
      volume_data_available: false,
      volume_confirmation: false,
      volume_gate_passed: false,
      spread_pips: 0,
      spread_atr_pct: 0,
      spread_to_tp_pct: 0,
      stop_atr: 0,
      reasons: ['m15_bar_time_mismatch']
    };
  }
  const setupBars = bars.slice(-(rangeLookback + 1));
  if (setupBars.length < rangeLookback + 1 || setupBars.slice(1).some((bar, index) => bar.time - setupBars[index].time !== 900)) {
    return {
      frequency_mode: frequencyMode,
      target_trades_per_week: targetTradesPerWeek,
      candidate: 'WAIT',
      quality_score: 0,
      setup_type: 'NONE',
      trend,
      entry: 0,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: 0,
      range_high: 0,
      range_low: 0,
      range_width: 0,
      range_width_atr: 0,
      breakout_distance_atr: 0,
      breakout_body_atr: 0,
      breakout_close_location: 0,
      volume_ratio: 0,
      volume_data_available: false,
      volume_confirmation: false,
      volume_gate_passed: false,
      spread_pips: 0,
      spread_atr_pct: 0,
      spread_to_tp_pct: 0,
      stop_atr: 0,
      reasons: ['recent_m15_setup_bars_not_contiguous']
    };
  }
  const prior = bars.slice(-(rangeLookback + 1), -1);
  const previous = bars[bars.length - 2];

  const rangeHigh = maxHigh(prior);
  const rangeLow = minLow(prior);
  const rangeWidth = rangeHigh - rangeLow;
  const atr = f.m15.atr14;
  const rangeWidthAtr = atr > 0 ? rangeWidth / atr : Infinity;

  const pipSize = 0.0001;
  const spreadPips = f.spread / pipSize;
  const spreadAtrPct = atr > 0 ? (f.spread / atr) * 100 : Infinity;
  const spreadOkay = spreadPips <= maxSpreadPips && spreadAtrPct <= maxSpreadAtrPct;

  const candleRange = Math.max(0, latest.high - latest.low);
  const candleBody = Math.abs(latest.close - latest.open);
  const bodyAtr = atr > 0 ? candleBody / atr : 0;
  const closeLocation = candleRange > 0
    ? (latest.close - latest.low) / candleRange
    : 0;

  const priorVolumes = prior.map((b) => b.volume).filter((v) => v > 0);
  const averagePriorVolume = average(priorVolumes);
  const volumeRatio = averagePriorVolume > 0 ? latest.volume / averagePriorVolume : 0;
  const volumeDataAvailable = latest.volume > 0 && averagePriorVolume > 0;
  const volumeConfirmation = volumeDataAvailable ? volumeRatio >= minVolumeRatio : false;
  const volumeGatePassed = !volumeDataAvailable ? true : (requireVolume ? volumeConfirmation : true);

  const m15Up = f.m15.ema20 > f.m15.ema50;
  const m15Down = f.m15.ema20 < f.m15.ema50;
  const rangeCompressed = rangeWidthAtr >= minRangeAtr && rangeWidthAtr <= maxRangeAtr;
  const breakoutBuffer = atr * breakoutAtr;

  const buyBreakout =
    trend === 'UP' &&
    m15Up &&
    rsiInBuyContinuationZone(f.m15.rsi14, buyRsiMin, buyRsiMax) &&
    latest.close > rangeHigh + breakoutBuffer &&
    previous.close <= rangeHigh &&
    bodyAtr >= minBodyAtr &&
    closeLocation + 1e-9 >= minCloseLocation &&
    rangeCompressed &&
    spreadOkay &&
    volumeGatePassed;

  const sellBreakout =
    trend === 'DOWN' &&
    m15Down &&
    rsiInSellContinuationZone(f.m15.rsi14, sellRsiMin, sellRsiMax) &&
    latest.close < rangeLow - breakoutBuffer &&
    previous.close >= rangeLow &&
    bodyAtr >= minBodyAtr &&
    closeLocation - 1e-9 <= (1 - minCloseLocation) &&
    rangeCompressed &&
    spreadOkay &&
    volumeGatePassed;

  let direction = 'WAIT';
  const reasons = [];
  let score = 0;

  if (trend === 'UP' || trend === 'DOWN') score += 25;
  else reasons.push('h1_trend_not_clear');

  if ((trend === 'UP' && m15Up) || (trend === 'DOWN' && m15Down)) score += 15;
  else reasons.push('m15_ema_not_aligned');

  const rsiOkay =
    (trend === 'UP' && rsiInBuyContinuationZone(f.m15.rsi14, buyRsiMin, buyRsiMax)) ||
    (trend === 'DOWN' && rsiInSellContinuationZone(f.m15.rsi14, sellRsiMin, sellRsiMax));
  if (rsiOkay) score += 10;
  else reasons.push('m15_rsi_out_of_breakout_zone');

  if (rangeCompressed) score += 15;
  else reasons.push('range_width_outside_atr_band');

  if (spreadOkay) score += 5;
  else reasons.push('spread_filter_failed');

  const penetrationOkay =
    (trend === 'UP' && latest.close > rangeHigh + breakoutBuffer) ||
    (trend === 'DOWN' && latest.close < rangeLow - breakoutBuffer);
  if (penetrationOkay) score += 10;
  else reasons.push('breakout_penetration_too_small');

  if (bodyAtr >= minBodyAtr) score += 10;
  else reasons.push('breakout_body_too_small');

  const closeLocationOkay =
    (trend === 'UP' && closeLocation + 1e-9 >= minCloseLocation) ||
    (trend === 'DOWN' && closeLocation - 1e-9 <= 1 - minCloseLocation);
  if (closeLocationOkay) score += 5;
  else reasons.push('breakout_close_location_weak');

  if (volumeDataAvailable && volumeConfirmation) score += 5;
  else if (volumeDataAvailable) reasons.push('breakout_volume_confirmation_failed');
  else reasons.push('breakout_volume_data_unavailable_optional');

  if (buyBreakout) direction = 'BUY';
  if (sellBreakout) direction = 'SELL';

  let entry = 0;
  let stopLoss = 0;
  let takeProfit = 0;

  if (direction === 'BUY') {
    entry = f.ask;
    stopLoss = rangeLow - atr * 0.15;
  } else if (direction === 'SELL') {
    entry = f.bid;
    stopLoss = rangeHigh + atr * 0.15;
  }

  let spreadToTpPct = 0;
  let stopAtr = 0;
  if (direction !== 'WAIT') {
    const stopDistance = Math.abs(entry - stopLoss);
    stopAtr = atr > 0 ? stopDistance / atr : Infinity;
    if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
      reasons.push('stop_distance_outside_atr_band');
      direction = 'WAIT';
    } else {
      takeProfit = direction === 'BUY' ? entry + stopDistance * tpR : entry - stopDistance * tpR;
      const tpDistance = Math.abs(takeProfit - entry);
      spreadToTpPct = tpDistance > 0 ? (f.spread / tpDistance) * 100 : Infinity;
      if (spreadToTpPct > spreadToTpPctMax) {
        reasons.push('spread_too_large_vs_target');
        direction = 'WAIT';
      }
    }
  }

  const finalCandidate = direction === 'BUY' || direction === 'SELL' ? direction : 'WAIT';

  if (finalCandidate === 'WAIT') {
    return {
      candidate: 'WAIT',
      quality_score: Math.min(100, Math.max(0, score)),
      setup_type: 'NONE',
      trend,
      entry: 0,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: 0,
      range_high: rangeHigh,
      range_low: rangeLow,
      range_width: rangeWidth,
      range_width_atr: rangeWidthAtr,
      breakout_distance_atr: atr > 0
        ? (trend === 'UP' ? (latest.close - rangeHigh) : (rangeLow - latest.close)) / atr
        : 0,
      breakout_body_atr: bodyAtr,
      breakout_close_location: closeLocation,
      volume_ratio: volumeRatio,
      volume_data_available: volumeDataAvailable,
      volume_confirmation: volumeConfirmation,
      volume_gate_passed: volumeGatePassed,
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct,
      spread_to_tp_pct: 0,
      stop_atr: stopAtr,
      reasons: [...new Set(reasons)]
    };
  }

  const stopDistance = Math.abs(entry - stopLoss);
  const tpDistance = Math.abs(takeProfit - entry);
  return {
    frequency_mode: frequencyMode,
    target_trades_per_week: targetTradesPerWeek,
    candidate: finalCandidate,
    quality_score: Math.min(100, Math.max(0, score)),
    setup_type: 'BREAKOUT',
    trend,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: stopDistance > 0 ? tpDistance / stopDistance : 0,
    range_high: rangeHigh,
    range_low: rangeLow,
    range_width: rangeWidth,
    range_width_atr: rangeWidthAtr,
    breakout_distance_atr: atr > 0
      ? (finalCandidate === 'BUY' ? (latest.close - rangeHigh) : (rangeLow - latest.close)) / atr
      : 0,
    breakout_body_atr: bodyAtr,
    breakout_close_location: closeLocation,
    volume_ratio: volumeRatio,
    volume_data_available: volumeDataAvailable,
    volume_confirmation: volumeConfirmation,
    volume_gate_passed: volumeGatePassed,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    spread_to_tp_pct: spreadToTpPct,
    stop_atr: stopAtr,
    reasons: []
  };
}
