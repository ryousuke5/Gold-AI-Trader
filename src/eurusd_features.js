function num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function normalizeBars(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 80)
    .map((b) => ({
      time: num(b?.time),
      open: num(b?.open),
      high: num(b?.high),
      low: num(b?.low),
      close: num(b?.close),
      volume: num(b?.volume)
    }))
    .filter((b) => b.time > 0);
}

function sortBarsAscending(bars) {
  return [...bars].sort((a, b) => a.time - b.time);
}

function maxHigh(bars) {
  return bars.reduce((max, b) => Math.max(max, b.high), -Infinity);
}

function minLow(bars) {
  return bars.reduce((min, b) => Math.min(min, b.low), Infinity);
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
    spreadPoints: num(input.spread_points, input.spread_points === undefined && num(input.point) > 0 ? spread / num(input.point) : 0),
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

  if (f.recentM15.length < 6) errors.push('insufficient_recent_m15_bars');
  if (f.recentH1.length > 0) {
    for (const [i, b] of f.recentH1.entries()) {
      if (!(b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close)) {
        errors.push(`invalid_recent_h1_bar_${i}`);
      }
    }
  }
  for (const [i, b] of f.recentM15.entries()) {
    if (!(b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close)) {
      errors.push(`invalid_recent_m15_bar_${i}`);
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
  const up = h.ema20 > h.ema50 && h.ema50 > h.ema200 && (!h.close || h.close >= h.ema20);
  const down = h.ema20 < h.ema50 && h.ema50 < h.ema200 && (!h.close || h.close <= h.ema20);
  if (up) return 'UP';
  if (down) return 'DOWN';
  return 'RANGE';
}

function rsiInBuyContinuationZone(rsi) {
  return rsi >= 48 && rsi <= 68;
}

function rsiInSellContinuationZone(rsi) {
  return rsi >= 32 && rsi <= 52;
}

export function buildEurUsdSetup(f, options = {}) {
  const maxSpreadPips = Math.max(0.1, Number(options.maxSpreadPips ?? process.env.EURUSD_MAX_SPREAD_PIPS ?? 1.20));
  const maxSpreadAtrPct = Math.max(1, Number(options.maxSpreadAtrPct ?? process.env.EURUSD_MAX_SPREAD_ATR_PCT ?? 15));
  const minStopAtr = Math.max(0.1, Number(options.minStopAtr ?? process.env.EURUSD_MIN_STOP_ATR ?? 0.50));
  const maxStopAtr = Math.max(minStopAtr, Number(options.maxStopAtr ?? process.env.EURUSD_MAX_STOP_ATR ?? 1.50));
  const tpR = Math.max(1.2, Number(options.takeProfitR ?? process.env.EURUSD_TAKE_PROFIT_R ?? 2.00));
  const spreadToTpPctMax = Math.max(1, Number(options.maxSpreadToTpPct ?? process.env.EURUSD_MAX_SPREAD_TO_TP_PCT ?? 12));

  const trend = eurUsdH1Trend(f);
  const bars = sortBarsAscending(f.recentM15);
  if (bars.length < 6) {
    return {
      candidate: 'WAIT',
      quality_score: 0,
      setup_type: 'NONE',
      trend,
      entry: 0,
      stop_loss: 0,
      take_profit: 0,
      risk_reward: 0,
      spread_pips: 0,
      spread_atr_pct: 0,
      spread_to_tp_pct: 0,
      reasons: ['insufficient_recent_m15_bars']
    };
  }

  const latest = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const prior4 = bars.slice(-6, -2);
  const recent5 = bars.slice(-5, -1);
  const prior4High = maxHigh(prior4);
  const prior4Low = minLow(prior4);
  const structureLow = minLow(recent5);
  const structureHigh = maxHigh(recent5);

  const pipSize = f.point >= 0.0001 ? 0.0001 : f.point * 10;
  const spreadPips = pipSize > 0 ? f.spread / pipSize : 999;
  const spreadAtrPct = f.m15.atr14 > 0 ? (f.spread / f.m15.atr14) * 100 : 999;
  const spreadOkay = spreadPips <= maxSpreadPips && spreadAtrPct <= maxSpreadAtrPct;

  const m15Up = f.m15.ema20 > f.m15.ema50;
  const m15Down = f.m15.ema20 < f.m15.ema50;
  const buyPullback =
    m15Up &&
    previous.close <= f.m15.ema20 &&
    latest.close > f.m15.ema20 &&
    latest.close > previous.high;
  const sellPullback =
    m15Down &&
    previous.close >= f.m15.ema20 &&
    latest.close < f.m15.ema20 &&
    latest.close < previous.low;
  const buyBreakout =
    m15Up &&
    latest.close > prior4High &&
    latest.close > f.m15.ema20 &&
    Math.abs(latest.close - latest.open) >= f.m15.atr14 * 0.25;
  const sellBreakout =
    m15Down &&
    latest.close < prior4Low &&
    latest.close < f.m15.ema20 &&
    Math.abs(latest.close - latest.open) >= f.m15.atr14 * 0.25;

  let direction = 'WAIT';
  let setupType = 'NONE';
  let score = 0;
  let entry = 0;
  let stopLoss = 0;
  let takeProfit = 0;
  const reasons = [];

  if (trend === 'UP') {
    score += 30;
    if (m15Up) score += 20; else reasons.push('m15_ema_not_aligned');
    if (rsiInBuyContinuationZone(f.m15.rsi14)) score += 10; else reasons.push('m15_rsi_out_of_buy_zone');
    if (buyPullback) {
      score += 30;
      direction = 'BUY';
      setupType = 'PULLBACK_RECLAIM';
    } else if (buyBreakout) {
      score += 25;
      direction = 'BUY';
      setupType = 'BREAKOUT';
    } else {
      reasons.push('no_buy_setup');
    }
    if (h1CloseAboveTrend(f)) score += 5;
  } else if (trend === 'DOWN') {
    score += 30;
    if (m15Down) score += 20; else reasons.push('m15_ema_not_aligned');
    if (rsiInSellContinuationZone(f.m15.rsi14)) score += 10; else reasons.push('m15_rsi_out_of_sell_zone');
    if (sellPullback) {
      score += 30;
      direction = 'SELL';
      setupType = 'PULLBACK_RECLAIM';
    } else if (sellBreakout) {
      score += 25;
      direction = 'SELL';
      setupType = 'BREAKOUT';
    } else {
      reasons.push('no_sell_setup');
    }
    if (h1CloseBelowTrend(f)) score += 5;
  } else {
    reasons.push('h1_trend_not_clear');
  }

  if (spreadOkay) score += 15;
  else reasons.push('spread_filter_failed');

  if (direction === 'BUY') {
    entry = f.ask;
    stopLoss = structureLow - (f.m15.atr14 * 0.15);
  } else if (direction === 'SELL') {
    entry = f.bid;
    stopLoss = structureHigh + (f.m15.atr14 * 0.15);
  }

  if (direction !== 'WAIT') {
    const stopDistance = Math.abs(entry - stopLoss);
    const stopAtr = f.m15.atr14 > 0 ? stopDistance / f.m15.atr14 : Infinity;
    if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
      reasons.push('stop_distance_outside_atr_band');
      direction = 'WAIT';
      setupType = 'NONE';
      entry = 0;
      stopLoss = 0;
      takeProfit = 0;
    } else {
      takeProfit = direction === 'BUY' ? entry + stopDistance * tpR : entry - stopDistance * tpR;
      const tpDistance = Math.abs(takeProfit - entry);
      const spreadToTpPct = tpDistance > 0 ? (f.spread / tpDistance) * 100 : 999;
      if (spreadToTpPct > spreadToTpPctMax) {
        reasons.push('spread_too_large_vs_target');
        direction = 'WAIT';
        setupType = 'NONE';
        entry = 0;
        stopLoss = 0;
        takeProfit = 0;
      }
    }
  }

  const finalCandidate = direction !== 'WAIT' && score >= 95 ? direction : 'WAIT';
  if (direction !== 'WAIT' && finalCandidate === 'WAIT') reasons.push('setup_quality_below_threshold');

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
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct,
      spread_to_tp_pct: 0,
      reasons: [...new Set(reasons)]
    };
  }

  const stopDistance = Math.abs(entry - stopLoss);
  const tpDistance = Math.abs(takeProfit - entry);
  return {
    candidate: finalCandidate,
    quality_score: Math.min(100, Math.max(0, score)),
    setup_type: setupType,
    trend,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: stopDistance > 0 ? tpDistance / stopDistance : 0,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    spread_to_tp_pct: tpDistance > 0 ? (f.spread / tpDistance) * 100 : 999,
    reasons: []
  };
}

function h1CloseAboveTrend(f) {
  return !(f.h1.close > 0) || f.h1.close >= f.h1.ema20;
}

function h1CloseBelowTrend(f) {
  return !(f.h1.close > 0) || f.h1.close <= f.h1.ema20;
}
