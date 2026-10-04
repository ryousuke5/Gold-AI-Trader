function sortBarsAscending(bars) {
  return [...bars].sort((a, b) => a.time - b.time);
}

function maxHigh(bars) {
  return bars.reduce((max, b) => Math.max(max, b.high), -Infinity);
}

function minLow(bars) {
  return bars.reduce((min, b) => Math.min(min, b.low), Infinity);
}

function trendSlopeAgreement(bars, direction) {
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
    quality_score: 0,
    setup_type: 'NONE',
    trend,
    entry: 0,
    stop_loss: 0,
    take_profit: 0,
    risk_reward: 0,
    stop_atr: 0,
    spread_to_tp_pct: 0,
    reasons: [...new Set(reasons)],
    ...diagnostics
  };
}

export function eurUsdH1TrendPullbackV2Trend(f, options = {}) {
  const h = f.h1 || {};
  const recent = sortBarsAscending(f.recentH1 || []).slice(-6);
  const minAgreement = Number(options.minH1Agreement ?? process.env.EURUSD_PULLBACK_V2_MIN_H1_AGREEMENT ?? 0.6666667);
  const buyRsiMin = Number(options.h1BuyRsiMin ?? process.env.EURUSD_PULLBACK_V2_H1_BUY_RSI_MIN ?? 52);
  const buyRsiMax = Number(options.h1BuyRsiMax ?? process.env.EURUSD_PULLBACK_V2_H1_BUY_RSI_MAX ?? 68);
  const sellRsiMin = Number(options.h1SellRsiMin ?? process.env.EURUSD_PULLBACK_V2_H1_SELL_RSI_MIN ?? 32);
  const sellRsiMax = Number(options.h1SellRsiMax ?? process.env.EURUSD_PULLBACK_V2_H1_SELL_RSI_MAX ?? 48);

  const up = h.close > h.ema50 && h.ema20 > h.ema50 && h.ema50 > h.ema200 &&
    h.rsi14 >= buyRsiMin && h.rsi14 <= buyRsiMax &&
    trendSlopeAgreement(recent, 'UP') >= minAgreement;
  const down = h.close < h.ema50 && h.ema20 < h.ema50 && h.ema50 < h.ema200 &&
    h.rsi14 >= sellRsiMin && h.rsi14 <= sellRsiMax &&
    trendSlopeAgreement(recent, 'DOWN') >= minAgreement;

  if (up) return 'UP';
  if (down) return 'DOWN';
  return 'RANGE';
}

