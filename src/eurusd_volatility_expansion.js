function num(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function stddev(values) {
  if (!values.length) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((v) => (v - mean) ** 2)));
}

function trueRange(bar, prevClose) {
  if (!prevClose) return Math.max(0, bar.high - bar.low);
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose)
  );
}

function atrSeries(bars, period = 14) {
  const out = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr = bars.map((b, i) => trueRange(b, i ? bars[i - 1].close : 0));
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let value = sum / period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i++) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function h1Trend(h1) {
  if (!h1) return 'RANGE';
  if (h1.close > 0 && h1.ema20 > h1.ema50 && h1.ema50 > h1.ema200 && h1.close >= h1.ema20) return 'UP';
  if (h1.close > 0 && h1.ema20 < h1.ema50 && h1.ema50 < h1.ema200 && h1.close <= h1.ema20) return 'DOWN';
  return 'RANGE';
}

/**
 * Independent EURUSD volatility-expansion setup.
 *
 * Signal structure:
 * H1 trend -> M15 volatility squeeze -> Bollinger expansion -> ATR expansion -> directional close.
 * Entry/SL/TP remain deterministic; AI is intentionally downstream as environment-only confirmation.
 */
export function buildEurUsdVolatilityExpansionSetup(f, options = {}) {
  const lookback = Math.max(20, Math.floor(Number(options.lookback ?? 20)));
  const breakoutAtr = Math.max(0.02, Number(options.breakoutAtr ?? 0.05));
  const minBodyAtr = Math.max(0.05, Number(options.minBodyAtr ?? 0.30));
  const minCloseLocation = Math.min(0.95, Math.max(0.5, Number(options.minCloseLocation ?? 0.65)));
  const maxSqueezeWidthAtr = Math.max(0.2, Number(options.maxSqueezeWidthAtr ?? 2.0));
  const minAtrExpansion = Math.max(0.8, Number(options.minAtrExpansion ?? 1.08));
  const buyRsiMin = Number(options.buyRsiMin ?? 48);
  const buyRsiMax = Number(options.buyRsiMax ?? 70);
  const sellRsiMin = Number(options.sellRsiMin ?? 30);
  const sellRsiMax = Number(options.sellRsiMax ?? 52);
  const minVolumeRatio = Math.max(0.5, Number(options.minVolumeRatio ?? 1.05));
  const requireVolume = String(options.requireVolume ?? 'true').toLowerCase() !== 'false';
  const maxSpreadPips = Math.max(0.1, Number(options.maxSpreadPips ?? 1.2));
  const minStopAtr = Math.max(0.1, Number(options.minStopAtr ?? 0.5));
  const maxStopAtr = Math.max(minStopAtr, Number(options.maxStopAtr ?? 1.5));
  const tpR = Math.max(1.2, Number(options.takeProfitR ?? 2));
  const maxSpreadToTpPct = Math.max(1, Number(options.maxSpreadToTpPct ?? 12));

  const bars = Array.isArray(f.recentM15) ? [...f.recentM15].sort((a, b) => a.time - b.time) : [];
  const latest = bars.at(-1);
  if (!latest || bars.length < lookback + 2) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Trend(f.h1), reasons: ['insufficient_recent_m15_bars'], quality_score: 0 };
  }
  if (f.barTime > 0 && latest.time !== f.barTime) {
    return { candidate: 'WAIT', setup_type: 'NONE', trend: h1Trend(f.h1), reasons: ['m15_bar_time_mismatch'], quality_score: 0 };
  }

  const trend = h1Trend(f.h1);
  const atr = num(f.m15?.atr14);
  if (!(atr > 0)) return { candidate: 'WAIT', setup_type: 'NONE', trend, reasons: ['invalid_m15_atr'], quality_score: 0 };

  const prior = bars.slice(-(lookback + 1), -1);
  const priorCloses = prior.map((b) => b.close);
  const bbMid = average(priorCloses);
  const sd = stddev(priorCloses);
  const upper = bbMid + 2 * sd;
  const lower = bbMid - 2 * sd;
  const bandwidth = upper - lower;
  const bandwidthAtr = bandwidth / atr;

  const suppliedAtrValues = prior.map((b) => num(b.atr14, NaN)).filter(Number.isFinite);
  const atrValues = suppliedAtrValues.length >= 10 ? suppliedAtrValues : atrSeries(bars, 14);
  const previousAtrValues = atrValues.slice(-(lookback),).filter(Number.isFinite);
  const avgPriorAtr = average(previousAtrValues);
  const atrExpansionRatio = avgPriorAtr > 0 ? atr / avgPriorAtr : 0;

  const candleRange = Math.max(0, latest.high - latest.low);
  const candleBody = Math.abs(latest.close - latest.open);
  const bodyAtr = candleBody / atr;
  const closeLocation = candleRange > 0 ? (latest.close - latest.low) / candleRange : 0;

  const previous = bars.at(-2);
  const spread = num(f.spread);
  const spreadPips = spread / 0.0001;
  const spreadOkay = spreadPips <= maxSpreadPips && (spread / atr) * 100 <= 15;

  const priorVolumes = bars.filter((b) => b.time < latest.time).slice(-lookback).map((b) => num(b.volume)).filter((v) => v > 0);
  const avgVolume = average(priorVolumes);
  const volumeDataAvailable = latest.volume > 0 && avgVolume > 0;
  const volumeRatio = volumeDataAvailable ? latest.volume / avgVolume : 0;
  const volumeConfirmation = volumeDataAvailable ? volumeRatio >= minVolumeRatio : false;
  const volumeGatePassed = !volumeDataAvailable ? true : (requireVolume ? volumeConfirmation : true);

  const m15Up = num(f.m15?.ema20) > num(f.m15?.ema50);
  const m15Down = num(f.m15?.ema20) < num(f.m15?.ema50);
  const squeeze = bandwidthAtr <= maxSqueezeWidthAtr;
  const expansion = atrExpansionRatio >= minAtrExpansion;

  const buy = trend === 'UP' && m15Up &&
    f.m15.rsi14 >= buyRsiMin && f.m15.rsi14 <= buyRsiMax &&
    squeeze && expansion && spreadOkay && volumeGatePassed &&
    latest.close > upper + atr * breakoutAtr &&
    previous.close <= upper &&
    bodyAtr >= minBodyAtr && closeLocation >= minCloseLocation;

  const sell = trend === 'DOWN' && m15Down &&
    f.m15.rsi14 >= sellRsiMin && f.m15.rsi14 <= sellRsiMax &&
    squeeze && expansion && spreadOkay && volumeGatePassed &&
    latest.close < lower - atr * breakoutAtr &&
    previous.close >= lower &&
    bodyAtr >= minBodyAtr && closeLocation <= 1 - minCloseLocation;

  let direction = buy ? 'BUY' : sell ? 'SELL' : 'WAIT';
  const reasons = [];
  if (trend === 'RANGE') reasons.push('h1_trend_not_clear');
  if (!(squeeze)) reasons.push('volatility_not_compressed');
  if (!(expansion)) reasons.push('atr_expansion_insufficient');
  if (!spreadOkay) reasons.push('spread_filter_failed');
  if (!volumeGatePassed) reasons.push('volume_confirmation_failed');
  if (!(bodyAtr >= minBodyAtr)) reasons.push('breakout_body_too_small');
  if (direction === 'WAIT') reasons.push('no_valid_volatility_breakout');

  let entry = 0;
  let stopLoss = 0;
  let takeProfit = 0;
  let stopAtr = 0;
  let spreadToTpPct = 0;

  if (direction !== 'WAIT') {
    entry = direction === 'BUY' ? f.ask : f.bid;
    stopLoss = direction === 'BUY' ? latest.low - atr * 0.15 : latest.high + atr * 0.15;
    const distance = Math.abs(entry - stopLoss);
    stopAtr = distance / atr;
    if (!(stopAtr >= minStopAtr && stopAtr <= maxStopAtr)) {
      reasons.push('stop_distance_outside_atr_band');
      direction = 'WAIT';
    } else {
      takeProfit = direction === 'BUY' ? entry + distance * tpR : entry - distance * tpR;
      spreadToTpPct = spread / Math.abs(takeProfit - entry) * 100;
      if (spreadToTpPct > maxSpreadToTpPct) {
        reasons.push('spread_too_large_vs_target');
        direction = 'WAIT';
      }
    }
  }

  const score =
    (trend !== 'RANGE' ? 25 : 0) +
    ((trend === 'UP' && m15Up) || (trend === 'DOWN' && m15Down) ? 15 : 0) +
    (squeeze ? 15 : 0) +
    (expansion ? 15 : 0) +
    (spreadOkay ? 5 : 0) +
    (bodyAtr >= minBodyAtr ? 10 : 0) +
    ((direction === 'BUY' && closeLocation >= minCloseLocation) || (direction === 'SELL' && closeLocation <= 1 - minCloseLocation) ? 10 : 0) +
    (volumeDataAvailable && volumeConfirmation ? 5 : 0);

  if (direction === 'WAIT') {
    return {
      candidate: 'WAIT',
      setup_type: 'NONE',
      trend,
      squeeze: true,
      bandwidth_atr: bandwidthAtr,
      atr_expansion_ratio: atrExpansionRatio,
      breakout_body_atr: bodyAtr,
      breakout_close_location: closeLocation,
      volume_ratio: volumeRatio,
      volume_data_available: volumeDataAvailable,
      volume_confirmation: volumeConfirmation,
      spread_pips: spreadPips,
      stop_atr: stopAtr,
      spread_to_tp_pct: 0,
      quality_score: Math.min(100, score),
      reasons: [...new Set(reasons)]
    };
  }

  return {
    candidate: direction,
    setup_type: 'VOLATILITY_EXPANSION',
    trend,
    squeeze: true,
    bandwidth_atr: bandwidthAtr,
    atr_expansion_ratio: atrExpansionRatio,
    breakout_distance_atr: direction === 'BUY' ? (latest.close - upper) / atr : (lower - latest.close) / atr,
    breakout_body_atr: bodyAtr,
    breakout_close_location: closeLocation,
    volume_ratio: volumeRatio,
    volume_data_available: volumeDataAvailable,
    volume_confirmation: volumeConfirmation,
    spread_pips: spreadPips,
    stop_atr: stopAtr,
    spread_to_tp_pct: spreadToTpPct,
    quality_score: Math.min(100, score),
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: Math.abs(takeProfit - entry) / Math.abs(entry - stopLoss),
    reasons: []
  };
}
