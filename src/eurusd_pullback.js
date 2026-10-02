import { buildEurUsdSetup, eurUsdH1Trend, normalizeEurUsdFeatures } from './eurusd_features.js';

function sortBarsAscending(bars) {
  return Array.isArray(bars) ? [...bars].sort((a, b) => a.time - b.time) : [];
}

function average(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
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

/**
 * Independent EURUSD trend-pullback continuation setup.
 *
 * Priority:
 * 1. Existing deterministic BREAKOUT remains primary.
 * 2. This setup is evaluated only when BREAKOUT returns WAIT.
 *
 * The pullback setup never asks AI to choose direction, price levels, or size.
 * It is purely deterministic and remains behind the existing risk/AI gates.
 */
export function buildEurUsdTrendPullbackSetup(features, options = {}) {
  const f = normalizeEurUsdFeatures(features);
  const primary = buildEurUsdSetup(f, options);
  if (primary.candidate !== 'WAIT') return primary;

  const enabled = String(
    options.pullbackEnabled ?? process.env.EURUSD_PULLBACK_ENABLED ?? 'false'
  ).toLowerCase() !== 'false';
  if (!enabled) return primary;

  const trend = eurUsdH1Trend(f);
  if (trend !== 'UP' && trend !== 'DOWN') return primary;

  const bars = sortBarsAscending(f.recentM15);
  const atr = Number(f.m15?.atr14 || 0);
  if (!(atr > 0) || bars.length < 30) return primary;

  const maxAge = Math.max(
    2,
    Math.floor(Number(
      options.pullbackMaxAgeBars ??
      process.env.EURUSD_PULLBACK_MAX_AGE_BARS ??
      5
    ))
  );
  const emaToleranceAtr = Math.max(
    0.05,
    Number(
      options.pullbackEmaToleranceAtr ??
      process.env.EURUSD_PULLBACK_EMA_TOLERANCE_ATR ??
      0.20
    )
  );
  const minBodyAtr = Math.max(
    0.05,
    Number(
      options.pullbackMinBodyAtr ??
      process.env.EURUSD_PULLBACK_MIN_BODY_ATR ??
      0.15
    )
  );
  const minCloseLocation = Math.min(
    0.95,
    Math.max(
      0.5,
      Number(
        options.pullbackMinCloseLocation ??
        process.env.EURUSD_PULLBACK_MIN_CLOSE_LOCATION ??
        0.60
      )
    )
  );
  const minImpulseBreakAtr = Math.max(
    0.02,
    Number(
      options.pullbackMinImpulseBreakAtr ??
      process.env.EURUSD_PULLBACK_MIN_IMPULSE_BREAK_ATR ??
      0.04
    )
  );
  const minVolumeRatio = Math.max(
    0.5,
    Number(
      options.minVolumeRatio ??
      process.env.EURUSD_BREAKOUT_MIN_VOLUME_RATIO ??
      1.10
    )
  );
  const requireVolume = String(
    options.requireVolume ??
    process.env.EURUSD_BREAKOUT_REQUIRE_VOLUME ??
    'true'
  ).toLowerCase() !== 'false';
  const buyRsiMin = Math.max(
    1,
    Number(
      options.pullbackBuyRsiMin ??
      process.env.EURUSD_PULLBACK_BUY_RSI_MIN ??
      48
    )
  );
  const buyRsiMax = Math.min(
    99,
    Number(
      options.pullbackBuyRsiMax ??
      process.env.EURUSD_PULLBACK_BUY_RSI_MAX ??
      66
    )
  );
  const sellRsiMin = Math.max(
    1,
    Number(
      options.pullbackSellRsiMin ??
      process.env.EURUSD_PULLBACK_SELL_RSI_MIN ??
      34
    )
  );
  const sellRsiMax = Math.min(
    99,
    Number(
      options.pullbackSellRsiMax ??
      process.env.EURUSD_PULLBACK_SELL_RSI_MAX ??
      52
    )
  );
  const stopBufferAtr = Math.max(
    0.10,
    Number(
      options.pullbackStopBufferAtr ??
      process.env.EURUSD_PULLBACK_STOP_BUFFER_ATR ??
      0.15
    )
  );
  const minStopAtr = Math.max(
    0.1,
    Number(options.minStopAtr ?? process.env.EURUSD_MIN_STOP_ATR ?? 0.50)
  );
  const maxStopAtr = Math.max(
    minStopAtr,
    Number(options.maxStopAtr ?? process.env.EURUSD_MAX_STOP_ATR ?? 1.50)
  );
  const tpR = Math.max(
    1.2,
    Number(
      options.pullbackTakeProfitR ??
      process.env.EURUSD_PULLBACK_TAKE_PROFIT_R ??
      2
    )
  );

  const closes = bars.map((bar) => bar.close);
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
  const latestBodyAtr = latestRange > 0
    ? Math.abs(latest.close - latest.open) / atr
    : 0;
  const latestCloseLocation = latestRange > 0
    ? (latest.close - latest.low) / latestRange
    : 0;

  const priorVolumes = bars
    .slice(-9, -1)
    .map((bar) => bar.volume)
    .filter((volume) => volume > 0);
  const averagePriorVolume = average(priorVolumes);
  const latestVolumeAvailable = latest.volume > 0 && averagePriorVolume > 0;
  const latestVolumeRatio = averagePriorVolume > 0
    ? latest.volume / averagePriorVolume
    : 0;
  const latestVolumeGate = !latestVolumeAvailable
    ? true
    : (requireVolume ? latestVolumeRatio >= minVolumeRatio : true);

  for (let age = 1; age <= maxAge; age++) {
    const pivotIndex = bars.length - 1 - age;
    if (pivotIndex < 4) continue;

    const pivotEma20 = ema20Series[pivotIndex];
    const touchTolerance = atr * emaToleranceAtr;
    const pullbackWindow = bars.slice(
      Math.max(1, pivotIndex - 2),
      pivotIndex + 1
    );

    const touched = trend === 'UP'
      ? bars[pivotIndex].low <= pivotEma20 + touchTolerance &&
        bars[pivotIndex].close >= pivotEma20 - atr * 0.10
      : bars[pivotIndex].high >= pivotEma20 - touchTolerance &&
        bars[pivotIndex].close <= pivotEma20 + atr * 0.10;
    if (!touched) continue;

    const counterCandle = trend === 'UP'
      ? pullbackWindow.some((bar) => bar.close < bar.open)
      : pullbackWindow.some((bar) => bar.close > bar.open);
    if (!counterCandle) continue;

    const triggerWindow = bars.slice(pivotIndex, bars.length - 1);
    if (!triggerWindow.length) continue;
    const triggerLevel = trend === 'UP'
      ? Math.max(...triggerWindow.map((bar) => bar.high))
      : Math.min(...triggerWindow.map((bar) => bar.low));
    const triggerBreak = trend === 'UP'
      ? latest.close >= triggerLevel + atr * minImpulseBreakAtr
      : latest.close <= triggerLevel - atr * minImpulseBreakAtr;
    if (!triggerBreak) continue;

    const aligned = trend === 'UP'
      ? latestEma20 > latestEma50 &&
        latest.close > latestEma20 &&
        f.m15.ema20 > f.m15.ema50
      : latestEma20 < latestEma50 &&
        latest.close < latestEma20 &&
        f.m15.ema20 < f.m15.ema50;
    if (!aligned) continue;

    const latestRsiOkay = trend === 'UP'
      ? f.m15.rsi14 >= buyRsiMin && f.m15.rsi14 <= buyRsiMax
      : f.m15.rsi14 >= sellRsiMin && f.m15.rsi14 <= sellRsiMax;
    if (!latestRsiOkay || latestBodyAtr < minBodyAtr || !latestVolumeGate) {
      continue;
    }

    if (trend === 'UP' && latestCloseLocation < minCloseLocation) continue;
    if (trend === 'DOWN' && latestCloseLocation > 1 - minCloseLocation) continue;

    const candidate = trend === 'UP' ? 'BUY' : 'SELL';
    const pullbackSwing = candidate === 'BUY'
      ? Math.min(...pullbackWindow.map((bar) => bar.low))
      : Math.max(...pullbackWindow.map((bar) => bar.high));

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
    if (spreadToTpPct > Number(
      options.maxSpreadToTpPct ??
      process.env.EURUSD_MAX_SPREAD_TO_TP_PCT ??
      12
    )) continue;

    return {
      frequency_mode: String(
        options.frequencyMode ??
        process.env.EURUSD_FREQUENCY_MODE ??
        'balanced-weekly'
      ).toLowerCase(),
      target_trades_per_week: Math.max(
        0,
        Number(
          options.targetTradesPerWeek ??
          process.env.EURUSD_TARGET_TRADES_PER_WEEK ??
          1
        )
      ),
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
      volume_confirmation: latestVolumeAvailable
        ? latestVolumeRatio >= minVolumeRatio
        : false,
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
