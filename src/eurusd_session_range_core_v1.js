const n = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

function utcDayStart(time) {
  return Math.floor(Number(time) / 86400) * 86400;
}

function utcHour(time) {
  return new Date(Number(time) * 1000).getUTCHours();
}

function h1Trend(h1) {
  if (!h1 || ![h1.close, h1.ema20, h1.ema50, h1.ema200].every(Number.isFinite)) return 'RANGE';
  if (h1.close > h1.ema50 && h1.ema20 > h1.ema50 && h1.ema50 > h1.ema200) return 'UP';
  if (h1.close < h1.ema50 && h1.ema20 < h1.ema50 && h1.ema50 < h1.ema200) return 'DOWN';
  return 'RANGE';
}

export function buildEurUsdSessionRangeCore(features = {}, config = {}) {
  const cfg = {
    breakoutStartUtc: Math.min(23, Math.max(0, Math.floor(n(config.breakoutStartUtc, 7)))),
    breakoutEndUtc: Math.min(23, Math.max(0, Math.floor(n(config.breakoutEndUtc, 15)))),
    minRangeAtr: Math.max(0.05, n(config.minRangeAtr, 0.30)),
    maxRangeAtr: Math.max(0.10, n(config.maxRangeAtr, 2.50)),
    breakoutAtr: Math.max(0, n(config.breakoutAtr, 0.05)),
    breakoutBodyAtr: Math.max(0.05, n(config.breakoutBodyAtr, 0.20)),
    breakoutCloseLocation: Math.min(0.95, Math.max(0.50, n(config.breakoutCloseLocation, 0.60))),
    maxRetestBars: Math.max(1, Math.floor(n(config.maxRetestBars, 4))),
    retestToleranceAtr: Math.max(0.01, n(config.retestToleranceAtr, 0.25)),
    confirmationBufferAtr: Math.max(0, n(config.confirmationBufferAtr, 0.02)),
    confirmationBodyAtr: Math.max(0.05, n(config.confirmationBodyAtr, 0.10)),
    stopBufferAtr: Math.max(0, n(config.stopBufferAtr, 0.15)),
    minStopAtr: Math.max(0.10, n(config.minStopAtr, 0.40)),
    maxStopAtr: Math.max(0.20, n(config.maxStopAtr, 1.80)),
    takeProfitR: Math.max(1.0, n(config.takeProfitR, 1.50)),
    maxSpreadPips: Math.max(0.10, n(config.maxSpreadPips, 1.20)),
    maxSpreadAtrPct: Math.max(1, n(config.maxSpreadAtrPct, 20))
  };

  const m15 = Array.isArray(features.recentM15) ? [...features.recentM15].sort((a, b) => a.time - b.time) : [];
  const h1 = features.h1 || {};
  const latest = m15.at(-1);
  const atr = n(features.m15?.atr14);
  const spread = Math.max(0, n(features.spread));
  const trend = h1Trend(h1);

  if (!latest || m15.length < cfg.maxRetestBars + 3 || !(atr > 0)) {
    return { candidate: 'WAIT', trend, setup_type: 'NONE', reasons: ['insufficient_recent_history'] };
  }

  if (features.barTime && latest.time !== features.barTime) {
    return { candidate: 'WAIT', trend, setup_type: 'NONE', reasons: ['m15_bar_time_mismatch'] };
  }

  const recentContinuity = m15.slice(-(cfg.maxRetestBars + 3));
  for (let i = 1; i < recentContinuity.length; i += 1) {
    if (recentContinuity[i].time - recentContinuity[i - 1].time !== 900) {
      return { candidate: 'WAIT', trend, setup_type: 'NONE', reasons: ['recent_m15_setup_bars_not_contiguous'] };
    }
  }

  const signalCloseTime = latest.time;
  const hour = utcHour(signalCloseTime);
  if (hour < cfg.breakoutStartUtc || hour >= cfg.breakoutEndUtc) {
    return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', setup_type: 'NONE', reasons: ['breakout_session_filter'] };
  }

  const day = utcDayStart(latest.time - 1);
  const priorDayBars = m15.filter((b) => utcDayStart(b.time - 1) === day && utcHour(b.time) >= 0 && utcHour(b.time) < cfg.breakoutStartUtc);
  if (priorDayBars.length < 16) {
    return { candidate: 'WAIT', trend, setup_type: 'NONE', reasons: ['incomplete_session_range'] };
  }

  const rangeHigh = Math.max(...priorDayBars.map((b) => n(b.high)));
  const rangeLow = Math.min(...priorDayBars.map((b) => n(b.low)));
  const rangeWidth = rangeHigh - rangeLow;
  const rangeAtr = rangeWidth / atr;
  if (!(rangeWidth > 0) || rangeAtr < cfg.minRangeAtr || rangeAtr > cfg.maxRangeAtr) {
    return {
      candidate: 'WAIT',
      trend,
      setup_type: 'NONE',
      reasons: ['session_range_width_filter'],
      diagnostics: { range_high: rangeHigh, range_low: rangeLow, range_atr: rangeAtr }
    };
  }

  const breakout = latest;
  const previous = m15.at(-2);
  const candleRange = breakout.high - breakout.low;
  const bodyAtr = Math.abs(breakout.close - breakout.open) / atr;
  const closeLocation = candleRange > 0 ? (breakout.close - breakout.low) / candleRange : 0;

  const buyBreak =
    trend === 'UP' &&
    previous.close <= rangeHigh &&
    breakout.close >= rangeHigh + cfg.breakoutAtr * atr &&
    breakout.close > breakout.open &&
    bodyAtr >= cfg.breakoutBodyAtr &&
    closeLocation >= cfg.breakoutCloseLocation;

  const sellBreak =
    trend === 'DOWN' &&
    previous.close >= rangeLow &&
    breakout.close <= rangeLow - cfg.breakoutAtr * atr &&
    breakout.close < breakout.open &&
    bodyAtr >= cfg.breakoutBodyAtr &&
    closeLocation <= 1 - cfg.breakoutCloseLocation;

  if (!buyBreak && !sellBreak) {
    return {
      candidate: 'WAIT',
      trend,
      setup_type: 'NONE',
      reasons: ['breakout_trigger_filter'],
      diagnostics: {
        range_high: rangeHigh,
        range_low: rangeLow,
        range_atr: rangeAtr,
        breakout_body_atr: bodyAtr,
        breakout_close_location: closeLocation
      }
    };
  }

  const side = buyBreak ? 'BUY' : 'SELL';
  const level = side === 'BUY' ? rangeHigh : rangeLow;
  const end = Math.min(m15.length - 1, m15.length - 1);
  let confirmationIndex = -1;
  const retestBars = [];

  for (let i = 1; i <= cfg.maxRetestBars; i += 1) {
    const index = m15.length - 1 - cfg.maxRetestBars + i;
    if (index <= 0 || index >= end) continue;
    const b = m15[index];
    const touch = side === 'BUY'
      ? b.low <= level + cfg.retestToleranceAtr * atr
      : b.high >= level - cfg.retestToleranceAtr * atr;
    if (touch) retestBars.push(b);

    const body = Math.abs(b.close - b.open) / atr;
    const confirmed = side === 'BUY'
      ? touch && b.close >= level + cfg.confirmationBufferAtr * atr && b.close > b.open && body >= cfg.confirmationBodyAtr
      : touch && b.close <= level - cfg.confirmationBufferAtr * atr && b.close < b.open && body >= cfg.confirmationBodyAtr;

    if (confirmed) {
      confirmationIndex = index;
      break;
    }
  }

  if (confirmationIndex < 0) {
    return {
      candidate: 'WAIT',
      trend: side === 'BUY' ? 'UP' : 'DOWN',
      setup_type: 'NONE',
      reasons: ['retest_confirmation_filter'],
      diagnostics: { range_high: rangeHigh, range_low: rangeLow, range_atr: rangeAtr, breakout_time: breakout.time }
    };
  }

  const relevantRetests = m15.slice(m15.length - cfg.maxRetestBars, confirmationIndex + 1).filter(Boolean);
  const retestLow = Math.min(...(relevantRetests.length ? relevantRetests : retestBars).map((b) => b.low));
  const retestHigh = Math.max(...(relevantRetests.length ? relevantRetests : retestBars).map((b) => b.high));

  const ref = m15[confirmationIndex];
  const stop = side === 'BUY'
    ? retestLow - cfg.stopBufferAtr * n(ref.atr14, atr)
    : retestHigh + cfg.stopBufferAtr * n(ref.atr14, atr);
  const entry = side === 'BUY' ? n(features.ask, ref.close) : n(features.bid, ref.close);
  const stopDistance = Math.abs(entry - stop);
  const stopAtr = stopDistance / atr;
  const spreadPips = spread / 0.0001;
  const spreadAtrPct = spread / atr * 100;

  if (spreadPips > cfg.maxSpreadPips || spreadAtrPct > cfg.maxSpreadAtrPct) {
    return { candidate: 'WAIT', trend: side === 'BUY' ? 'UP' : 'DOWN', setup_type: 'NONE', reasons: ['spread_filter_failed'] };
  }

  if (!(stopDistance > 0) || stopAtr < cfg.minStopAtr || stopAtr > cfg.maxStopAtr) {
    return { candidate: 'WAIT', trend: side === 'BUY' ? 'UP' : 'DOWN', setup_type: 'NONE', reasons: ['stop_distance_outside_atr_band'] };
  }

  const target = side === 'BUY'
    ? entry + stopDistance * cfg.takeProfitR
    : entry - stopDistance * cfg.takeProfitR;

  return {
    candidate: side,
    trend: side === 'BUY' ? 'UP' : 'DOWN',
    setup_type: 'EURUSD_UTC_SESSION_RANGE_BREAKOUT_RETEST',
    entry_reference: entry,
    stop_loss: stop,
    take_profit: target,
    risk_reward: cfg.takeProfitR,
    signal_time: ref.time,
    diagnostics: {
      range_high: rangeHigh,
      range_low: rangeLow,
      range_atr: rangeAtr,
      breakout_time: breakout.time,
      breakout_body_atr: bodyAtr,
      breakout_close_location: closeLocation,
      retest_count: retestBars.length,
      retest_low: retestLow,
      retest_high: retestHigh,
      stop_atr: stopAtr,
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct
    },
    reasons: []
  };
}
