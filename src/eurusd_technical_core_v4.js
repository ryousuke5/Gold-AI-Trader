function sortBars(bars) {
  return [...bars].sort((a, b) => a.time - b.time);
}

function maxHigh(bars) {
  return bars.reduce((m, b) => Math.max(m, b.high), -Infinity);
}

function minLow(bars) {
  return bars.reduce((m, b) => Math.min(m, b.low), Infinity);
}

function slopeAgreement(bars, direction) {
  if (bars.length < 3) return 0;
  let good = 0;
  for (let i = 1; i < bars.length; i += 1) {
    const delta = bars[i].close - bars[i - 1].close;
    if ((direction === 'UP' && delta > 0) || (direction === 'DOWN' && delta < 0)) good += 1;
  }
  return good / (bars.length - 1);
}

function waitResult(trend, reasons = [], diagnostics = {}) {
  return {
    candidate: 'WAIT',
    setup_type: 'NONE',
    trend,
    entry: 0,
    stop_loss: 0,
    take_profit: 0,
    risk_reward: 0,
    stop_atr: 0,
    reasons: [...new Set(reasons)],
    ...diagnostics
  };
}

export function eurUsdH1TrendTechnicalCoreV4Trend(f, options = {}) {
  const h = f.h1 || {};
  const recent = sortBars(f.recentH1 || []).slice(-6);
  const minAgreement = Number(options.minH1Agreement ?? process.env.EURUSD_CORE_V4_MIN_H1_AGREEMENT ?? 0.50);

  const up =
    h.close > h.ema50 &&
    h.ema20 > h.ema50 &&
    h.ema50 > h.ema200 &&
    slopeAgreement(recent, 'UP') >= minAgreement;

  const down =
    h.close < h.ema50 &&
    h.ema20 < h.ema50 &&
    h.ema50 < h.ema200 &&
    slopeAgreement(recent, 'DOWN') >= minAgreement;

  return up ? 'UP' : down ? 'DOWN' : 'RANGE';
}