export function buildEurUsdTrendPullbackSetupV2(f, options = {}) {
  const lookback = Math.max(7, Math.floor(Number(options.lookback ?? process.env.EURUSD_PULLBACK_V2_LOOKBACK ?? 8)));
  const minRetraceRatio = Number(options.minRetraceRatio ?? process.env.EURUSD_PULLBACK_V2_MIN_RETRACE_RATIO ?? 0.25);
  const maxRetraceRatio = Number(options.maxRetraceRatio ?? process.env.EURUSD_PULLBACK_V2_MAX_RETRACE_RATIO ?? 0.80);
  const minImpulseAtr = Number(options.minImpulseAtr ?? process.env.EURUSD_PULLBACK_V2_MIN_IMPULSE_ATR ?? 0.50);
  const minPullbackAtr = Number(options.minPullbackAtr ?? process.env.EURUSD_PULLBACK_V2_MIN_PULLBACK_ATR ?? 0.10);
  const touchBufferAtr = Number(options.touchBufferAtr ?? process.env.EURUSD_PULLBACK_V2_TOUCH_BUFFER_ATR ?? 0.20);
  const structureBufferAtr = Number(options.structureBufferAtr ?? process.env.EURUSD_PULLBACK_V2_STRUCTURE_BUFFER_ATR ?? 0.15);
  const minBodyAtr = Number(options.minBodyAtr ?? process.env.EURUSD_PULLBACK_V2_MIN_BODY_ATR ?? 0.35);
  const maxBodyAtr = Number(options.maxBodyAtr ?? process.env.EURUSD_PULLBACK_V2_MAX_BODY_ATR ?? 1.40);
  const minCloseLocation = Number(options.minCloseLocation ?? process.env.EURUSD_PULLBACK_V2_MIN_CLOSE_LOCATION ?? 0.70);
  const triggerBufferAtr = Number(options.triggerBufferAtr ?? process.env.EURUSD_PULLBACK_V2_TRIGGER_BUFFER_ATR ?? 0.03);
  const maxH1ExtensionAtr = Number(options.maxH1ExtensionAtr ?? process.env.EURUSD_PULLBACK_V2_MAX_H1_EXTENSION_ATR ?? 2.00);
  const maxSpreadPips = Number(options.maxSpreadPips ?? process.env.EURUSD_MAX_SPREAD_PIPS ?? 1.20);
  const maxSpreadAtrPct = Number(options.maxSpreadAtrPct ?? process.env.EURUSD_MAX_SPREAD_ATR_PCT ?? 15);
  const minStopAtr = Number(options.minStopAtr ?? process.env.EURUSD_MIN_STOP_ATR ?? 0.60);
  const maxStopAtr = Number(options.maxStopAtr ?? process.env.EURUSD_MAX_STOP_ATR ?? 1.40);
  const takeProfitR = Number(options.takeProfitR ?? process.env.EURUSD_PULLBACK_V2_TAKE_PROFIT_R ?? 1.80);
  const maxSpreadToTpPct = Number(options.maxSpreadToTpPct ?? process.env.EURUSD_MAX_SPREAD_TO_TP_PCT ?? 12);
  const minH1Agreement = Number(options.minH1Agreement ?? process.env.EURUSD_PULLBACK_V2_MIN_H1_AGREEMENT ?? 0.6666667);
  const h1BuyRsiMin = Number(options.h1BuyRsiMin ?? process.env.EURUSD_PULLBACK_V2_H1_BUY_RSI_MIN ?? 52);
  const h1BuyRsiMax = Number(options.h1BuyRsiMax ?? process.env.EURUSD_PULLBACK_V2_H1_BUY_RSI_MAX ?? 68);
  const h1SellRsiMin = Number(options.h1SellRsiMin ?? process.env.EURUSD_PULLBACK_V2_H1_SELL_RSI_MIN ?? 32);
  const h1SellRsiMax = Number(options.h1SellRsiMax ?? process.env.EURUSD_PULLBACK_V2_H1_SELL_RSI_MAX ?? 48);
  const m15BuyRsiMin = Number(options.buyRsiMin ?? process.env.EURUSD_PULLBACK_V2_M15_BUY_RSI_MIN ?? 52);
  const m15BuyRsiMax = Number(options.buyRsiMax ?? process.env.EURUSD_PULLBACK_V2_M15_BUY_RSI_MAX ?? 68);
  const m15SellRsiMin = Number(options.sellRsiMin ?? process.env.EURUSD_PULLBACK_V2_M15_SELL_RSI_MIN ?? 32);
  const m15SellRsiMax = Number(options.sellRsiMax ?? process.env.EURUSD_PULLBACK_V2_M15_SELL_RSI_MAX ?? 48);

  const trend = eurUsdH1TrendPullbackV2Trend(f, {
    minH1Agreement, h1BuyRsiMin, h1BuyRsiMax, h1SellRsiMin, h1SellRsiMax
  });
  const bars = sortBarsAscending(f.recentM15 || []);
  if (bars.length < lookback + 1) return waitResult(trend, ['insufficient_recent_m15_bars']);
  const latest = bars[bars.length - 1];
  if (f.barTime > 0 && latest.time !== f.barTime) return waitResult(trend, ['m15_bar_time_mismatch']);

  const active = bars.slice(-(lookback + 1));
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
  const spreadOkay = spreadPips <= maxSpreadPips && spreadAtrPct <= maxSpreadAtrPct;
  if (!spreadOkay) return waitResult(trend, ['spread_filter_failed'], { spread_pips: spreadPips, spread_atr_pct: spreadAtrPct });

  const h1Recent = sortBarsAscending(f.recentH1 || []).slice(-6);
  const h1Agreement = trend === 'UP' ? trendSlopeAgreement(h1Recent, 'UP') :
    trend === 'DOWN' ? trendSlopeAgreement(h1Recent, 'DOWN') : 0;
  const h1Extension = f.h1.atr14 > 0 ? Math.abs(f.h1.close - f.h1.ema50) / f.h1.atr14 : Infinity;
  if (!(h1Extension <= maxH1ExtensionAtr)) {
    return waitResult(trend, ['h1_overextended'], { h1_slope_agreement: h1Agreement, h1_extension_atr: h1Extension });
  }

  const preTrigger = active.slice(0, -1);
  const split = Math.max(3, Math.floor(preTrigger.length / 2));
  const impulse = preTrigger.slice(0, split);
  const pullback = preTrigger.slice(split);
  if (impulse.length < 3 || pullback.length < 3) return waitResult(trend, ['invalid_pullback_window']);

  const impulseHigh = maxHigh(impulse);
  const impulseLow = minLow(impulse);
  const impulseRange = impulseHigh - impulseLow;
  if (!(impulseRange > 0)) return waitResult(trend, ['invalid_impulse_range']);

  const impulseNetAtr = (impulse[impulse.length - 1].close - impulse[0].open) / atr;
  const pullbackNetAtr = (pullback[pullback.length - 1].close - pullback[0].close) / atr;

  const retraceBuy = (impulseHigh - minLow(pullback)) / impulseRange;
  const retraceSell = (maxHigh(pullback) - impulseLow) / impulseRange;

  const touchBuy = pullback.some(b => b.low <= f.m15.ema20 + atr * touchBufferAtr);
  const touchSell = pullback.some(b => b.high >= f.m15.ema20 - atr * touchBufferAtr);
  const heldBuy = minLow(pullback) > f.m15.ema50 - atr * structureBufferAtr;
  const heldSell = maxHigh(pullback) < f.m15.ema50 + atr * structureBufferAtr;

  const oppositeBuyCloses = pullback.filter((b, i) => i > 0 && b.close < pullback[i - 1].close).length;
  const oppositeSellCloses = pullback.filter((b, i) => i > 0 && b.close > pullback[i - 1].close).length;

  const prev = preTrigger[preTrigger.length - 1];
  const candleRange = Math.max(0, latest.high - latest.low);
  const bodyAtr = Math.abs(latest.close - latest.open) / atr;
  const closeLocation = candleRange > 0 ? (latest.close - latest.low) / candleRange : 0;

  const buyTrigger =
    trend === 'UP' &&
    f.m15.ema20 > f.m15.ema50 &&
    f.m15.rsi14 >= m15BuyRsiMin && f.m15.rsi14 <= m15BuyRsiMax &&
    impulseNetAtr >= minImpulseAtr &&
    pullbackNetAtr <= -minPullbackAtr &&
    oppositeBuyCloses >= 2 &&
    touchBuy && heldBuy &&
    retraceBuy >= minRetraceRatio && retraceBuy <= maxRetraceRatio &&
    latest.close > prev.high + atr * triggerBufferAtr &&
    latest.close > f.m15.ema20 &&
    bodyAtr >= minBodyAtr && bodyAtr <= maxBodyAtr &&
    closeLocation >= minCloseLocation;

  const sellTrigger =
    trend === 'DOWN' &&
    f.m15.ema20 < f.m15.ema50 &&
    f.m15.rsi14 >= m15SellRsiMin && f.m15.rsi14 <= m15SellRsiMax &&
    impulseNetAtr <= -minImpulseAtr &&
    pullbackNetAtr >= minPullbackAtr &&
    oppositeSellCloses >= 2 &&
    touchSell && heldSell &&
    retraceSell >= minRetraceRatio && retraceSell <= maxRetraceRatio &&
    latest.close < prev.low - atr * triggerBufferAtr &&
    latest.close < f.m15.ema20 &&
    bodyAtr >= minBodyAtr && bodyAtr <= maxBodyAtr &&
    closeLocation <= 1 - minCloseLocation;

  let direction = buyTrigger ? 'BUY' : sellTrigger ? 'SELL' : 'WAIT';
  const reasons = [];
  let score = 0;
  if (trend === 'UP' || trend === 'DOWN') score += 20; else reasons.push('h1_trend_not_clear');
  if (h1Agreement >= minH1Agreement) score += 10; else reasons.push('h1_slope_agreement_weak');
  if ((trend === 'UP' && f.m15.ema20 > f.m15.ema50) || (trend === 'DOWN' && f.m15.ema20 < f.m15.ema50)) score += 10; else reasons.push('m15_ema_alignment_failed');
  if ((trend === 'UP' && impulseNetAtr >= minImpulseAtr) || (trend === 'DOWN' && impulseNetAtr <= -minImpulseAtr)) score += 10; else reasons.push('impulse_quality_failed');
  if ((trend === 'UP' && pullbackNetAtr <= -minPullbackAtr) || (trend === 'DOWN' && pullbackNetAtr >= minPullbackAtr)) score += 10; else reasons.push('pullback_direction_failed');
  if ((trend === 'UP' && oppositeBuyCloses >= 2) || (trend === 'DOWN' && oppositeSellCloses >= 2)) score += 5; else reasons.push('pullback_structure_weak');
  if ((trend === 'UP' && touchBuy && heldBuy && retraceBuy >= minRetraceRatio && retraceBuy <= maxRetraceRatio) ||
      (trend === 'DOWN' && touchSell && heldSell && retraceSell >= minRetraceRatio && retraceSell <= maxRetraceRatio)) score += 15; else reasons.push('pullback_quality_failed');
  if (bodyAtr >= minBodyAtr && bodyAtr <= maxBodyAtr) score += 5; else reasons.push('trigger_body_outside_atr_band');
  if ((trend === 'UP' && closeLocation >= minCloseLocation) || (trend === 'DOWN' && closeLocation <= 1 - minCloseLocation)) score += 5; else reasons.push('trigger_close_location_weak');
  if ((trend === 'UP' && f.m15.rsi14 >= m15BuyRsiMin && f.m15.rsi14 <= m15BuyRsiMax) ||
      (trend === 'DOWN' && f.m15.rsi14 >= m15SellRsiMin && f.m15.rsi14 <= m15SellRsiMax)) score += 5; else reasons.push('m15_rsi_outside_continuation_zone');
  if (spreadOkay) score += 5; else reasons.push('spread_filter_failed');

  if (direction === 'WAIT') {
    return waitResult(trend, reasons, {
      quality_score: Math.min(100, score),
      h1_slope_agreement: h1Agreement,
      h1_extension_atr: h1Extension,
      impulse_net_atr: impulseNetAtr,
      pullback_net_atr: pullbackNetAtr,
      retrace_buy: retraceBuy,
      retrace_sell: retraceSell,
      trigger_body_atr: bodyAtr,
      trigger_close_location: closeLocation,
      pullback_bars: pullback.length,
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct
    });
  }

  let entry = direction === 'BUY' ? Number(f.ask) : Number(f.bid);
  const stopLoss = direction === 'BUY'
    ? minLow(pullback) - atr * structureBufferAtr
    : maxHigh(pullback) + atr * structureBufferAtr;
  const stopDistance = Math.abs(entry - stopLoss);
  const stopAtr = stopDistance / atr;

  if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
    return waitResult(trend, [...reasons, 'stop_distance_outside_atr_band'], {
      quality_score: Math.min(100, score),
      stop_atr: stopAtr
    });
  }

  const takeProfit = direction === 'BUY'
    ? entry + stopDistance * takeProfitR
    : entry - stopDistance * takeProfitR;
  const tpDistance = Math.abs(takeProfit - entry);
  const spreadToTpPct = tpDistance > 0 ? spread / tpDistance * 100 : Infinity;
  if (spreadToTpPct > maxSpreadToTpPct) {
    return waitResult(trend, [...reasons, 'spread_too_large_vs_target'], {
      quality_score: Math.min(100, score),
      stop_atr: stopAtr,
      spread_to_tp_pct: spreadToTpPct
    });
  }

  if (score < 95) {
    return waitResult(trend, [...reasons, 'quality_score_below_threshold'], {
      quality_score: Math.min(100, score),
      stop_atr: stopAtr,
      spread_to_tp_pct: spreadToTpPct
    });
  }

  return {
    candidate: direction,
    quality_score: 100,
    setup_type: 'TREND_PULLBACK_V2',
    trend,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: stopDistance > 0 ? tpDistance / stopDistance : 0,
    h1_slope_agreement: h1Agreement,
    h1_extension_atr: h1Extension,
    impulse_net_atr: impulseNetAtr,
    pullback_net_atr: pullbackNetAtr,
    retrace_buy: retraceBuy,
    retrace_sell: retraceSell,
    trigger_body_atr: bodyAtr,
    trigger_close_location: closeLocation,
    pullback_bars: pullback.length,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    spread_to_tp_pct: spreadToTpPct,
    stop_atr: stopAtr,
    reasons: []
  };
}
