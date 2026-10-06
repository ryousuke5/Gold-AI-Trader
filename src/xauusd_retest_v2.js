const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function barsSorted(bars) {
  return Array.isArray(bars) ? [...bars].sort((a, b) => Number(a.time) - Number(b.time)) : [];
}

function wait(trend, reason, extra = {}) {
  return {
    candidate: 'WAIT',
    trend,
    setup_type: 'NONE',
    entry: 0,
    stop_loss: 0,
    take_profit: 0,
    risk_reward: 0,
    reasons: [reason],
    ...extra
  };
}

function slopeAgreement(bars, direction, count = 5) {
  const recent = barsSorted(bars).slice(-count);
  if (recent.length < 3) return 0;
  let good = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const d = recent[i].close - recent[i - 1].close;
    if ((direction === 'UP' && d > 0) || (direction === 'DOWN' && d < 0)) good += 1;
  }
  return good / (recent.length - 1);
}

export function xauH1RetestTrend(features, options = {}) {
  const h = features?.h1 || {};
  const recent = barsSorted(features?.recentH1 || []);
  const minAgreement = num(options.minH1Agreement, 0.60);
  const buyRsiMin = num(options.h1BuyRsiMin, 45);
  const buyRsiMax = num(options.h1BuyRsiMax, 75);
  const sellRsiMin = num(options.h1SellRsiMin, 25);
  const sellRsiMax = num(options.h1SellRsiMax, 55);

  const up =
    h.close > h.ema20 &&
    h.ema20 > h.ema50 &&
    h.ema50 > h.ema200 &&
    h.rsi14 >= buyRsiMin &&
    h.rsi14 <= buyRsiMax &&
    slopeAgreement(recent, 'UP', 5) >= minAgreement;

  const down =
    h.close < h.ema20 &&
    h.ema20 < h.ema50 &&
    h.ema50 < h.ema200 &&
    h.rsi14 >= sellRsiMin &&
    h.rsi14 <= sellRsiMax &&
    slopeAgreement(recent, 'DOWN', 5) >= minAgreement;

  return up ? 'UP' : down ? 'DOWN' : 'RANGE';
}

function isValidBar(b) {
  return Number.isFinite(b?.open) &&
    Number.isFinite(b?.high) &&
    Number.isFinite(b?.low) &&
    Number.isFinite(b?.close) &&
    b.high >= b.low &&
    b.high >= b.open &&
    b.high >= b.close &&
    b.low <= b.open &&
    b.low <= b.close;
}

