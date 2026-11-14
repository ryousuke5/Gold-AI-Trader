const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const validBars = value => Array.isArray(value)
  ? value.filter(bar => bar && [bar.time, bar.open, bar.high, bar.low, bar.close].every(v => Number.isFinite(Number(v))) &&
      Number(bar.time) > 0 && Number(bar.high) >= Number(bar.low))
      .map(bar => ({
        time: Number(bar.time),
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: numberOrNull(bar.volume)
      }))
      .sort((a, b) => a.time - b.time)
  : [];

function signed(value, side) {
  return Number(value) * (side === 'BUY' ? 1 : -1);
}

function buildH1Context(features, side) {
  const h1 = features?.h1 || {};
  const bars = validBars(features?.recentH1).slice(-24);
  const atr = numberOrNull(h1.atr14);
  const close = numberOrNull(h1.close);
  const ema20 = numberOrNull(h1.ema20);
  const ema50 = numberOrNull(h1.ema50);
  const ema200 = numberOrNull(h1.ema200);
  if (!(atr > 0)) return { available: false, reason: 'h1_atr_missing' };

  const directionalMomentum = count => {
    if (bars.length < count + 1) return null;
    return signed(bars.at(-1).close - bars.at(-(count + 1)).close, side) / atr;
  };

  const recentMoves = bars.slice(-7);
  let consistency = null;
  let bodyEfficiency = null;
  if (recentMoves.length >= 7) {
    let aligned = 0;
    let signedBody = 0;
    let totalRange = 0;
    for (let i = 1; i < recentMoves.length; i += 1) {
      if (signed(recentMoves[i].close - recentMoves[i - 1].close, side) > 0) aligned += 1;
    }
    for (const bar of recentMoves) {
      signedBody += signed(bar.close - bar.open, side);
      totalRange += Math.max(0, bar.high - bar.low);
    }
    consistency = aligned / 6;
    bodyEfficiency = totalRange > 0 ? signedBody / totalRange : null;
  }

  let barsSinceBreakout = null;
  if (bars.length >= 13) {
    let lastBreakoutIndex = -1;
    for (let i = 12; i < bars.length; i += 1) {
      const prior = bars.slice(i - 12, i);
      const priorExtreme = side === 'BUY'
        ? Math.max(...prior.map(bar => bar.high))
        : Math.min(...prior.map(bar => bar.low));
      const broke = side === 'BUY'
        ? bars[i].close > priorExtreme
        : bars[i].close < priorExtreme;
      if (broke) lastBreakoutIndex = i;
    }
    if (lastBreakoutIndex >= 0) barsSinceBreakout = bars.length - 1 - lastBreakoutIndex;
  }

  return {
    available: true,
    close_vs_ema20_atr: close === null || ema20 === null ? null : (close - ema20) / atr,
    ema20_vs_ema50_atr: ema20 === null || ema50 === null ? null : (ema20 - ema50) / atr,
    ema50_vs_ema200_atr: ema50 === null || ema200 === null ? null : (ema50 - ema200) / atr,
    ema_stack_state: ema20 === null || ema50 === null || ema200 === null
      ? 'UNKNOWN'
      : ema20 > ema50 && ema50 > ema200 ? 'BULLISH'
        : ema20 < ema50 && ema50 < ema200 ? 'BEARISH' : 'MIXED',
    rsi14: numberOrNull(h1.rsi14),
    momentum_3h_atr_directional: directionalMomentum(3),
    momentum_6h_atr_directional: directionalMomentum(6),
    directional_close_consistency_6h: consistency,
    directional_body_efficiency_6h: bodyEfficiency,
    bars_since_last_12bar_directional_breakout: barsSinceBreakout,
    bars_used: bars.length,
    ema_slope_3bar_atr: null,
    ema_slope_status: 'NOT_SENT_BY_V19'
  };
}

