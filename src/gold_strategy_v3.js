// GOLD V3: higher-frequency H1 trend + expanded M5 pullback + re-acceleration.
// Deterministic research-only strategy. It reads closed candles only and has no
// execution, persistence, network, or production-V2 side effects.
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
  // The final right candles are never eligible as pivots: confirmation must
  // already exist at the signal close, avoiding look-ahead bias.
  for (let i = left; i < bars.length - right; i++) {
    const bar = bars[i];
    if (![bar?.time, bar?.high, bar?.low].every((v) => Number.isFinite(Number(v)))) continue;
    const before = bars.slice(i - left, i);
    const after = bars.slice(i + 1, i + right + 1);
    if (!isContiguous(bars, i - left, i + right)) continue;
    if (before.every((b) => Number(bar.high) > Number(b.high)) &&
        after.every((b) => Number(bar.high) >= Number(b.high))) {
      highs.push({ index: i, price: Number(bar.high), time: Number(bar.time) });
    }
    if (before.every((b) => Number(bar.low) < Number(b.low)) &&
        after.every((b) => Number(bar.low) <= Number(b.low))) {
      lows.push({ index: i, price: Number(bar.low), time: Number(bar.time) });
    }
  }
  return { highs, lows };
}

function findImpulse({ bars, pivots, side, m5Atr, cfg }) {
  const last = bars.length - 1;
  if (side === 'BUY') {
    for (let h = pivots.highs.length - 1; h >= 0; h--) {
      const high = pivots.highs[h];
      if (last - high.index < 2 || last - high.index > cfg.maxImpulseBars) continue;
      for (let l = pivots.lows.length - 1; l >= 0; l--) {
        const low = pivots.lows[l];
        if (low.index >= high.index) continue;
        const barsApart = high.index - low.index;
        if (barsApart < cfg.minImpulseBars || barsApart > cfg.maxImpulseBars) continue;
        if (!isContiguous(bars, low.index, last)) continue;
        const range = high.price - low.price;
        if (range > 0 && range / m5Atr >= cfg.minImpulseAtr) {
          return { low, high, range, rangeAtr: range / m5Atr };
        }
      }
    }
  } else {
    for (let l = pivots.lows.length - 1; l >= 0; l--) {
      const low = pivots.lows[l];
      if (last - low.index < 2 || last - low.index > cfg.maxImpulseBars) continue;
      for (let h = pivots.highs.length - 1; h >= 0; h--) {
        const high = pivots.highs[h];
        if (high.index >= low.index) continue;
        const barsApart = low.index - high.index;
        if (barsApart < cfg.minImpulseBars || barsApart > cfg.maxImpulseBars) continue;
        if (!isContiguous(bars, high.index, last)) continue;
        const range = high.price - low.price;
        if (range > 0 && range / m5Atr >= cfg.minImpulseAtr) {
          return { high, low, range, rangeAtr: range / m5Atr };
        }
      }
    }
  }
  return null;
}

