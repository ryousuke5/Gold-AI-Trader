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

function waitResult(trend, reasons = []) {
  return {
    candidate: 'WAIT',
    quality_score: 0,
    setup_type: 'NONE',
    trend,
    entry: 0,
    stop_loss: 0,
    take_profit: 0,
    risk_reward: 0,
    spread_to_tp_pct: 0,
    stop_atr: 0,
    reasons: [...new Set(reasons)]
  };
}

export function eurUsdH1PullbackTrend(f) {
  const h = f.h1 || {};
  const recent = sortBarsAscending(f.recentH1 || []).slice(-6);
  const up = h.close > h.ema50 && h.ema20 > h.ema50 && h.ema50 > h.ema200;
  const down = h.close < h.ema50 && h.ema20 < h.ema50 && h.ema50 < h.ema200;

  if (up && trendSlopeAgreement(recent, 'UP') >= 0.60) return 'UP';
  if (down && trendSlopeAgreement(recent, 'DOWN') >= 0.60) return 'DOWN';
  return 'RANGE';
}

export function buildEurUsdTrendPullbackSetup(f, options = {}) {
  const lookback = Math.max(5, Math.floor(Number(options.lookback ?? process.env.EURUSD_PULLBACK_LOOKBACK ?? 6)));
  const minRetraceAtr = Number(options.minRetraceAtr ?? process.env.EURUSD_PULLBACK_MIN_RETRACE_ATR ?? 0.20);
  const maxRetraceAtr = Number(options.maxRetraceAtr ?? process.env.EURUSD_PULLBACK_MAX_RETRACE_ATR ?? 1.20);
  const touchBufferAtr = Number(options.touchBufferAtr ?? process.env.EURUSD_PULLBACK_TOUCH_BUFFER_ATR ?? 0.15);
  const structureBufferAtr = Number(options.structureBufferAtr ?? process.env.EURUSD_PULLBACK_STRUCTURE_BUFFER_ATR ?? 0.20);
  const minBodyAtr = Number(options.minBodyAtr ?? process.env.EURUSD_PULLBACK_MIN_BODY_ATR ?? 0.30);
  const maxBodyAtr = Number(options.maxBodyAtr ?? process.env.EURUSD_PULLBACK_MAX_BODY_ATR ?? 1.50);
  const minCloseLocation = Number(options.minCloseLocation ?? process.env.EURUSD_PULLBACK_MIN_CLOSE_LOCATION ?? 0.65);
  const buyRsiMin = Number(options.buyRsiMin ?? process.env.EURUSD_PULLBACK_BUY_RSI_MIN ?? 50);
  const buyRsiMax = Number(options.buyRsiMax ?? process.env.EURUSD_PULLBACK_BUY_RSI_MAX ?? 70);
  const sellRsiMin = Number(options.sellRsiMin ?? process.env.EURUSD_PULLBACK_SELL_RSI_MIN ?? 30);
  const sellRsiMax = Number(options.sellRsiMax ?? process.env.EURUSD_PULLBACK_SELL_RSI_MAX ?? 50);
  const maxH1ExtensionAtr = Number(options.maxH1ExtensionAtr ?? process.env.EURUSD_PULLBACK_MAX_H1_EXTENSION_ATR ?? 2.50);
  const maxSpreadPips = Number(options.maxSpreadPips ?? process.env.EURUSD_MAX_SPREAD_PIPS ?? 1.20);
  const maxSpreadAtrPct = Number(options.maxSpreadAtrPct ?? process.env.EURUSD_MAX_SPREAD_ATR_PCT ?? 15);
  const minStopAtr = Number(options.minStopAtr ?? process.env.EURUSD_MIN_STOP_ATR ?? 0.50);
  const maxStopAtr = Number(options.maxStopAtr ?? process.env.EURUSD_MAX_STOP_ATR ?? 1.50);
  const takeProfitR = Number(options.takeProfitR ?? process.env.EURUSD_PULLBACK_TAKE_PROFIT_R ?? 2.00);
  const maxSpreadToTpPct = Number(options.maxSpreadToTpPct ?? process.env.EURUSD_MAX_SPREAD_TO_TP_PCT ?? 12);

  const trend = eurUsdH1PullbackTrend(f);
  const bars = sortBarsAscending(f.recentM15 || []);
  if (bars.length < lookback + 1) return waitResult(trend, ['insufficient_recent_m15_bars']);
  const latest = bars[bars.length - 1];
  if (f.barTime > 0 && latest.time !== f.barTime) return waitResult(trend, ['m15_bar_time_mismatch']);

  const recentSetupBars = bars.slice(-(lookback + 1));
  for (let i = 1; i < recentSetupBars.length; i += 1) {
    if (recentSetupBars[i].time - recentSetupBars[i - 1].time !== 900) {
      return waitResult(trend, ['recent_m15_setup_bars_not_contiguous']);
    }
  }

  const atr = Number(f.m15?.atr14 || 0);
  if (!(atr > 0)) return waitResult(trend, ['invalid_atr']);

  const spreadPips = Number(f.spread || 0) / 0.0001;
  const spreadAtrPct = atr > 0 ? Number(f.spread || 0) / atr * 100 : Infinity;
  const spreadOkay = spreadPips <= maxSpreadPips && spreadAtrPct <= maxSpreadAtrPct;

  const h1Recent = sortBarsAscending(f.recentH1 || []).slice(-6);
  const h1Agreement = trend === 'UP' ? trendSlopeAgreement(h1Recent, 'UP') : trend === 'DOWN' ? trendSlopeAgreement(h1Recent, 'DOWN') : 0;
  const h1Extension = f.h1.atr14 > 0 ? Math.abs(f.h1.close - f.h1.ema50) / f.h1.atr14 : Infinity;
  const h1NotOverextended = h1Extension <= maxH1ExtensionAtr;

  const setupBars = bars.slice(-(lookback + 1), -1);
  const split = Math.max(2, Math.floor(setupBars.length / 3));
  const impulseBars = setupBars.slice(0, split);
  const pullbackBars = setupBars.slice(split);
  const pullbackHigh = maxHigh(pullbackBars);
  const pullbackLow = minLow(pullbackBars);
  const impulseHigh = maxHigh(impulseBars);
  const impulseLow = minLow(impulseBars);

  const buyRetraceAtr = (impulseHigh - pullbackLow) / atr;
  const sellRetraceAtr = (pullbackHigh - impulseLow) / atr;
  const touchBuy = pullbackBars.some((b) => b.low <= f.m15.ema20 + atr * touchBufferAtr);
  const touchSell = pullbackBars.some((b) => b.high >= f.m15.ema20 - atr * touchBufferAtr);
  const heldBuy = pullbackLow > f.m15.ema50 - atr * structureBufferAtr;
  const heldSell = pullbackHigh < f.m15.ema50 + atr * structureBufferAtr;

  const candleRange = Math.max(0, latest.high - latest.low);
  const bodyAtr = Math.abs(latest.close - latest.open) / atr;
  const closeLocation = candleRange > 0 ? (latest.close - latest.low) / candleRange : 0;

  const buyTrigger =
    trend === 'UP' &&
    f.m15.ema20 > f.m15.ema50 &&
    f.m15.rsi14 >= buyRsiMin && f.m15.rsi14 <= buyRsiMax &&
    touchBuy && heldBuy && buyRetraceAtr >= minRetraceAtr && buyRetraceAtr <= maxRetraceAtr &&
    latest.close > f.m15.ema20 && latest.close > f.m15.ema50 &&
    latest.close > pullbackHigh &&
    bodyAtr >= minBodyAtr && bodyAtr <= maxBodyAtr &&
    closeLocation >= minCloseLocation &&
    h1NotOverextended && spreadOkay;

  const sellTrigger =
    trend === 'DOWN' &&
    f.m15.ema20 < f.m15.ema50 &&
    f.m15.rsi14 >= sellRsiMin && f.m15.rsi14 <= sellRsiMax &&
    touchSell && heldSell && sellRetraceAtr >= minRetraceAtr && sellRetraceAtr <= maxRetraceAtr &&
    latest.close < f.m15.ema20 && latest.close < f.m15.ema50 &&
    latest.close < pullbackLow &&
    bodyAtr >= minBodyAtr && bodyAtr <= maxBodyAtr &&
    closeLocation <= 1 - minCloseLocation &&
    h1NotOverextended && spreadOkay;

  let direction = buyTrigger ? 'BUY' : sellTrigger ? 'SELL' : 'WAIT';
  const reasons = [];
  let score = 0;

  if (trend === 'UP' || trend === 'DOWN') score += 25; else reasons.push('h1_trend_not_clear');
  if (h1Agreement >= 0.60) score += 10; else reasons.push('h1_slope_agreement_weak');

  const m15Aligned = (trend === 'UP' && f.m15.ema20 > f.m15.ema50) || (trend === 'DOWN' && f.m15.ema20 < f.m15.ema50);
  if (m15Aligned) score += 15; else reasons.push('m15_ema_alignment_failed');

  const pullbackQuality =
    (trend === 'UP' && touchBuy && heldBuy && buyRetraceAtr >= minRetraceAtr && buyRetraceAtr <= maxRetraceAtr) ||
    (trend === 'DOWN' && touchSell && heldSell && sellRetraceAtr >= minRetraceAtr && sellRetraceAtr <= maxRetraceAtr);
  if (pullbackQuality) score += 15; else reasons.push('pullback_quality_failed');

  if (bodyAtr >= minBodyAtr && bodyAtr <= maxBodyAtr) score += 10; else reasons.push('trigger_body_outside_atr_band');
  if ((trend === 'UP' && closeLocation >= minCloseLocation) || (trend === 'DOWN' && closeLocation <= 1 - minCloseLocation)) score += 10; else reasons.push('trigger_close_location_weak');
  if ((trend === 'UP' && f.m15.rsi14 >= buyRsiMin && f.m15.rsi14 <= buyRsiMax) || (trend === 'DOWN' && f.m15.rsi14 >= sellRsiMin && f.m15.rsi14 <= sellRsiMax)) score += 5; else reasons.push('m15_rsi_outside_continuation_zone');
  if (spreadOkay) score += 5; else reasons.push('spread_filter_failed');
  if (!h1NotOverextended) reasons.push('h1_overextended');

  let entry = 0;
  let stopLoss = 0;
  let takeProfit = 0;
  let stopAtr = 0;
  let spreadToTpPct = 0;

  if (direction === 'BUY') {
    entry = f.ask;
    stopLoss = pullbackLow - atr * 0.15;
  } else if (direction === 'SELL') {
    entry = f.bid;
    stopLoss = pullbackHigh + atr * 0.15;
  }

  if (direction !== 'WAIT') {
    const stopDistance = Math.abs(entry - stopLoss);
    stopAtr = stopDistance / atr;
    if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
      reasons.push('stop_distance_outside_atr_band');
      direction = 'WAIT';
    } else {
      takeProfit = direction === 'BUY' ? entry + stopDistance * takeProfitR : entry - stopDistance * takeProfitR;
      const tpDistance = Math.abs(takeProfit - entry);
      spreadToTpPct = tpDistance > 0 ? Number(f.spread || 0) / tpDistance * 100 : Infinity;
      if (spreadToTpPct > maxSpreadToTpPct) {
        reasons.push('spread_too_large_vs_target');
        direction = 'WAIT';
      }
    }
  }

  if (direction === 'WAIT') {
    return {
      ...waitResult(trend, reasons),
      quality_score: Math.min(100, Math.max(0, score)),
      h1_slope_agreement: h1Agreement,
      h1_extension_atr: h1Extension,
      pullback_bars: pullbackBars.length,
      pullback_high: pullbackHigh,
      pullback_low: pullbackLow,
      buy_retrace_atr: buyRetraceAtr,
      sell_retrace_atr: sellRetraceAtr,
      trigger_body_atr: bodyAtr,
      trigger_close_location: closeLocation,
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct
    };
  }

  const finalScore = Math.min(100, score + (h1NotOverextended ? 5 : 0));
  if (finalScore < 95) {
    return {
      ...waitResult(trend, [...reasons, 'quality_score_below_threshold']),
      quality_score: finalScore,
      stop_atr: stopAtr,
      spread_to_tp_pct: spreadToTpPct
    };
  }

  const stopDistance = Math.abs(entry - stopLoss);
  return {
    candidate: direction,
    quality_score: finalScore,
    setup_type: 'TREND_PULLBACK',
    trend,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: stopDistance > 0 ? Math.abs(takeProfit - entry) / stopDistance : 0,
    h1_slope_agreement: h1Agreement,
    h1_extension_atr: h1Extension,
    pullback_bars: pullbackBars.length,
    pullback_high: pullbackHigh,
    pullback_low: pullbackLow,
    buy_retrace_atr: buyRetraceAtr,
    sell_retrace_atr: sellRetraceAtr,
    trigger_body_atr: bodyAtr,
    trigger_close_location: closeLocation,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    spread_to_tp_pct: spreadToTpPct,
    stop_atr: stopAtr,
    reasons: []
  };
}