function buildM5Context(features, setup, side, riskDistance) {
  const m5 = features?.m5 || {};
  const diagnostics = setup?.diagnostics && typeof setup.diagnostics === 'object' ? setup.diagnostics : {};
  const atr = numberOrNull(m5.atr14);
  const signalBar = validBars(features?.recentM5).at(-1);
  return {
    signal_bar_time_epoch: signalBar?.time ?? numberOrNull(features?.barTime),
    m5_rsi14: numberOrNull(m5.rsi14),
    m5_atr14: atr,
    m5_ema20_distance_atr_directional: signalBar && atr > 0 && numberOrNull(m5.ema20) !== null
      ? signed(signalBar.close - Number(m5.ema20), side) / atr : null,
    range_atr: numberOrNull(diagnostics.range_atr),
    body_atr: numberOrNull(diagnostics.body_atr),
    close_location: numberOrNull(diagnostics.close_location),
    volume_ratio: numberOrNull(diagnostics.volume_ratio),
    breakout_atr: numberOrNull(diagnostics.breakout_atr),
    stop_atr: numberOrNull(diagnostics.stop_atr) ?? (atr > 0 ? riskDistance / atr : null),
    signal_volume: numberOrNull(diagnostics.signal_volume),
    average_volume: numberOrNull(diagnostics.average_volume),
    spread_price: numberOrNull(features?.spread),
    spread_atr: atr > 0 ? numberOrNull(features?.spread) / atr : null
  };
}

/**
 * Build an immutable, non-executable research observation from a confirmed
 * deterministic GOLD V2 candidate. It never changes a trading decision.
 */
export function buildGoldForwardResearchObservation({
  signalId,
  signal = {},
  setup = {},
  features = {},
  marketSafety = {},
  risk = {},
  decision = {},
  state = {},
  createdAt = new Date().toISOString()
} = {}) {
  const side = String(setup?.candidate || signal?.candidate || '').toUpperCase();
  if (!['BUY', 'SELL'].includes(side)) return null;
  if (marketSafety?.allowed !== true) return null;

  const entry = numberOrNull(setup?.entry_reference);
  const stop = numberOrNull(setup?.stop_loss);
  const target = numberOrNull(setup?.take_profit);
  const riskDistance = entry !== null && stop !== null ? Math.abs(entry - stop) : null;
  const barTime = numberOrNull(features?.barTime);
  const m5Bars = validBars(features?.recentM5);
  const signalBar = m5Bars.at(-1);
  if (!(entry > 0) || !(stop > 0) || !(target > 0) || !(riskDistance > 0) ||
      !(barTime > 0) || !signalBar || signalBar.time !== barTime) return null;

  const symbol = String(signal?.symbol || features?.symbol || '').trim();
  const strategyVersion = String(signal?.strategy_version || '').trim();
  if (!symbol || !strategyVersion) return null;

  return {
    observation_key: [symbol, signal?.timeframe || 'M5', Math.floor(barTime), strategyVersion].join(':'),
    signal_id: signalId,
    symbol,
    timeframe: String(signal?.timeframe || 'M5'),
    strategy_version: strategyVersion,
    side,
    signal_bar_time: new Date(barTime * 1000).toISOString(),
    entry_reference: entry,
    stop_loss: stop,
    take_profit: target,
    risk_distance: riskDistance,
    entry_atr: numberOrNull(features?.m5?.atr14),
    entry_spread: numberOrNull(features?.spread),
    setup_type: String(setup?.setup_type || ''),
    setup_reason: String(setup?.reason || ''),
    entry_context: {
      telemetry_version: 1,
      mode: 'FORWARD_PAPER_RESEARCH',
      orders_executed: false,
      market_safety_allowed: true,
      risk_approved: risk?.approved === true,
      ai_decision: String(decision?.decision || 'WAIT').toUpperCase(),
      system_mode: String(state?.mode || 'ANALYSIS').toUpperCase(),
      auto_trading_enabled: state?.auto_trading_enabled === true,
      entry_bid: numberOrNull(features?.bid),
      entry_ask: numberOrNull(features?.ask),
      quote_spread_price: numberOrNull(features?.spread),
      quote_spread_atr: Number(features?.m5?.atr14) > 0
        ? numberOrNull(features?.spread) / Number(features.m5.atr14) : null
    },
    h1_context: buildH1Context(features, side),
    m5_context: buildM5Context(features, setup, side, riskDistance),
    outcome_15m: null,
    outcome_30m: null,
    status: 'PENDING',
    created_at: createdAt,
    updated_at: createdAt
  };
}

