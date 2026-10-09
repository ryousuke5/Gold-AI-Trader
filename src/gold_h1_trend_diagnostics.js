function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Diagnostic-only decomposition of GOLD V2's H1 trend gate.
 * Values mirror the directional conditions in buildGoldV2Setup, but this
 * function never chooses a trade or changes candidate/entry/SL/TP.
 */
export function buildGoldV2H1TrendDiagnostics(features = {}, config = {}) {
  const h1 = features.h1 || {};
  const required = [h1.close, h1.ema20, h1.ema50, h1.ema200, h1.rsi14, h1.atr14].map(Number);
  if (!required.every(Number.isFinite) || !(Number(h1.atr14) > 0)) return null;

  const minRsiBuy = numberOr(config.minH1RsiBuy, 50);
  const maxRsiBuy = numberOr(config.maxH1RsiBuy, 72);
  const minRsiSell = numberOr(config.minH1RsiSell, 28);
  const maxRsiSell = numberOr(config.maxH1RsiSell, 50);
  const closeAboveEma20 = h1.close > h1.ema20;
  const ema20AboveEma50 = h1.ema20 > h1.ema50;
  const ema50AboveEma200 = h1.ema50 > h1.ema200;
  const closeBelowEma20 = h1.close < h1.ema20;
  const ema20BelowEma50 = h1.ema20 < h1.ema50;
  const ema50BelowEma200 = h1.ema50 < h1.ema200;
  const rsiInBuyBand = h1.rsi14 >= minRsiBuy && h1.rsi14 <= maxRsiBuy;
  const rsiInSellBand = h1.rsi14 >= minRsiSell && h1.rsi14 <= maxRsiSell;

  const upFailures = [];
  if (!closeAboveEma20) upFailures.push('close_not_above_ema20');
  if (!ema20AboveEma50) upFailures.push('ema20_not_above_ema50');
  if (!ema50AboveEma200) upFailures.push('ema50_not_above_ema200');
  if (!rsiInBuyBand) upFailures.push('rsi_outside_buy_band');

  const downFailures = [];
  if (!closeBelowEma20) downFailures.push('close_not_below_ema20');
  if (!ema20BelowEma50) downFailures.push('ema20_not_below_ema50');
  if (!ema50BelowEma200) downFailures.push('ema50_not_below_ema200');
  if (!rsiInSellBand) downFailures.push('rsi_outside_sell_band');

  const atr = Number(h1.atr14);
  return {
    h1_diagnostics_version: 1,
    h1_close_vs_ema20_atr: (h1.close - h1.ema20) / atr,
    h1_ema20_vs_ema50_atr: (h1.ema20 - h1.ema50) / atr,
    h1_ema50_vs_ema200_atr: (h1.ema50 - h1.ema200) / atr,
    h1_rsi14: Number(h1.rsi14),
    h1_min_rsi_buy: minRsiBuy,
    h1_max_rsi_buy: maxRsiBuy,
    h1_min_rsi_sell: minRsiSell,
    h1_max_rsi_sell: maxRsiSell,
    h1_up_close_above_ema20: closeAboveEma20,
    h1_up_ema20_above_ema50: ema20AboveEma50,
    h1_up_ema50_above_ema200: ema50AboveEma200,
    h1_up_rsi_in_band: rsiInBuyBand,
    h1_down_close_below_ema20: closeBelowEma20,
    h1_down_ema20_below_ema50: ema20BelowEma50,
    h1_down_ema50_below_ema200: ema50BelowEma200,
    h1_down_rsi_in_band: rsiInSellBand,
    h1_up_failure_components: upFailures,
    h1_down_failure_components: downFailures
  };
}