export function findXauRetestSetup(features = {}, options = {}) {
  const cfg = {
    breakoutLookback: Math.max(6, Math.floor(num(options.breakoutLookback, 12))),
    minRangeAtr: num(options.minRangeAtr, 0.60),
    maxRangeAtr: num(options.maxRangeAtr, 3.20),
    breakoutAtr: num(options.breakoutAtr, 0.08),
    breakoutBodyAtr: num(options.breakoutBodyAtr, 0.30),
    breakoutCloseLocation: num(options.breakoutCloseLocation, 0.60),
    maxRetestBars: Math.max(2, Math.floor(num(options.maxRetestBars, 6))),
    minRetestBars: Math.max(1, Math.floor(num(options.minRetestBars, 1))),
    retestToleranceAtr: num(options.retestToleranceAtr, 0.20),
    maxPenetrationAtr: num(options.maxPenetrationAtr, 0.20),
    retestCloseBufferAtr: num(options.retestCloseBufferAtr, 0.05),
    confirmBufferAtr: num(options.confirmBufferAtr, 0.02),
    confirmBodyAtr: num(options.confirmBodyAtr, 0.25),
    minConfirmCloseLocation: num(options.minConfirmCloseLocation, 0.60),
    maxConfirmBodyAtr: num(options.maxConfirmBodyAtr, 1.50),
    minStopAtr: num(options.minStopAtr, 0.60),
    maxStopAtr: num(options.maxStopAtr, 2.20),
    stopBufferAtr: num(options.stopBufferAtr, 0.12),
    takeProfitR: num(options.takeProfitR, 1.80),
    maxEntryDistanceAtr: num(options.maxEntryDistanceAtr, 0.25),
    maxExtensionAtr: num(options.maxExtensionAtr, 1.80),
    minH1Agreement: num(options.minH1Agreement, 0.60),
    useVolumeFilter: options.useVolumeFilter === true,
    minVolumeRatio: num(options.minVolumeRatio, 0.90),
    maxSpreadPrice: num(options.maxSpreadPrice, 0.60)
  };

  const trend = xauH1RetestTrend(features, cfg);
  const m5 = features?.m5 || {};
  const h1 = features?.h1 || {};
  const bars = barsSorted(features?.recentM5 || []);
  if (bars.length < cfg.breakoutLookback + cfg.maxRetestBars + 3) {
    return wait(trend, 'insufficient_recent_m5_bars');
  }

  const latest = bars.at(-1);
  if (!isValidBar(latest)) return wait(trend, 'invalid_confirmation_bar');
  if (features.barTime && Number(features.barTime) !== Number(latest.time)) {
    return wait(trend, 'm5_bar_time_mismatch');
  }

  const atr = num(m5.atr14);
  const spread = num(features.spread);
  if (!(atr > 0)) return wait(trend, 'invalid_m5_atr');
  if (spread > cfg.maxSpreadPrice) return wait(trend, 'spread_filter_failed', { spread_price: spread });

  const h1Agreement = trend === 'UP'
    ? slopeAgreement(features.recentH1, 'UP', 5)
    : trend === 'DOWN'
      ? slopeAgreement(features.recentH1, 'DOWN', 5)
      : 0;

  if (trend === 'RANGE') return wait(trend, 'h1_trend_not_clear', { h1_slope_agreement: h1Agreement });

  const confirmationIndex = bars.length - 1;
  const breakoutMin = confirmationIndex - (cfg.maxRetestBars + 1);
  const breakoutMax = confirmationIndex - (cfg.minRetestBars + 1);

  let selected = null;

  for (let bi = breakoutMax; bi >= breakoutMin; bi -= 1) {
    if (bi < cfg.breakoutLookback || bi < 0) continue;

    const breakout = bars[bi];
    if (!isValidBar(breakout)) continue;

    const rangeBars = bars.slice(bi - cfg.breakoutLookback, bi);
    if (rangeBars.length !== cfg.breakoutLookback || rangeBars.some(b => !isValidBar(b))) continue;

    const rangeHigh = Math.max(...rangeBars.map(b => b.high));
    const rangeLow = Math.min(...rangeBars.map(b => b.low));
    const rangeWidth = rangeHigh - rangeLow;
    const rangeAtr = rangeWidth / atr;
    if (!(rangeWidth > 0 && rangeAtr >= cfg.minRangeAtr && rangeAtr <= cfg.maxRangeAtr)) continue;

    const breakoutRange = breakout.high - breakout.low;
    const breakoutBodyAtr = Math.abs(breakout.close - breakout.open) / atr;
    if (!(breakoutRange > 0 && breakoutBodyAtr >= cfg.breakoutBodyAtr)) continue;

    const breakoutCloseLocation =
      (breakout.close - breakout.low) / breakoutRange;

    const isBuyBreak =
      trend === 'UP' &&
      m5.ema20 > m5.ema50 &&
      breakout.close >= rangeHigh + cfg.breakoutAtr * atr &&
      breakout.close > breakout.open &&
      breakoutCloseLocation >= cfg.breakoutCloseLocation;

    const isSellBreak =
      trend === 'DOWN' &&
      m5.ema20 < m5.ema50 &&
      breakout.close <= rangeLow - cfg.breakoutAtr * atr &&
      breakout.close < breakout.open &&
      breakoutCloseLocation <= 1 - cfg.breakoutCloseLocation;

    if (!isBuyBreak && !isSellBreak) continue;

    const direction = isBuyBreak ? 'BUY' : 'SELL';
    const level = direction === 'BUY' ? rangeHigh : rangeLow;

    const retestIndex = bi + 1;
    if (retestIndex >= confirmationIndex) continue;
    const retest = bars[retestIndex];
    const confirmation = latest;
    if (!isValidBar(retest)) continue;

    const retestTouch = direction === 'BUY'
      ? retest.low <= level + cfg.retestToleranceAtr * atr &&
        retest.low >= level - cfg.maxPenetrationAtr * atr &&
        retest.close >= level - cfg.retestCloseBufferAtr * atr
      : retest.high >= level - cfg.retestToleranceAtr * atr &&
        retest.high <= level + cfg.maxPenetrationAtr * atr &&
        retest.close <= level + cfg.retestCloseBufferAtr * atr;

    if (!retestTouch) continue;

    const confirmationRange = confirmation.high - confirmation.low;
    const confirmationBodyAtr = Math.abs(confirmation.close - confirmation.open) / atr;
    if (!(confirmationRange > 0 &&
          confirmationBodyAtr >= cfg.confirmBodyAtr &&
          confirmationBodyAtr <= cfg.maxConfirmBodyAtr)) continue;

    const confirmationCloseLocation =
      (confirmation.close - confirmation.low) / confirmationRange;

    const confirmationOk = direction === 'BUY'
      ? confirmation.close > Math.max(level, retest.high) + cfg.confirmBufferAtr * atr &&
        confirmation.close > confirmation.open &&
        confirmationCloseLocation >= cfg.minConfirmCloseLocation
      : confirmation.close < Math.min(level, retest.low) - cfg.confirmBufferAtr * atr &&
        confirmation.close < confirmation.open &&
        confirmationCloseLocation <= 1 - cfg.minConfirmCloseLocation;

    if (!confirmationOk) continue;

    const extension = direction === 'BUY'
      ? (confirmation.close - m5.ema20) / atr
      : (m5.ema20 - confirmation.close) / atr;

    if (!(extension <= cfg.maxExtensionAtr)) continue;

    const priorVolumes = rangeBars.map(b => num(b.volume)).filter(v => v >= 0);
    const avgVolume = priorVolumes.length
      ? priorVolumes.reduce((s, v) => s + v, 0) / priorVolumes.length
      : 0;
    const volumeRatio = avgVolume > 0
      ? num(confirmation.volume) / avgVolume
      : 0;
    if (cfg.useVolumeFilter && avgVolume > 0 && volumeRatio < cfg.minVolumeRatio) continue;

    const entry = direction === 'BUY'
      ? num(features.ask)
      : num(features.bid);

    const stop = direction === 'BUY'
      ? retest.low - cfg.stopBufferAtr * atr
      : retest.high + cfg.stopBufferAtr * atr;

    const stopDistance = Math.abs(entry - stop);
    const stopAtr = stopDistance / atr;
    if (!(stopDistance > 0 && stopAtr >= cfg.minStopAtr && stopAtr <= cfg.maxStopAtr)) continue;

    const target = direction === 'BUY'
      ? entry + stopDistance * cfg.takeProfitR
      : entry - stopDistance * cfg.takeProfitR;

    const signalClose = confirmation.close;
    if (cfg.maxEntryDistanceAtr > 0 &&
        Math.abs(entry - signalClose) > cfg.maxEntryDistanceAtr * atr) {
      continue;
    }

    selected = {
      candidate: direction,
      trend: direction === 'BUY' ? 'UP' : 'DOWN',
      setup_type: 'H1_TREND_RANGE_BREAK_RETEST',
      entry,
      stop_loss: stop,
      take_profit: target,
      risk_reward: cfg.takeProfitR,
      diagnostics: {
        breakout_time: breakout.time,
        retest_time: retest.time,
        confirmation_time: confirmation.time,
        range_high: rangeHigh,
        range_low: rangeLow,
        range_atr: rangeAtr,
        breakout_body_atr: breakoutBodyAtr,
        breakout_close_location: breakoutCloseLocation,
        retest_low: retest.low,
        retest_high: retest.high,
        confirmation_body_atr: confirmationBodyAtr,
        confirmation_close_location: confirmationCloseLocation,
        extension_atr: extension,
        volume_ratio: volumeRatio,
        stop_atr: stopAtr,
        h1_slope_agreement: h1Agreement
      },
      reasons: []
    };
    break;
  }

  return selected || wait(trend, 'no_valid_breakout_retest_confirmation', {
    h1_slope_agreement: h1Agreement
  });
}