export function buildGoldV3Setup(features = {}, config = {}) {
  const cfg = {
    swingLeftBars: Math.max(1, Math.floor(num(config.swingLeftBars, 1))),
    swingRightBars: Math.max(1, Math.floor(num(config.swingRightBars, 1))),
    minImpulseBars: Math.max(2, Math.floor(num(config.minImpulseBars, 3))),
    maxImpulseBars: Math.max(6, Math.floor(num(config.maxImpulseBars, 30))),
    minImpulseAtr: Math.max(0.1, num(config.minImpulseAtr, 0.8)),
    retracementMin: clamp(num(config.retracementMin, 0.236), 0.05, 0.9),
    retracementMax: clamp(num(config.retracementMax, 0.618), 0.1, 0.95),
    pullbackLookbackBars: Math.max(1, Math.floor(num(config.pullbackLookbackBars, 3))),
    minH1RsiBuy: clamp(num(config.minH1RsiBuy, 45), 1, 99),
    maxH1RsiBuy: clamp(num(config.maxH1RsiBuy, 78), 1, 99),
    minH1RsiSell: clamp(num(config.minH1RsiSell, 22), 1, 99),
    maxH1RsiSell: clamp(num(config.maxH1RsiSell, 55), 1, 99),
    minBodyAtr: Math.max(0.05, num(config.minBodyAtr, 0.20)),
    minCloseLocationBuy: clamp(num(config.minCloseLocationBuy, 0.55), 0.5, 0.99),
    maxCloseLocationSell: clamp(num(config.maxCloseLocationSell, 0.45), 0.01, 0.5),
    stopLookbackBars: Math.max(2, Math.floor(num(config.stopLookbackBars, 5))),
    stopBufferAtr: Math.max(0, num(config.stopBufferAtr, 0.10)),
    minStopAtr: Math.max(0.1, num(config.minStopAtr, 0.25)),
    maxStopAtr: Math.max(0.2, num(config.maxStopAtr, 1.80)),
    maxExtensionAtr: Math.max(0.1, num(config.maxExtensionAtr, 1.75)),
    takeProfitR: 2.0, // fixed by V3 specification; intentionally not configurable
    sessionStartUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionStartUtc, 7)))),
    sessionEndUtc: Math.min(23, Math.max(0, Math.floor(num(config.sessionEndUtc, 20))))
  };

  if (cfg.retracementMin > cfg.retracementMax) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'invalid_v3_retracement_config' };
  }

  const m5 = features.m5 || {};
  const h1 = features.h1 || {};
  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  const signal = bars.at(-1);
  const previous = bars.at(-2);
  const required = [
    h1.close, h1.ema20, h1.ema50, h1.rsi14, h1.atr14,
    m5.ema20, m5.atr14,
    signal?.time, signal?.open, signal?.high, signal?.low, signal?.close,
    previous?.time, previous?.high, previous?.low
  ];
  if (!signal || !previous || !required.every((v) => Number.isFinite(Number(v))) ||
      !(Number(h1.atr14) > 0) || !(Number(m5.atr14) > 0)) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'missing_or_invalid_features' };
  }
  if (Number(signal.time) - Number(previous.time) !== 300 ||
      (Number.isFinite(Number(features.barTime)) && Number(features.barTime) > 0 &&
       Number(signal.time) !== Number(features.barTime))) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'm5_bar_time_mismatch_or_gap' };
  }
  if (bars.length < cfg.swingLeftBars + cfg.swingRightBars + cfg.minImpulseBars + 3) {
    return { candidate: 'WAIT', trend: 'RANGE', reason: 'insufficient_m5_history' };
  }

  const hour = new Date(Number(signal.time) * 1000).getUTCHours();
  const inSession = cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
  if (!inSession) return { candidate: 'WAIT', trend: 'OUT_OF_SESSION', reason: 'session_filter' };

  // Deliberately more permissive than V2's strict EMA20/50/200 stack.
  // No H1 EMA200 or volume confirmation is required in this frequency variant.
  const trendUp = Number(h1.close) > Number(h1.ema50) &&
    Number(h1.ema20) > Number(h1.ema50) &&
    Number(h1.rsi14) >= cfg.minH1RsiBuy && Number(h1.rsi14) <= cfg.maxH1RsiBuy;
  const trendDown = Number(h1.close) < Number(h1.ema50) &&
    Number(h1.ema20) < Number(h1.ema50) &&
    Number(h1.rsi14) >= cfg.minH1RsiSell && Number(h1.rsi14) <= cfg.maxH1RsiSell;
  if (!trendUp && !trendDown) return { candidate: 'WAIT', trend: 'RANGE', reason: 'h1_trend_filter' };

  const side = trendUp ? 'BUY' : 'SELL';
  const pivots = confirmedPivots(bars, cfg.swingLeftBars, cfg.swingRightBars);
  const impulse = findImpulse({ bars, pivots, side, m5Atr: Number(m5.atr14), cfg });
  if (!impulse) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'no_recent_confirmed_impulse' };
  }

  const lastIndex = bars.length - 1;
  const impulseEndIndex = side === 'BUY' ? impulse.high.index : impulse.low.index;
  const pullbackStart = Math.max(impulseEndIndex + 1, lastIndex - cfg.pullbackLookbackBars);
  const pullbackBars = bars.slice(pullbackStart, lastIndex);
  if (!pullbackBars.length) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'no_post_impulse_pullback' };
  }

  const pullbackExtreme = side === 'BUY'
    ? Math.min(...pullbackBars.map((bar) => Number(bar.low)))
    : Math.max(...pullbackBars.map((bar) => Number(bar.high)));
  const observedRetracement = side === 'BUY'
    ? (impulse.high.price - pullbackExtreme) / impulse.range
    : (pullbackExtreme - impulse.low.price) / impulse.range;
  const zoneTouched = observedRetracement >= cfg.retracementMin &&
    observedRetracement <= cfg.retracementMax;
  const diagnostics = {
    h1_trend_rule: 'close_vs_ema50_and_ema20_ema50_alignment',
    h1_ema200_required: false,
    volume_confirmation_required: false,
    pullback_zone_min: cfg.retracementMin,
    pullback_zone_max: cfg.retracementMax,
    observed_retracement: observedRetracement,
    impulse_range: impulse.range,
    impulse_range_atr: impulse.rangeAtr,
    impulse_low: impulse.low.price,
    impulse_high: impulse.high.price,
    impulse_low_time: impulse.low.time,
    impulse_high_time: impulse.high.time,
    impulse_bars: Math.abs(impulse.high.index - impulse.low.index),
    pullback_bars: pullbackBars.length,
    confirmed_pivot_highs: pivots.highs.length,
    confirmed_pivot_lows: pivots.lows.length,
    m5_atr: Number(m5.atr14)
  };
  if (!zoneTouched) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'expanded_pullback_zone_not_touched', diagnostics };
  }

  const candleRange = Number(signal.high) - Number(signal.low);
  const body = Math.abs(Number(signal.close) - Number(signal.open));
  if (!(candleRange > 0) || body / Number(m5.atr14) < cfg.minBodyAtr) {
    return { candidate: 'WAIT', trend: trendUp ? 'UP' : 'DOWN', reason: 'reacceleration_body_filter', diagnostics };
  }
  const closeLocation = (Number(signal.close) - Number(signal.low)) / candleRange;
  if (side === 'BUY') {
    if (!(Number(signal.close) > Number(signal.open) && Number(signal.close) > Number(previous.high))) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'bullish_reacceleration_not_confirmed', diagnostics };
    }
    if (closeLocation < cfg.minCloseLocationBuy || Number(signal.close) < Number(m5.ema20)) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'bullish_reacceleration_quality_filter', diagnostics };
    }
    if ((Number(signal.close) - Number(m5.ema20)) / Number(m5.atr14) > cfg.maxExtensionAtr) {
      return { candidate: 'WAIT', trend: 'UP', reason: 'extension_filter', diagnostics };
    }
  } else {
    if (!(Number(signal.close) < Number(signal.open) && Number(signal.close) < Number(previous.low))) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'bearish_reacceleration_not_confirmed', diagnostics };
    }
    if (closeLocation > cfg.maxCloseLocationSell || Number(signal.close) > Number(m5.ema20)) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'bearish_reacceleration_quality_filter', diagnostics };
    }
    if ((Number(m5.ema20) - Number(signal.close)) / Number(m5.atr14) > cfg.maxExtensionAtr) {
      return { candidate: 'WAIT', trend: 'DOWN', reason: 'extension_filter', diagnostics };
    }
  }

  const stopBars = bars.slice(Math.max(impulseEndIndex + 1,
    lastIndex - cfg.stopLookbackBars + 1), lastIndex + 1);
  const stop = side === 'BUY'
    ? Math.min(...stopBars.map((bar) => Number(bar.low))) - cfg.stopBufferAtr * Number(m5.atr14)
    : Math.max(...stopBars.map((bar) => Number(bar.high))) + cfg.stopBufferAtr * Number(m5.atr14);
  const entryReference = Number(signal.close);
  const stopDistance = Math.abs(entryReference - stop);
  const stopAtr = stopDistance / Number(m5.atr14);
  diagnostics.confirmation_body_atr = body / Number(m5.atr14);
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
    setup_type: 'H1_TREND_M5_EXPANDED_PULLBACK_REACCEL_V3',
    strategy_version: 'gold-h1-m5-expanded-pullback-reaccel-v3',
    entry_reference: entryReference,
    stop_loss: stop,
    take_profit: target,
    risk_reward: 2.0,
    diagnostics: {
      ...diagnostics,
      take_profit_r: 2.0,
      stop_buffer_atr: cfg.stopBufferAtr,
      stop_lookback_bars: cfg.stopLookbackBars,
      session_hour_utc: hour
    },
    reason: 'expanded_pullback_reacceleration_confirmed'
  };
}
