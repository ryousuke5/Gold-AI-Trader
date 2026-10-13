function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Diagnostic-only decomposition of GOLD V2's H1 trend gate.
 * The directional checks and their order mirror buildGoldV2Setup:
 * close vs EMA20, EMA20 vs EMA50, EMA50 vs EMA200, then RSI band.
 * This module never chooses a trade or changes candidate/entry/SL/TP.
 */
export function buildGoldV2H1TrendDiagnostics(features = {}, config = {}) {
  const h1 = features.h1 || {};
  const required = [h1.close, h1.ema20, h1.ema50, h1.ema200, h1.rsi14, h1.atr14].map(Number);
  if (!required.every(Number.isFinite) || !(Number(h1.atr14) > 0)) return null;

  const close = Number(h1.close);
  const ema20 = Number(h1.ema20);
  const ema50 = Number(h1.ema50);
  const ema200 = Number(h1.ema200);
  const rsi14 = Number(h1.rsi14);
  const atr = Number(h1.atr14);

  const minRsiBuy = numberOr(config.minH1RsiBuy, 50);
  const maxRsiBuy = numberOr(config.maxH1RsiBuy, 72);
  const minRsiSell = numberOr(config.minH1RsiSell, 28);
  const maxRsiSell = numberOr(config.maxH1RsiSell, 50);

  const upChecks = [
    { key: 'close_not_above_ema20', passed: close > ema20 },
    { key: 'ema20_not_above_ema50', passed: ema20 > ema50 },
    { key: 'ema50_not_above_ema200', passed: ema50 > ema200 },
    { key: 'rsi_outside_buy_band', passed: rsi14 >= minRsiBuy && rsi14 <= maxRsiBuy }
  ];
  const downChecks = [
    { key: 'close_not_below_ema20', passed: close < ema20 },
    { key: 'ema20_not_below_ema50', passed: ema20 < ema50 },
    { key: 'ema50_not_below_ema200', passed: ema50 < ema200 },
    { key: 'rsi_outside_sell_band', passed: rsi14 >= minRsiSell && rsi14 <= maxRsiSell }
  ];
  const upFailures = upChecks.filter(item => !item.passed).map(item => item.key);
  const downFailures = downChecks.filter(item => !item.passed).map(item => item.key);
  const upPassedCount = upChecks.length - upFailures.length;
  const downPassedCount = downChecks.length - downFailures.length;
  const upGatePassed = upFailures.length === 0;
  const downGatePassed = downFailures.length === 0;

  const bullishStack = ema20 > ema50 && ema50 > ema200;
  const bearishStack = ema20 < ema50 && ema50 < ema200;
  const emaStackState = bullishStack ? 'BULLISH' : bearishStack ? 'BEARISH' : 'MIXED';
  const nearestDirection = upPassedCount > downPassedCount
    ? 'UP'
    : downPassedCount > upPassedCount
      ? 'DOWN'
      : 'TIE';

  return {
    h1_diagnostics_version: 2,
    h1_close_vs_ema20_atr: (close - ema20) / atr,
    h1_ema20_vs_ema50_atr: (ema20 - ema50) / atr,
    h1_ema50_vs_ema200_atr: (ema50 - ema200) / atr,
    h1_rsi14: rsi14,
    h1_min_rsi_buy: minRsiBuy,
    h1_max_rsi_buy: maxRsiBuy,
    h1_min_rsi_sell: minRsiSell,
    h1_max_rsi_sell: maxRsiSell,
    h1_up_close_above_ema20: upChecks[0].passed,
    h1_up_ema20_above_ema50: upChecks[1].passed,
    h1_up_ema50_above_ema200: upChecks[2].passed,
    h1_up_rsi_in_band: upChecks[3].passed,
    h1_down_close_below_ema20: downChecks[0].passed,
    h1_down_ema20_below_ema50: downChecks[1].passed,
    h1_down_ema50_below_ema200: downChecks[2].passed,
    h1_down_rsi_in_band: downChecks[3].passed,
    h1_up_failure_components: upFailures,
    h1_down_failure_components: downFailures,
    // Counts measure how many of the four mandatory checks passed in each direction.
    h1_up_conditions_passed_count: upPassedCount,
    h1_down_conditions_passed_count: downPassedCount,
    h1_direction_conditions_total: 4,
    h1_up_gate_passed: upGatePassed,
    h1_down_gate_passed: downGatePassed,
    // First failure follows the actual left-to-right short-circuit order of the strategy gate.
    h1_up_first_failure: upFailures[0] || null,
    h1_down_first_failure: downFailures[0] || null,
    h1_up_failure_pattern: upFailures.length ? upFailures.join('|') : 'none',
    h1_down_failure_pattern: downFailures.length ? downFailures.join('|') : 'none',
    h1_ema_stack_state: emaStackState,
    h1_nearest_direction_by_pass_count: nearestDirection
  };
}
