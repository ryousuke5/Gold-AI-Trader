import { calculateLots } from './risk.js';

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

export function getEurUsdRiskLimits() {
  return {
    maxRiskPct: Math.max(0.01, envNum('EURUSD_MAX_RISK_PER_TRADE_PCT', 0.25)),
    maxDailyLossPct: Math.max(0.1, envNum('EURUSD_MAX_DAILY_LOSS_PCT', 2)),
    maxDrawdownPct: Math.max(0.1, envNum('EURUSD_MAX_DRAWDOWN_PCT', 5)),
    maxOpenPositions: Math.max(0, Math.floor(envNum('EURUSD_MAX_OPEN_POSITIONS', 1))),
    maxSpreadPips: Math.max(0.1, envNum('EURUSD_MAX_SPREAD_PIPS', 1.20)),
    maxSpreadToTpPct: Math.max(1, envNum('EURUSD_MAX_SPREAD_TO_TP_PCT', 12)),
    minConfidence: Math.min(1, Math.max(0.5, envNum('EURUSD_MIN_SETUP_CONFIDENCE', 0.95))),
    minAiEnvironmentConfidence: Math.min(
      1,
      Math.max(0.5, envNum('EURUSD_MIN_AI_ENVIRONMENT_CONFIDENCE', envNum('EURUSD_MIN_FUNDAMENTAL_CONFIDENCE', 0.65)))
    ),
    minRR: Math.max(1, envNum('EURUSD_MIN_RR', 1.80)),
    maxSignalAgeSeconds: Math.max(60, envNum('EURUSD_MAX_SIGNAL_AGE_SECONDS', 900)),
    minStopAtr: Math.max(0.1, envNum('EURUSD_MIN_STOP_ATR', 0.50)),
    maxStopAtr: Math.max(0.2, envNum('EURUSD_MAX_STOP_ATR', 1.50)),
    spreadAtrPctMax: Math.max(1, envNum('EURUSD_MAX_SPREAD_ATR_PCT', 15)),
    highImpactEventBlock: String(process.env.EURUSD_BLOCK_HIGH_IMPACT_24H ?? 'true').toLowerCase() !== 'false',
    aiEnvironmentRequired: String(process.env.EURUSD_AI_ENVIRONMENT_REQUIRED ?? 'true').toLowerCase() !== 'false'
  };
}