export function buildEurUsdTechnicalCoreV4(f, options = {}) {
  const lookback = Math.max(8, Math.floor(Number(options.lookback ?? process.env.EURUSD_CORE_V4_LOOKBACK ?? 12)));
  const split = Math.max(4, Math.floor(lookback / 2));
  const minImpulseAtr = Number(options.minImpulseAtr ?? process.env.EURUSD_CORE_V4_MIN_IMPULSE_ATR ?? 0.35);
  const minPullbackAtr = Number(options.minPullbackAtr ?? process.env.EURUSD_CORE_V4_MIN_PULLBACK_ATR ?? 0.05);
  const touchBufferAtr = Number(options.touchBufferAtr ?? process.env.EURUSD_CORE_V4_TOUCH_BUFFER_ATR ?? 0.30);
  const structureBufferAtr = Number(options.structureBufferAtr ?? process.env.EURUSD_CORE_V4_STRUCTURE_BUFFER_ATR ?? 0.20);
  const triggerBufferAtr = Number(options.triggerBufferAtr ?? process.env.EURUSD_CORE_V4_TRIGGER_BUFFER_ATR ?? 0.02);
  const minBodyAtr = Number(options.minBodyAtr ?? process.env.EURUSD_CORE_V4_MIN_BODY_ATR ?? 0.20);
  const minCloseLocation = Number(options.minCloseLocation ?? process.env.EURUSD_CORE_V4_MIN_CLOSE_LOCATION ?? 0.60);
  const maxH1ExtensionAtr = Number(options.maxH1ExtensionAtr ?? process.env.EURUSD_CORE_V4_MAX_H1_EXTENSION_ATR ?? 3.00);
  const maxSpreadPips = Number(options.maxSpreadPips ?? process.env.EURUSD_MAX_SPREAD_PIPS ?? 1.20);
  const maxSpreadAtrPct = Number(options.maxSpreadAtrPct ?? process.env.EURUSD_MAX_SPREAD_ATR_PCT ?? 20);
  const minStopAtr = Number(options.minStopAtr ?? process.env.EURUSD_CORE_V4_MIN_STOP_ATR ?? 0.40);
  const maxStopAtr = Number(options.maxStopAtr ?? process.env.EURUSD_CORE_V4_MAX_STOP_ATR ?? 1.80);
  const takeProfitR = Number(options.takeProfitR ?? process.env.EURUSD_CORE_V4_TAKE_PROFIT_R ?? 1.50);

  const trend = eurUsdH1TrendTechnicalCoreV4Trend(f, options);
  const bars = sortBars(f.recentM15 || []);
  if (bars.length < lookback + 1) return waitResult(trend, ['insufficient_recent_m15_bars']);

  const latest = bars.at(-1);
  const active = bars.slice(-(lookback + 1));
  if (f.barTime > 0 && latest.time !== f.barTime) return waitResult(trend, ['m15_bar_time_mismatch']);

  for (let i = 1; i < active.length; i += 1) {
    if (active[i].time - active[i - 1].time !== 900) {
      return waitResult(trend, ['recent_m15_setup_bars_not_contiguous']);
    }
  }

  const atr = Number(f.m15?.atr14 || 0);
  if (!(atr > 0)) return waitResult(trend, ['invalid_atr']);

  const spread = Number(f.spread || 0);
  const spreadPips = spread / 0.0001;
  const spreadAtrPct = spread / atr * 100;
  if (!(spreadPips <= maxSpreadPips && spreadAtrPct <= maxSpreadAtrPct)) {
    return waitResult(trend, ['spread_filter_failed'], { spread_pips: spreadPips, spread_atr_pct: spreadAtrPct });
  }

  const h1Extension = f.h1.atr14 > 0
    ? Math.abs(f.h1.close - f.h1.ema50) / f.h1.atr14
    : Infinity;
  if (!(h1Extension <= maxH1ExtensionAtr)) {
    return waitResult(trend, ['h1_overextended'], { h1_extension_atr: h1Extension });
  }

  const structure = active.slice(0, -1);
  const impulse = structure.slice(0, split);
  const pullback = structure.slice(split);
  if (impulse.length < 3 || pullback.length < 3) return waitResult(trend, ['invalid_pullback_window']);

  const impulseHigh = maxHigh(impulse);
  const impulseLow = minLow(impulse);
  const impulseRange = impulseHigh - impulseLow;
  if (!(impulseRange > 0)) return waitResult(trend, ['invalid_impulse_range']);

  const impulseNetAtr = (impulse.at(-1).close - impulse[0].open) / atr;
  const pullbackNetAtr = (pullback.at(-1).close - pullback[0].close) / atr;

  const pullbackLow = minLow(pullback);
  const pullbackHigh = maxHigh(pullback);
  const retraceBuy = (impulseHigh - pullbackLow) / impulseRange;
  const retraceSell = (pullbackHigh - impulseLow) / impulseRange;

  const ema20 = Number(f.m15.ema20);
  const ema50 = Number(f.m15.ema50);

  const touchBuy =
    pullbackLow <= ema20 + atr * touchBufferAtr &&
    pullbackLow >= ema50 - atr * structureBufferAtr;
  const touchSell =
    pullbackHigh >= ema20 - atr * touchBufferAtr &&
    pullbackHigh <= ema50 + atr * structureBufferAtr;

  const previous = active.at(-2);
  const candleRange = Math.max(0, latest.high - latest.low);
  const bodyAtr = Math.abs(latest.close - latest.open) / atr;
  const closeLocation = candleRange > 0 ? (latest.close - latest.low) / candleRange : 0;

  const buy =
    trend === 'UP' &&
    ema20 > ema50 &&
    impulseNetAtr >= minImpulseAtr &&
    pullbackNetAtr <= -minPullbackAtr &&
    touchBuy &&
    latest.close > previous.high + atr * triggerBufferAtr &&
    latest.close > latest.open &&
    bodyAtr >= minBodyAtr &&
    closeLocation >= minCloseLocation;

  const sell =
    trend === 'DOWN' &&
    ema20 < ema50 &&
    impulseNetAtr <= -minImpulseAtr &&
    pullbackNetAtr >= minPullbackAtr &&
    touchSell &&
    latest.close < previous.low - atr * triggerBufferAtr &&
    latest.close < latest.open &&
    bodyAtr >= minBodyAtr &&
    closeLocation <= 1 - minCloseLocation;

  if (!buy && !sell) {
    return waitResult(trend, ['technical_trigger_not_met'], {
      h1_slope_agreement: trend === 'UP' ? slopeAgreement(sortBars(f.recentH1 || []).slice(-6), 'UP')
        : trend === 'DOWN' ? slopeAgreement(sortBars(f.recentH1 || []).slice(-6), 'DOWN') : 0,
      h1_extension_atr: h1Extension,
      impulse_net_atr: impulseNetAtr,
      pullback_net_atr: pullbackNetAtr,
      retrace_buy: retraceBuy,
      retrace_sell: retraceSell,
      trigger_body_atr: bodyAtr,
      trigger_close_location: closeLocation,
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct
    });
  }

  const direction = buy ? 'BUY' : 'SELL';
  const entry = direction === 'BUY' ? Number(f.ask) : Number(f.bid);
  const stopLoss = direction === 'BUY'
    ? pullbackLow - atr * structureBufferAtr
    : pullbackHigh + atr * structureBufferAtr;
  const stopDistance = Math.abs(entry - stopLoss);
  const stopAtr = stopDistance / atr;

  if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
    return waitResult(trend, ['stop_distance_outside_atr_band'], {
      impulse_net_atr: impulseNetAtr,
      pullback_net_atr: pullbackNetAtr,
      stop_atr: stopAtr
    });
  }

  const takeProfit = direction === 'BUY'
    ? entry + stopDistance * takeProfitR
    : entry - stopDistance * takeProfitR;

  return {
    candidate: direction,
    setup_type: 'EURUSD_H1_TREND_M15_PULLBACK_CORE_V4',
    trend,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: takeProfitR,
    stop_atr: stopAtr,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    h1_extension_atr: h1Extension,
    impulse_net_atr: impulseNetAtr,
    pullback_net_atr: pullbackNetAtr,
    retrace_buy: retraceBuy,
    retrace_sell: retraceSell,
    trigger_body_atr: bodyAtr,
    trigger_close_location: closeLocation,
    reasons: []
  };
}
