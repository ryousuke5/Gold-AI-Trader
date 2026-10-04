const londonFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23'
});
const londonCache = new Map();

function num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : 0;
}

function getLondonParts(timestampSeconds) {
  const bucket = Math.floor(timestampSeconds / 3600);
  const cached = londonCache.get(bucket);
  if (cached) return cached;
  const parts = Object.fromEntries(
    londonFormatter.formatToParts(new Date(timestampSeconds * 1000))
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value])
  );
  const out = {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: String(parts.weekday || '')
  };
  londonCache.set(bucket, out);
  return out;
}

function londonMinuteOfDay(timestampSeconds) {
  const p = getLondonParts(timestampSeconds);
  return p.hour * 60 + p.minute;
}

function londonDateKey(timestampSeconds) {
  const p = getLondonParts(timestampSeconds);
  return `${p.year.toString().padStart(4, '0')}-${p.month.toString().padStart(2, '0')}-${p.day.toString().padStart(2, '0')}`;
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

function h1Trend(h1) {
  if (!h1) return 'RANGE';
  if (h1.close > 0 && h1.ema20 > h1.ema50 && h1.ema50 > h1.ema200 && h1.close >= h1.ema20) return 'UP';
  if (h1.close > 0 && h1.ema20 < h1.ema50 && h1.ema50 < h1.ema200 && h1.close <= h1.ema20) return 'DOWN';
  return 'RANGE';
}

/**
 * Independent EURUSD session strategy research:
 * London opening range (07:00-08:00 Europe/London) -> breakout window (08:15-12:00 Europe/London).
 *
 * The AI layer is intentionally downstream and can only confirm the market environment.
 * It cannot alter entry, stop, take-profit or size.
 */
export function buildEurUsdLondonOrbSetup(f, options = {}) {
  const rangeStartMinute = Number(options.rangeStartMinute ?? 7 * 60);
  const rangeEndMinute = Number(options.rangeEndMinute ?? 8 * 60);
  const breakoutStartMinute = Number(options.breakoutStartMinute ?? 8 * 60 + 15);
  const breakoutEndMinute = Number(options.breakoutEndMinute ?? 12 * 60);

  const breakoutAtr = Math.max(0.02, Number(options.breakoutAtr ?? 0.07));
  const minBodyAtr = Math.max(0.05, Number(options.minBodyAtr ?? 0.30));
  const minCloseLocation = Math.min(0.95, Math.max(0.5, Number(options.minCloseLocation ?? 0.65)));
  const minRangeAtr = Math.max(0.05, Number(options.minRangeAtr ?? 0.15));
  const maxRangeAtr = Math.max(minRangeAtr, Number(options.maxRangeAtr ?? 1.75));
  const buyRsiMin = Math.max(1, Number(options.buyRsiMin ?? 48));
  const buyRsiMax = Math.min(99, Number(options.buyRsiMax ?? 70));
  const sellRsiMin = Math.max(1, Number(options.sellRsiMin ?? 30));
  const sellRsiMax = Math.min(99, Number(options.sellRsiMax ?? 52));
  const minVolumeRatio = Math.max(0.5, Number(options.minVolumeRatio ?? 1.05));
  const requireVolume = String(options.requireVolume ?? 'true').toLowerCase() !== 'false';
  const maxSpreadPips = Math.max(0.1, Number(options.maxSpreadPips ?? 1.20));
  const maxSpreadAtrPct = Math.max(1, Number(options.maxSpreadAtrPct ?? 15));
  const minStopAtr = Math.max(0.1, Number(options.minStopAtr ?? 0.50));
  const maxStopAtr = Math.max(minStopAtr, Number(options.maxStopAtr ?? 1.50));
  const takeProfitR = Math.max(1.2, Number(options.takeProfitR ?? 2.0));
  const maxSpreadToTpPct = Math.max(1, Number(options.maxSpreadToTpPct ?? 12));

  const bars = sortBarsAscending(f.recentM15);
  const latest = bars[bars.length - 1];
  const trend = h1Trend(f.h1);
  const defaultWait = (reasons = []) => ({
    candidate: 'WAIT',
    setup_type: 'NONE',
    trend,
    session: 'LONDON_OPENING_RANGE',
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
    entry: 0,
    stop_loss: 0,
    take_profit: 0,
    risk_reward: 0,
    stop_atr: 0,
    spread_pips: 0,
    spread_atr_pct: 0,
    spread_to_tp_pct: 0,
    quality_score: 0,
    reasons
  });

  if (!latest || bars.length < 20) return defaultWait(['insufficient_recent_m15_bars']);
  if (f.barTime > 0 && latest.time !== f.barTime) return defaultWait(['m15_bar_time_mismatch']);

  const londonDate = londonDateKey(latest.time);
  const latestMinute = londonMinuteOfDay(latest.time);
  if (latestMinute < breakoutStartMinute || latestMinute > breakoutEndMinute) {
    return defaultWait(['outside_london_breakout_window']);
  }

  const rangeBars = bars.filter((b) => {
    if (londonDateKey(b.time) !== londonDate) return false;
    const m = londonMinuteOfDay(b.time);
    return m > rangeStartMinute && m <= rangeEndMinute;
  });

  if (rangeBars.length !== 4) return defaultWait(['london_opening_range_incomplete']);

  if (rangeBars.some((bar, i) => i > 0 && bar.time - rangeBars[i - 1].time !== 900)) {
    return defaultWait(['london_opening_range_not_contiguous']);
  }

  const rangeHigh = maxHigh(rangeBars);
  const rangeLow = minLow(rangeBars);
  const rangeWidth = rangeHigh - rangeLow;
  const atr = num(f.m15?.atr14);
  const rangeWidthAtr = atr > 0 ? rangeWidth / atr : Infinity;

  const spread = num(f.spread);
  const pipSize = 0.0001;
  const spreadPips = spread / pipSize;
  const spreadAtrPct = atr > 0 ? spread / atr * 100 : Infinity;
  const spreadOkay = spreadPips <= maxSpreadPips && spreadAtrPct <= maxSpreadAtrPct;
  const rangeOkay = rangeWidthAtr >= minRangeAtr && rangeWidthAtr <= maxRangeAtr;

  const candleRange = Math.max(0, latest.high - latest.low);
  const candleBody = Math.abs(latest.close - latest.open);
  const bodyAtr = atr > 0 ? candleBody / atr : 0;
  const closeLocation = candleRange > 0 ? (latest.close - latest.low) / candleRange : 0;

  const priorBars = bars.filter((b) => londonDateKey(b.time) === londonDate).slice(-24);
  const priorVolumes = priorBars.map((b) => num(b.volume)).filter((v) => v > 0);
  const averageVolume = average(priorVolumes);
  const volumeDataAvailable = latest.volume > 0 && averageVolume > 0;
  const volumeRatio = volumeDataAvailable ? latest.volume / averageVolume : 0;
  const volumeConfirmation = volumeDataAvailable ? volumeRatio >= minVolumeRatio : false;
  const volumeGatePassed = !volumeDataAvailable ? true : (requireVolume ? volumeConfirmation : true);

  const previous = bars[bars.length - 2];
  const m15Up = num(f.m15?.ema20) > num(f.m15?.ema50);
  const m15Down = num(f.m15?.ema20) < num(f.m15?.ema50);
  const breakoutBuffer = atr * breakoutAtr;

  const buy =
    trend === 'UP' &&
    m15Up &&
    f.m15.rsi14 >= buyRsiMin && f.m15.rsi14 <= buyRsiMax &&
    rangeOkay &&
    spreadOkay &&
    volumeGatePassed &&
    latest.close > rangeHigh + breakoutBuffer &&
    previous.close <= rangeHigh &&
    bodyAtr >= minBodyAtr &&
    closeLocation >= minCloseLocation;

  const sell =
    trend === 'DOWN' &&
    m15Down &&
    f.m15.rsi14 >= sellRsiMin && f.m15.rsi14 <= sellRsiMax &&
    rangeOkay &&
    spreadOkay &&
    volumeGatePassed &&
    latest.close < rangeLow - breakoutBuffer &&
    previous.close >= rangeLow &&
    bodyAtr >= minBodyAtr &&
    closeLocation <= (1 - minCloseLocation);

  let direction = 'WAIT';
  if (buy) direction = 'BUY';
  if (sell) direction = 'SELL';

  const reasons = [];
  if (!rangeOkay) reasons.push('range_width_outside_atr_band');
  if (!spreadOkay) reasons.push('spread_filter_failed');
  if (!volumeGatePassed) reasons.push('volume_confirmation_failed');
  if (!(bodyAtr >= minBodyAtr)) reasons.push('breakout_body_too_small');
  if (direction === 'WAIT') reasons.push('no_valid_london_breakout');

  let entry = 0;
  let stopLoss = 0;
  let takeProfit = 0;
  let stopAtr = 0;
  let spreadToTpPct = 0;

  if (direction !== 'WAIT') {
    entry = direction === 'BUY' ? f.ask : f.bid;
    stopLoss = direction === 'BUY' ? rangeLow - atr * 0.15 : rangeHigh + atr * 0.15;
    const stopDistance = Math.abs(entry - stopLoss);
    stopAtr = atr > 0 ? stopDistance / atr : Infinity;
    if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
      reasons.push('stop_distance_outside_atr_band');
      direction = 'WAIT';
    } else {
      takeProfit = direction === 'BUY'
        ? entry + stopDistance * takeProfitR
        : entry - stopDistance * takeProfitR;
      const tpDistance = Math.abs(takeProfit - entry);
      spreadToTpPct = tpDistance > 0 ? spread / tpDistance * 100 : Infinity;
      if (spreadToTpPct > maxSpreadToTpPct) {
        reasons.push('spread_too_large_vs_target');
        direction = 'WAIT';
      }
    }
  }

  const score =
    (trend !== 'RANGE' ? 25 : 0) +
    ((trend === 'UP' && m15Up) || (trend === 'DOWN' && m15Down) ? 15 : 0) +
    (rangeOkay ? 15 : 0) +
    (spreadOkay ? 5 : 0) +
    ((direction === 'BUY' || direction === 'SELL') ? 20 : 0) +
    (bodyAtr >= minBodyAtr ? 10 : 0) +
    (closeLocation >= minCloseLocation || closeLocation <= 1 - minCloseLocation ? 5 : 0) +
    (volumeDataAvailable && volumeConfirmation ? 5 : 0);

  if (direction === 'WAIT') {
    return {
      ...defaultWait([...new Set(reasons)]),
      quality_score: Math.min(100, score),
      range_high: rangeHigh,
      range_low: rangeLow,
      range_width: rangeWidth,
      range_width_atr: rangeWidthAtr,
      breakout_body_atr: bodyAtr,
      breakout_close_location: closeLocation,
      volume_ratio: volumeRatio,
      volume_data_available: volumeDataAvailable,
      volume_confirmation: volumeConfirmation,
      spread_pips: spreadPips,
      spread_atr_pct: spreadAtrPct,
      stop_atr: stopAtr
    };
  }

  const stopDistance = Math.abs(entry - stopLoss);
  return {
    candidate: direction,
    setup_type: 'LONDON_ORB_BREAKOUT',
    trend,
    session: 'LONDON_OPENING_RANGE',
    range_high: rangeHigh,
    range_low: rangeLow,
    range_width: rangeWidth,
    range_width_atr: rangeWidthAtr,
    breakout_distance_atr: atr > 0
      ? (direction === 'BUY' ? latest.close - rangeHigh : rangeLow - latest.close) / atr
      : 0,
    breakout_body_atr: bodyAtr,
    breakout_close_location: closeLocation,
    volume_ratio: volumeRatio,
    volume_data_available: volumeDataAvailable,
    volume_confirmation: volumeConfirmation,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: stopDistance > 0 ? Math.abs(takeProfit - entry) / stopDistance : 0,
    stop_atr: stopAtr,
    spread_pips: spreadPips,
    spread_atr_pct: spreadAtrPct,
    spread_to_tp_pct: spreadToTpPct,
    quality_score: Math.min(100, score),
    reasons: []
  };
}
