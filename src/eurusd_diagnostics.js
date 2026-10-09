const H1_UNCLEAR_REASON_MAP = Object.freeze({
  m15_ema_not_aligned: 'm15_ema_not_evaluated_h1_unclear',
  m15_rsi_out_of_breakout_zone: 'm15_rsi_not_evaluated_h1_unclear',
  breakout_penetration_too_small: 'breakout_penetration_not_evaluated_h1_unclear',
  breakout_close_location_weak: 'breakout_close_location_not_evaluated_h1_unclear'
});

/**
 * Reclassify only direction-dependent WAIT diagnostics when H1 has no defined
 * direction. This changes explanatory reason labels only; it never changes
 * candidate, entry/SL/TP, risk, or order eligibility.
 */
export function normalizeEurUsdDirectionalDiagnostics(setup) {
  if (!setup || typeof setup !== 'object' || setup.trend !== 'RANGE' || !Array.isArray(setup.reasons)) {
    return setup;
  }

  return {
    ...setup,
    reasons: setup.reasons.map(reason => H1_UNCLEAR_REASON_MAP[String(reason)] || reason)
  };
}
