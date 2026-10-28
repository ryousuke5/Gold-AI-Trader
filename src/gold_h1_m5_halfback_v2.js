// GOLD H1 trend + M5 halfback V2.
// Research-only variant: V1's confirmed halfback setup must additionally
// reclaim M5 EMA20 with EMA20 sloping in the H1 trend direction.
// The setup intentionally shares V1's pivot, retracement, confirmation, stop,
// and target rules so this test isolates the added momentum confirmation.
import { buildGoldH1M5HalfbackV1Setup } from './gold_h1_m5_halfback_v1.js';

export function buildGoldH1M5HalfbackV2Setup(features = {}, config = {}) {
  const base = buildGoldH1M5HalfbackV1Setup(features, config);
  if (base.candidate === 'WAIT') return base;

  const bars = Array.isArray(features.recentM5) ? features.recentM5 : [];
  if (bars.length < 4) {
    return { candidate: 'WAIT', trend: base.trend, reason: 'insufficient_m5_ema20_slope_history' };
  }
  const signal = bars.at(-1);
  const earlier = bars.at(-4);
  const signalEma20 = Number(signal?.ema20);
  const earlierEma20 = Number(earlier?.ema20);
  const close = Number(signal?.close);
  if (![signalEma20, earlierEma20, close].every(Number.isFinite)) {
    return { candidate: 'WAIT', trend: base.trend, reason: 'missing_m5_ema20_slope_features' };
  }

  const direction = base.candidate;
  const aboveEma20 = close > signalEma20;
  const belowEma20 = close < signalEma20;
  const ema20Rising = signalEma20 > earlierEma20;
  const ema20Falling = signalEma20 < earlierEma20;
  if (direction === 'BUY' && !aboveEma20) {
    return {
      candidate: 'WAIT',
      trend: 'UP',
      reason: 'm5_ema20_reclaim_not_confirmed',
      diagnostics: { ...(base.diagnostics || {}), signal_ema20: signalEma20, signal_close: close }
    };
  }
  if (direction === 'SELL' && !belowEma20) {
    return {
      candidate: 'WAIT',
      trend: 'DOWN',
      reason: 'm5_ema20_reclaim_not_confirmed',
      diagnostics: { ...(base.diagnostics || {}), signal_ema20: signalEma20, signal_close: close }
    };
  }
  if (direction === 'BUY' && !ema20Rising) {
    return {
      candidate: 'WAIT',
      trend: 'UP',
      reason: 'm5_ema20_slope_not_aligned',
      diagnostics: { ...(base.diagnostics || {}), signal_ema20: signalEma20, earlier_ema20: earlierEma20 }
    };
  }
  if (direction === 'SELL' && !ema20Falling) {
    return {
      candidate: 'WAIT',
      trend: 'DOWN',
      reason: 'm5_ema20_slope_not_aligned',
      diagnostics: { ...(base.diagnostics || {}), signal_ema20: signalEma20, earlier_ema20: earlierEma20 }
    };
  }

  return {
    ...base,
    setup_type: 'H1_TREND_M5_HALFBACK_EMA20_RECLAIM_V2',
    reason: 'halfback_ema20_reclaimed',
    diagnostics: {
      ...(base.diagnostics || {}),
      signal_ema20: signalEma20,
      earlier_ema20: earlierEma20,
      ema20_slope_aligned: true,
      ema20_reclaimed: true
    }
  };
}