function buildHorizonOutcome(observation, recentM5, horizonMinutes, currentBarTime) {
  const entryTime = Math.floor(new Date(observation.signal_bar_time).getTime() / 1000);
  const horizonSeconds = horizonMinutes * 60;
  if (!Number.isFinite(entryTime) || currentBarTime < entryTime + horizonSeconds) return null;

  const expectedBars = horizonMinutes / 5;
  const futureBars = validBars(recentM5).filter(bar => bar.time > entryTime && bar.time <= entryTime + horizonSeconds);
  const expectedTimes = Array.from({ length: expectedBars }, (_, index) => entryTime + (index + 1) * 300);
  const byTime = new Map(futureBars.map(bar => [bar.time, bar]));
  const windowBars = expectedTimes.map(time => byTime.get(time)).filter(Boolean);
  const complete = windowBars.length === expectedBars;
  const side = String(observation.side).toUpperCase();
  const entry = Number(observation.entry_reference);
  const stop = Number(observation.stop_loss);
  const target = Number(observation.take_profit);
  const riskDistance = Number(observation.risk_distance);
  const atr = numberOrNull(observation.entry_atr);
  const observedHigh = windowBars.length ? Math.max(...windowBars.map(bar => bar.high)) : null;
  const observedLow = windowBars.length ? Math.min(...windowBars.map(bar => bar.low)) : null;
  const favorable = observedHigh === null ? null
    : Math.max(0, side === 'BUY' ? observedHigh - entry : entry - observedLow);
  const adverse = observedLow === null ? null
    : Math.max(0, side === 'BUY' ? entry - observedLow : observedHigh - entry);

  let firstTouch = null;
  let ambiguousSameBar = false;
  for (const bar of windowBars) {
    const stopTouched = side === 'BUY' ? bar.low <= stop : bar.high >= stop;
    const targetTouched = side === 'BUY' ? bar.high >= target : bar.low <= target;
    if (stopTouched && targetTouched) {
      firstTouch = 'AMBIGUOUS_SAME_BAR';
      ambiguousSameBar = true;
      break;
    }
    if (stopTouched) { firstTouch = 'STOP_FIRST'; break; }
    if (targetTouched) { firstTouch = 'TARGET_FIRST'; break; }
  }

  return {
    horizon_minutes: horizonMinutes,
    window_start_utc: new Date((entryTime + 300) * 1000).toISOString(),
    window_end_utc: new Date((entryTime + horizonSeconds) * 1000).toISOString(),
    observed_through_bar_time_utc: windowBars.length
      ? new Date(windowBars[windowBars.length - 1].time * 1000).toISOString() : null,
    expected_bars: expectedBars,
    observed_bars: windowBars.length,
    missing_bar_times_utc: expectedTimes.filter(time => !byTime.has(time)).map(time => new Date(time * 1000).toISOString()),
    data_quality_status: complete ? 'COMPLETE' : 'DATA_GAP',
    window_complete: complete,
    mfe_price: complete ? favorable : null,
    mae_price: complete ? adverse : null,
    mfe_r: complete && riskDistance > 0 ? favorable / riskDistance : null,
    mae_r: complete && riskDistance > 0 ? adverse / riskDistance : null,
    mfe_atr: complete && atr > 0 ? favorable / atr : null,
    mae_atr: complete && atr > 0 ? adverse / atr : null,
    stop_touched: complete ? windowBars.some(bar => side === 'BUY' ? bar.low <= stop : bar.high >= stop) : null,
    target_touched: complete ? windowBars.some(bar => side === 'BUY' ? bar.high >= target : bar.low <= target) : null,
    first_touch: complete ? firstTouch : null,
    same_bar_stop_target_ambiguous: complete ? ambiguousSameBar : null,
    note: 'OHLC path inside each M5 candle is unknown; same-bar stop/target touches are not ordered.'
  };
}

/**
 * Return only the columns that should be patched on a pending observation.
 * A horizon is written once. A data gap is retained as a quality result and
 * never silently treated as a no-movement outcome.
 */
export function advanceGoldForwardResearchObservation({
  observation,
  features = {},
  observedAt = new Date().toISOString()
} = {}) {
  if (!observation || observation.status !== 'PENDING') return null;
  const currentBarTime = numberOrNull(features?.barTime);
  if (!(currentBarTime > 0)) return null;

  const patch = { updated_at: observedAt };
  if (!observation.outcome_15m) {
    const outcome = buildHorizonOutcome(observation, features.recentM5, 15, currentBarTime);
    if (outcome) patch.outcome_15m = outcome;
  }
  if (!observation.outcome_30m) {
    const outcome = buildHorizonOutcome(observation, features.recentM5, 30, currentBarTime);
    if (outcome) {
      patch.outcome_30m = outcome;
      patch.status = 'COMPLETED';
      patch.completed_at = observedAt;
    }
  }
  return Object.keys(patch).length > 1 ? patch : null;
}