export function evaluateEurUsdRisk({
  decision,
  setup,
  features,
  account,
  signalCreatedAt = Date.now(),
  now = Date.now(),
  fundamentalAssessment = null
}) {
  const limits = getEurUsdRiskLimits();
  const reasons = [];
  const d = decision || {};
  const a = account || {};
  const direction = String(d.decision || 'WAIT').toUpperCase();
  const candidate = String(d.candidate || setup?.candidate || 'WAIT').toUpperCase();
  const ageSeconds = Math.max(0, (now - signalCreatedAt) / 1000);
  const barAgeSeconds = Number.isFinite(Number(features.barTime)) && features.barTime > 0
    ? Math.max(0, (now - features.barTime * 1000) / 1000)
    : Infinity;

  if (!['BUY', 'SELL', 'WAIT'].includes(direction)) reasons.push('invalid_decision');
  if (direction === 'WAIT') reasons.push('decision_wait');
  if (direction !== 'WAIT' && candidate !== direction) reasons.push('candidate_direction_mismatch');

  if (direction !== 'WAIT') {
    if (!(Number(d.confidence) >= limits.minConfidence && Number(d.confidence) <= 1)) {
      reasons.push('setup_confidence_below_threshold');
    }
    if (!(Number(d.risk_reward) >= limits.minRR)) reasons.push('rr_below_threshold');

    const pipSize = 0.0001;
    const spreadPips = Number(features.spread) > 0 ? Number(features.spread) / pipSize : Infinity;
    if (!Number.isFinite(spreadPips) || spreadPips > limits.maxSpreadPips) {
      reasons.push('spread_too_wide_or_missing');
    }

    const setupSpreadToTp = Number(setup?.spread_to_tp_pct);
    if (Number.isFinite(setupSpreadToTp) && setupSpreadToTp > limits.maxSpreadToTpPct) {
      reasons.push('spread_too_large_vs_target');
    }

    const setupSpreadAtr = Number(setup?.spread_atr_pct);
    if (!Number.isFinite(setupSpreadAtr) || setupSpreadAtr > limits.spreadAtrPctMax) {
      reasons.push('spread_too_large_vs_atr_or_missing');
    }

    if (ageSeconds > limits.maxSignalAgeSeconds || barAgeSeconds > limits.maxSignalAgeSeconds) {
      reasons.push('signal_expired');
    }
    if (Number(a.open_positions || 0) >= limits.maxOpenPositions) reasons.push('max_open_positions');
    if (Number(a.daily_pnl_pct || 0) <= -Math.abs(limits.maxDailyLossPct)) reasons.push('daily_loss_limit');
    if (Number(a.drawdown_pct || 0) >= Math.abs(limits.maxDrawdownPct)) reasons.push('drawdown_limit');
    if (a.risk_data_ready !== true) reasons.push('risk_data_not_ready');
    if (Number(a.trade_allowed || 0) !== 1) reasons.push('broker_trade_not_allowed');

    const f = fundamentalAssessment || {};
    const environment = String(f.environment || d.ai_environment || 'INSUFFICIENT').toUpperCase();
    const aiConfidence = Number(f.confidence ?? d.ai_environment_confidence);
    const freshness = String(f.freshness || 'INSUFFICIENT').toUpperCase();
    const eventRisk = String(f.event_risk_next_24h || 'UNKNOWN').toUpperCase();

    if (limits.aiEnvironmentRequired) {
      if (!['FAVORABLE', 'CAUTION', 'UNFAVORABLE', 'INSUFFICIENT'].includes(environment)) {
        reasons.push('invalid_ai_environment');
      }
      if (!(Number.isFinite(aiConfidence) && aiConfidence >= limits.minAiEnvironmentConfidence && aiConfidence <= 1)) {
        reasons.push('ai_environment_confidence_below_threshold');
      }
      if (!['CURRENT', 'MIXED'].includes(freshness)) reasons.push('ai_environment_not_current');
      if (environment !== 'FAVORABLE') reasons.push('ai_environment_not_favorable');
      if (eventRisk === 'UNKNOWN') reasons.push('event_risk_unknown');
      if (eventRisk === 'HIGH' && limits.highImpactEventBlock) reasons.push('high_impact_event_next_24h');
    }

    const entry = Number(d.entry);
    const sl = Number(d.stop_loss);
    const tp = Number(d.take_profit);

    if (![entry, sl, tp].every(Number.isFinite) || entry <= 0 || sl <= 0 || tp <= 0) {
      reasons.push('invalid_trade_prices');
    } else {
      const stopDistance = Math.abs(entry - sl);
      const tpDistance = Math.abs(tp - entry);
      const atr = Number(features.m15?.atr14 || 0);
      const stopAtr = atr > 0 ? stopDistance / atr : Infinity;
      const rr = stopDistance > 0 ? tpDistance / stopDistance : 0;

      if (!(stopAtr >= limits.minStopAtr && stopAtr <= limits.maxStopAtr)) {
        reasons.push('stop_distance_outside_atr_band');
      }
      if (rr < limits.minRR) reasons.push('actual_rr_below_threshold');

      const current = direction === 'BUY' ? Number(features.ask) : Number(features.bid);
      if (!(current > 0) || Math.abs(entry - current) > Math.max(features.point * 3, 0.00005)) {
        reasons.push('entry_not_at_market');
      }
      if (direction === 'BUY' && !(sl < entry && tp > entry)) reasons.push('buy_price_geometry_invalid');
      if (direction === 'SELL' && !(sl > entry && tp < entry)) reasons.push('sell_price_geometry_invalid');

      if (Number(a.tick_size) > 0 && Number(a.tick_value) > 0) {
        const sizing = calculateLots({
          equity: Number(a.equity),
          riskPct: limits.maxRiskPct,
          entry,
          stopLoss: sl,
          tickSize: Number(a.tick_size),
          tickValue: Number(a.tick_value),
          minLot: Number(a.min_lot ?? 0.01),
          maxLot: Number(a.max_lot ?? 100),
          lotStep: Number(a.lot_step ?? 0.01)
        });

        if (sizing.error) reasons.push('lot_sizing_' + sizing.error);
        if (!(Number(sizing.lots) > 0)) reasons.push('invalid_calculated_lots');

        return {
          approved: reasons.length === 0,
          reasons: [...new Set(reasons)],
          ageSeconds,
          barAgeSeconds,
          lots: Number(sizing.lots || 0),
          riskCash: Number(sizing.riskCash || 0),
          actualRR: rr,
          stopAtr,
          spreadPips
        };
      }

      reasons.push('lot_sizing_missing_symbol_spec');
    }
  }

  return {
    approved: reasons.length === 0,
    reasons: [...new Set(reasons)],
    ageSeconds,
    barAgeSeconds,
    lots: 0,
    riskCash: 0,
    actualRR: 0,
    stopAtr: 0,
    spreadPips: features.point > 0 ? Number(features.spread) / (features.point * 10) : 0
  };
}
