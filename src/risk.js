function envNum(name, fallback) { const n = Number(process.env[name]); return Number.isFinite(n) ? n : fallback; }
export function getRiskLimits() {
  return {
    maxRiskPct: Math.max(0.01, envNum('MAX_RISK_PER_TRADE_PCT', 0.25)),
    maxDailyLossPct: Math.max(0.1, envNum('MAX_DAILY_LOSS_PCT', 2)),
    maxDrawdownPct: Math.max(0.1, envNum('MAX_DRAWDOWN_PCT', 5)),
    maxOpenPositions: Math.max(0, Math.floor(envNum('MAX_OPEN_POSITIONS', 1))),
    maxSpreadPrice: Math.max(0, envNum('MAX_SPREAD_PRICE', 0.50)),
    minConfidence: Math.min(1, Math.max(0.5, envNum('MIN_CONFIDENCE', 0.70))),
    minRR: Math.max(1, envNum('MIN_RR', 1.50)),
    maxSignalAgeSeconds: Math.max(15, envNum('MAX_SIGNAL_AGE_SECONDS', 90)),
    minStopDistancePrice: Math.max(0, envNum('MIN_STOP_DISTANCE_PRICE', 0.50)),
    maxStopDistancePrice: Math.max(1, envNum('MAX_STOP_DISTANCE_PRICE', 20)),
    minStopAtrMultiple: Math.max(0, envNum('MIN_STOP_ATR_MULTIPLE', 0.50)),
    maxStopAtrMultiple: Math.max(0, envNum('MAX_STOP_ATR_MULTIPLE', 2.00)),
    maxEntryDeviationPrice: Math.max(0, envNum('MAX_ENTRY_DEVIATION_PRICE', 1.00))
  };
}
export function calculateLots({ equity, riskPct, entry, stopLoss, tickSize, tickValue, minLot = 0.01, maxLot = 100, lotStep = 0.01 }) {
  const vals = [equity, riskPct, entry, stopLoss, tickSize, tickValue, minLot, maxLot, lotStep];
  if (!vals.every(Number.isFinite)) return { lots: 0, error: 'non_numeric_risk_inputs' };
  if (equity <= 0 || riskPct <= 0 || tickSize <= 0 || tickValue <= 0 || minLot <= 0 || maxLot < minLot || lotStep <= 0) return { lots: 0, error: 'invalid_risk_inputs' };
  const stopDistance = Math.abs(entry - stopLoss);
  if (stopDistance <= 0) return { lots: 0, error: 'stop_distance_zero' };
  const riskCash = equity * (riskPct / 100);
  const riskPerLot = (stopDistance / tickSize) * tickValue;
  if (riskPerLot <= 0) return { lots: 0, error: 'risk_per_lot_zero' };
  const rawLots = riskCash / riskPerLot;
  if (rawLots + 1e-12 < minLot) return { lots: 0, error: 'raw_lots_below_min_lot', riskCash, riskPerLot, rawLots, stopDistance };
  const stepped = Math.floor((rawLots + 1e-12) / lotStep) * lotStep;
  if (stepped + 1e-12 < minLot) return { lots: 0, error: 'stepped_lots_below_min_lot', riskCash, riskPerLot, rawLots, stopDistance };
  return { lots: Math.min(maxLot, Math.max(minLot, Number(stepped.toFixed(8)))), riskCash, riskPerLot, rawLots, stopDistance };
}
export function evaluateRisk({ decision, features, account, signalCreatedAt = Date.now(), now = Date.now(), limits = getRiskLimits() }) {
  const reasons = [], d = decision || {}, a = account || {};
  const direction = String(d.decision || 'WAIT').toUpperCase();
  const ageSeconds = Math.max(0, (now - signalCreatedAt) / 1000);
  const barAgeSeconds = Number.isFinite(Number(features.barTime)) && Number(features.barTime) > 0 ? Math.max(0, (now - Number(features.barTime) * 1000) / 1000) : Number.POSITIVE_INFINITY;
  if (!['BUY','SELL','WAIT'].includes(direction)) reasons.push('invalid_decision');
  if (direction === 'WAIT') reasons.push('decision_wait');
  if (!(Number(d.confidence) >= limits.minConfidence && Number(d.confidence) <= 1)) reasons.push('confidence_out_of_range_or_below_threshold');
  if (direction !== 'WAIT' && !(Number(d.risk_reward) >= limits.minRR)) reasons.push('rr_below_threshold');
  if (direction !== 'WAIT' && d.candidate && direction !== String(d.candidate).toUpperCase()) reasons.push('ai_direction_conflicts_with_candidate');
  const fundamental = d.fundamental || {};
  const fundamentalBias = String(fundamental.bias || 'INSUFFICIENT').toUpperCase();
  const fundamentalConfidence = Number(fundamental.confidence);
  const fundamentalFreshness = String(fundamental.freshness || 'INSUFFICIENT').toUpperCase();
  if (direction !== 'WAIT') {
    if (!['BULLISH_GOLD','BEARISH_GOLD','NEUTRAL','INSUFFICIENT'].includes(fundamentalBias)) reasons.push('invalid_fundamental_bias');
    if (!(Number.isFinite(fundamentalConfidence) && fundamentalConfidence >= 0 && fundamentalConfidence <= 1)) reasons.push('invalid_fundamental_confidence');
    if (!['CURRENT','MIXED','STALE','INSUFFICIENT'].includes(fundamentalFreshness)) reasons.push('invalid_fundamental_freshness');
    if (fundamentalBias === 'INSUFFICIENT' || fundamentalFreshness === 'STALE' || fundamentalFreshness === 'INSUFFICIENT') reasons.push('fundamental_data_insufficient');
    if (fundamentalConfidence >= 0.70 && ((direction === 'BUY' && fundamentalBias === 'BEARISH_GOLD') || (direction === 'SELL' && fundamentalBias === 'BULLISH_GOLD'))) reasons.push('fundamental_conflict');
  }
  if (Number(features.spread) > limits.maxSpreadPrice) reasons.push('spread_too_wide');
  if (ageSeconds > limits.maxSignalAgeSeconds || barAgeSeconds > limits.maxSignalAgeSeconds) reasons.push('signal_expired');
  if (Number(a.open_positions || 0) >= limits.maxOpenPositions) reasons.push('max_open_positions');
  if (Number(a.daily_pnl_pct || 0) <= -Math.abs(limits.maxDailyLossPct)) reasons.push('daily_loss_limit');
  if (Number(a.drawdown_pct || 0) >= Math.abs(limits.maxDrawdownPct)) reasons.push('drawdown_limit');
  if (direction !== 'WAIT' && a.risk_data_ready !== true) reasons.push('risk_data_not_ready');
  if (direction !== 'WAIT' && Number(a.trade_allowed || 0) !== 1) reasons.push('broker_trade_not_allowed');
  let actualRR = 0, lotSizing = null;
  if (direction !== 'WAIT') {
    const entry = Number(d.entry), sl = Number(d.stop_loss), tp = Number(d.take_profit);
    if (![entry,sl,tp].every(Number.isFinite) || entry <= 0 || sl <= 0 || tp <= 0) reasons.push('invalid_trade_prices');
    else {
      const stopDistance = Math.abs(entry-sl), tpDistance=Math.abs(tp-entry);
      actualRR = stopDistance>0 ? tpDistance/stopDistance : 0;
      const m5Atr=Number(features.m5?.atr14||0);
      const minStop=Math.max(limits.minStopDistancePrice, m5Atr>0?m5Atr*limits.minStopAtrMultiple:0);
      const h1Atr=Number(features.h1?.atr14||0);
      const maxStop=Math.min(limits.maxStopDistancePrice,h1Atr>0?h1Atr*limits.maxStopAtrMultiple:limits.maxStopDistancePrice);
      if(stopDistance<minStop) reasons.push('stop_too_close');
      if(stopDistance>maxStop) reasons.push('stop_too_far');
      if(actualRR<limits.minRR) reasons.push('actual_rr_below_threshold');
      const current=direction==='BUY'?Number(features.ask):Number(features.bid);
      if(current>0 && Math.abs(entry-current)>limits.maxEntryDeviationPrice) reasons.push('entry_too_far_from_market');
      if(direction==='BUY' && !(sl<entry && tp>entry)) reasons.push('buy_price_geometry_invalid');
      if(direction==='SELL' && !(sl>entry && tp<entry)) reasons.push('sell_price_geometry_invalid');
      if(!(tpDistance>0)) reasons.push('take_profit_invalid');
      if(Number(a.tick_size)>0 && Number(a.tick_value)>0) {
        lotSizing=calculateLots({equity:Number(a.equity),riskPct:limits.maxRiskPct,entry,stopLoss:sl,tickSize:Number(a.tick_size),tickValue:Number(a.tick_value),minLot:Number(a.min_lot??0.01),maxLot:Number(a.max_lot??100),lotStep:Number(a.lot_step??0.01)});
        if(lotSizing.error) reasons.push(`lot_sizing_${lotSizing.error}`);
      } else reasons.push('lot_sizing_missing_symbol_spec');
      if(!Number.isFinite(Number(lotSizing?.lots)) || Number(lotSizing?.lots)<=0) reasons.push('invalid_calculated_lots');
    }
  }
  return { approved: reasons.length===0, reasons, ageSeconds, barAgeSeconds, lots:lotSizing?.lots??0, riskCash:lotSizing?.riskCash??0, actualRR };
}
export function safeDecision(decision={}) {
  const confidence=Number(decision.confidence);
  const fundamental=decision?.fundamental||{};
  const fundamentalConfidence=Number(fundamental.confidence);
  return {
    decision:String(decision.decision||'WAIT').toUpperCase(), confidence:Number.isFinite(confidence)?confidence:0,
    market_regime:String(decision.market_regime||'UNCLEAR').toUpperCase(), entry:Number(decision.entry||0), stop_loss:Number(decision.stop_loss||0),
    take_profit:Number(decision.take_profit||0), risk_reward:Number(decision.risk_reward||0), reason:String(decision.reason||''),
    invalid_reasons:Array.isArray(decision.invalid_reasons)?decision.invalid_reasons.map(String):[],
    fundamental:{
      bias:String(fundamental.bias||'INSUFFICIENT').toUpperCase(),
      confidence:Number.isFinite(fundamentalConfidence)?fundamentalConfidence:0,
      freshness:String(fundamental.freshness||'INSUFFICIENT').toUpperCase(),
      summary:String(fundamental.summary||''),
      drivers:Array.isArray(fundamental.drivers)?fundamental.drivers.map(String):[],
      risks:Array.isArray(fundamental.risks)?fundamental.risks.map(String):[]
    }
  };
}