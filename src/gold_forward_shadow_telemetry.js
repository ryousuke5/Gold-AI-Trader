const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const numberOrNull = (value) => finite(value) ? Number(value) : null;
const epochSeconds = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
};
const isoTime = (value) => {
  const seconds = epochSeconds(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
};
const validSide = (value) => ['BUY', 'SELL'].includes(String(value || '').toUpperCase());

const directionForSide = (side) => side === 'BUY' ? 1 : -1;

/**
 * Builds entry-time H1 context exclusively from completed H1 bars.
 * recentH1 rows must carry timestamp (bar open), close, EMA20/50/200 and ATR14.
 * The final M5 signal bar is treated as completed at barTime + 300 seconds.
 */
export function buildGoldForwardH1Telemetry(features = {}, side = 'BUY') {
  const normalizedSide = String(side || '').toUpperCase();
  if (!validSide(normalizedSide)) {
    return { schema_version: 1, quality: 'INVALID_SIDE', reason: 'side_must_be_BUY_or_SELL' };
  }

  const signalBarTime = numberOrNull(features.barTime ?? features.bar_time);
  if (!(signalBarTime > 0)) {
    return { schema_version: 1, quality: 'MISSING', reason: 'missing_m5_signal_bar_time' };
  }
  const signalCloseTime = signalBarTime + 300;
  const sourceBars = Array.isArray(features.recentH1)
    ? features.recentH1
    : Array.isArray(features.recent_h1) ? features.recent_h1 : [];

  const rows = sourceBars
    .map((bar) => ({
      time: numberOrNull(bar?.time),
      close: numberOrNull(bar?.close),
      ema20: numberOrNull(bar?.ema20),
      ema50: numberOrNull(bar?.ema50),
      ema200: numberOrNull(bar?.ema200),
      atr14: numberOrNull(bar?.atr14)
    }))
    .filter((bar) =>
      bar.time !== null &&
      bar.close !== null &&
      bar.ema20 !== null &&
      bar.ema50 !== null &&
      bar.ema200 !== null &&
      bar.atr14 !== null &&
      bar.atr14 > 0 &&
      // H1 bar timestamp is its open time; do not use an unfinished H1 bar.
      bar.time + 3600 <= signalCloseTime
    )
    .sort((a, b) => a.time - b.time);

  const deduped = [];
  for (const bar of rows) {
    if (deduped.length && deduped.at(-1).time === bar.time) deduped[deduped.length - 1] = bar;
    else deduped.push(bar);
  }
  if (deduped.length < 4) {
    return {
      schema_version: 1,
      quality: 'INSUFFICIENT_HISTORY',
      reason: 'need_four_completed_h1_bars_with_ema_series',
      completed_h1_bars_available: deduped.length
    };
  }

  // Work only with the contiguous suffix so a missing H1 candle cannot
  // silently turn a multi-hour EMA change into a three-bar slope.
  const contiguous = [deduped.at(-1)];
  for (let i = deduped.length - 2; i >= 0 && contiguous.length < 64; i--) {
    if (contiguous[0].time - deduped[i].time !== 3600) break;
    contiguous.unshift(deduped[i]);
  }
  if (contiguous.length < 4) {
    return {
      schema_version: 1,
      quality: 'H1_GAP',
      reason: 'fewer_than_four_contiguous_completed_h1_bars',
      completed_h1_bars_available: deduped.length,
      contiguous_h1_bars_available: contiguous.length
    };
  }

  const latest = contiguous.at(-1);
  const threeBack = contiguous.at(-4);
  const oneBack = contiguous.at(-2);
  const atr = latest.atr14;
  const lastThreeDirectionalSteps = contiguous.slice(-4).map((bar, index, items) => {
    if (index === 0) return null;
    return directionForSide(normalizedSide) * (bar.ema20 - items[index - 1].ema20);
  }).filter((value) => value !== null);
  const slopeAgreementCount = lastThreeDirectionalSteps.filter((value) => value > 0).length;
  const direction = normalizedSide === 'BUY' ? 1 : -1;
  const aligned = (bar) => normalizedSide === 'BUY'
    ? bar.close > bar.ema20 && bar.ema20 > bar.ema50 && bar.ema50 > bar.ema200
    : bar.close < bar.ema20 && bar.ema20 < bar.ema50 && bar.ema50 < bar.ema200;

  let alignmentAge = 0;
  for (let i = contiguous.length - 1; i >= 0; i--) {
    if (!aligned(contiguous[i])) break;
    alignmentAge += 1;
  }

  return {
    schema_version: 1,
    quality: 'OK',
    source: 'completed_h1_ema_series',
    side: normalizedSide,
    latest_completed_h1_open_time_utc: new Date(latest.time * 1000).toISOString(),
    completed_h1_bars_used: contiguous.length,
    h1_ema20_slope_1bar_atr: (latest.ema20 - oneBack.ema20) / atr,
    h1_ema20_slope_3bar_atr: (latest.ema20 - threeBack.ema20) / atr,
    h1_directional_ema20_slope_1bar_atr: direction * (latest.ema20 - oneBack.ema20) / atr,
    h1_directional_ema20_slope_3bar_atr: direction * (latest.ema20 - threeBack.ema20) / atr,
    h1_directional_ema20_slope_agreement_count_last3: slopeAgreementCount,
    h1_directional_ema20_slope_agreement_ratio_last3: slopeAgreementCount / 3,
    h1_ema20_ema50_gap_atr: (latest.ema20 - latest.ema50) / atr,
    h1_directional_ema20_ema50_gap_atr: direction * (latest.ema20 - latest.ema50) / atr,
    h1_close_ema20_gap_atr: (latest.close - latest.ema20) / atr,
    h1_directional_close_ema20_gap_atr: direction * (latest.close - latest.ema20) / atr,
    h1_ema_alignment_age_bars: alignmentAge,
    h1_directionally_aligned: aligned(latest),
    h1_alignment_age_capped_by_history: alignmentAge === contiguous.length && contiguous.length === 64
  };
}

/**
 * Calculates MFE/MAE and early-path labels from completed M5 candles.
 * These are descriptive labels only. They must never be used to alter an
 * open position, signal eligibility, stop, target, or order permission.
 */
export function buildGoldForwardPathMetrics({
  side,
  entryPrice,
  stopPrice,
  targetPrice = null,
  bars = [],
} = {}) {
  const normalizedSide = String(side || '').toUpperCase();
  const entry = numberOrNull(entryPrice);
  const stop = numberOrNull(stopPrice);
  const riskDistance = entry !== null && stop !== null ? Math.abs(entry - stop) : 0;
  if (!validSide(normalizedSide) || !(entry > 0) || !(stop > 0) || !(riskDistance > 0)) {
    return { ok: false, error: 'valid_side_entry_price_and_stop_price_required' };
  }
  if (!Array.isArray(bars)) return { ok: false, error: 'bars_must_be_array' };
  const direction = normalizedSide === 'BUY' ? 1 : -1;
  // Fixed thresholds are pre-registered for this telemetry version: +0.25R and -0.50R.
  const favorableLevel = 0.25;
  const adverseLevel = 0.5;
  let mfeR = 0;
  let maeR = 0;
  let firstThreshold = null;
  let firstThresholdTime = null;
  let firstExitBarrier = null;
  let firstExitBarrierTime = null;
  let previousTime = null;
  let dataGapCount = 0;
  let maxGapSeconds = 0;
  const path = [];

  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index] || {};
    const time = numberOrNull(bar.time ?? bar.bar_time_epoch);
    const open = numberOrNull(bar.open);
    const high = numberOrNull(bar.high);
    const low = numberOrNull(bar.low);
    const close = numberOrNull(bar.close);
    if (time === null || open === null || high === null || low === null || close === null ||
        !(high >= low && high >= open && high >= close && low <= open && low <= close)) {
      return { ok: false, error: 'invalid_ohlc_bar', bar_index: index + 1 };
    }

    if (previousTime !== null && time <= previousTime) {
      return { ok: false, error: 'non_ascending_m5_bar_time', bar_index: index + 1 };
    }
    if (previousTime !== null && time - previousTime !== 300) {
      const gap = time - previousTime;
      dataGapCount += 1;
      maxGapSeconds = Math.max(maxGapSeconds, gap);
    }
    previousTime = time;

    const favorableMove = direction * (direction > 0 ? high - entry : low - entry);
    const adverseMove = -direction * (direction > 0 ? low - entry : high - entry);
    const closeMove = direction * (close - entry);
    mfeR = Math.max(mfeR, favorableMove / riskDistance, 0);
    maeR = Math.max(maeR, adverseMove / riskDistance, 0);
    const closeProgressR = closeMove / riskDistance;

    const favorableHit = favorableMove >= favorableLevel * riskDistance;
    const adverseHit = adverseMove >= adverseLevel * riskDistance;
    if (firstThreshold === null && (favorableHit || adverseHit)) {
      firstThreshold = favorableHit && adverseHit
        ? 'AMBIGUOUS_SAME_BAR'
        : favorableHit ? 'FAVORABLE_0_25R' : 'ADVERSE_0_50R';
      firstThresholdTime = new Date(time * 1000).toISOString();
    }

    const stopHit = direction > 0 ? low <= stop : high >= stop;
    const target = numberOrNull(bar.targetPrice ?? bar.target_price ?? targetPrice);
    const targetHit = target !== null && target > 0
      ? (direction > 0 ? high >= target : low <= target)
      : false;
    if (firstExitBarrier === null && (stopHit || targetHit)) {
      firstExitBarrier = stopHit && targetHit
        ? 'AMBIGUOUS_STOP_AND_TARGET_SAME_BAR'
        : stopHit ? 'STOP_TOUCHED' : 'TARGET_TOUCHED';
      firstExitBarrierTime = new Date(time * 1000).toISOString();
    }

    path.push({
      bars_since_entry: index + 1,
      bar_time_utc: new Date(time * 1000).toISOString(),
      mfe_r: Number(mfeR.toFixed(6)),
      mae_r: Number(maeR.toFixed(6)),
      close_progress_r: Number(closeProgressR.toFixed(6)),
      favorable_0_25r_touched: favorableHit,
      adverse_0_50r_touched: adverseHit
    });
  }

  const at = (barCount) => path.find((point) => point.bars_since_entry === barCount) || null;
  return {
    ok: true,
    schema_version: 1,
    side: normalizedSide,
    entry_price: entry,
    stop_price: stop,
    risk_distance_price: riskDistance,
    bars_observed: path.length,
    data_gap_count: dataGapCount,
    max_gap_seconds: maxGapSeconds,
    first_threshold,
    first_threshold_time_utc: firstThresholdTime,
    first_exit_barrier,
    first_exit_barrier_time_utc: firstExitBarrierTime,
    after_3_bars: at(3),
    after_6_bars: at(6),
    path
  };
}

const cleanText = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const requireIso = (value, key) => {
  const normalized = isoTime(value);
  return normalized ? { value: normalized } : { error: key + '_must_be_valid_iso_datetime' };
};
const validPrice = (value) => finite(value) && Number(value) > 0;

/**
 * Validates an ENTRY/BAR/GAP/EXIT event and returns the idempotent DB row.
 * Raw event payloads are intentionally whitelisted to keep the audit schema
 * small and prevent arbitrary request data from being persisted.
 */
export function normalizeGoldForwardShadowEvent(body = {}) {
  const eventType = cleanText(body.event_type, 12).toUpperCase();
  const entryId = cleanText(body.entry_id, 100);
  const symbol = cleanText(body.symbol, 32).toUpperCase();
  const strategyVersion = cleanText(body.strategy_version, 80);
  const side = cleanText(body.side, 8).toUpperCase();
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? body.payload : {};
  if (!['ENTRY', 'BAR', 'GAP', 'EXIT'].includes(eventType)) return { ok: false, error: 'unsupported_event_type' };
  if (entryId.length < 8) return { ok: false, error: 'entry_id_required' };
  if (!/^(XAUUSD|GOLD)([.#][A-Z0-9]*)?$/i.test(symbol)) return { ok: false, error: 'gold_symbol_required' };
  if (!strategyVersion) return { ok: false, error: 'strategy_version_required' };
  if (!validSide(side)) return { ok: false, error: 'side_must_be_BUY_or_SELL' };
  if (JSON.stringify(payload).length > 16000) return { ok: false, error: 'payload_too_large' };

  let eventTime;
  let normalizedPayload = {};
  const common = { entry_id: entryId, strategy_version: strategyVersion, side };
  if (eventType === 'ENTRY') {
    const signalTime = requireIso(payload.signal_time_utc, 'signal_time_utc');
    const entryTime = requireIso(payload.entry_time_utc, 'entry_time_utc');
    if (signalTime.error) return { ok: false, error: signalTime.error };
    if (entryTime.error) return { ok: false, error: entryTime.error };
    if (!validPrice(payload.entry_price) || !validPrice(payload.stop_price) || !validPrice(payload.target_price)) {
      return { ok: false, error: 'entry_stop_and_target_prices_must_be_positive' };
    }
    const entry = Number(payload.entry_price);
    const stop = Number(payload.stop_price);
    const target = Number(payload.target_price);
    if (Date.parse(entryTime.value) < Date.parse(signalTime.value)) {
      return { ok: false, error: 'entry_time_must_not_precede_signal_time' };
    }
    const featureBarTime = numberOrNull(features.barTime ?? features.bar_time);
    if (featureBarTime !== null && featureBarTime > 0 &&
        Math.abs(epochSeconds(signalTime.value) - (featureBarTime + 300)) > 1) {
      return { ok: false, error: 'signal_time_does_not_match_completed_m5_bar' };
    }
    if (side === 'BUY' ? !(stop < entry && target > entry) : !(target < entry && stop > entry)) {
      return { ok: false, error: 'entry_stop_target_direction_mismatch' };
    }
    const riskDistance = Math.abs(entry - stop);
    const features = body.features && typeof body.features === 'object' ? body.features : {};
    const h1Telemetry = buildGoldForwardH1Telemetry(features, side);
    normalizedPayload = {
      signal_time_utc: signalTime.value,
      entry_time_utc: entryTime.value,
      entry_price: entry,
      stop_price: stop,
      target_price: target,
      risk_distance_price: riskDistance,
      expected_entry_price: validPrice(payload.expected_entry_price) ? Number(payload.expected_entry_price) : null,
      entry_bid: validPrice(payload.entry_bid) ? Number(payload.entry_bid) : null,
      entry_ask: validPrice(payload.entry_ask) ? Number(payload.entry_ask) : null,
      spread_price: finite(payload.spread_price) && Number(payload.spread_price) >= 0 ? Number(payload.spread_price) : null,
      entry_slippage_price: finite(payload.entry_slippage_price) ? Number(payload.entry_slippage_price) : null,
      quote_age_seconds: finite(payload.quote_age_seconds) && Number(payload.quote_age_seconds) >= 0 ? Number(payload.quote_age_seconds) : null,
      setup_diagnostics: payload.setup_diagnostics && typeof payload.setup_diagnostics === 'object' ? payload.setup_diagnostics : {},
      market_safety: payload.market_safety && typeof payload.market_safety === 'object' ? payload.market_safety : {},
      h1_telemetry: h1Telemetry
    };
    eventTime = entryTime.value;
  } else if (eventType === 'BAR') {
    const barTime = requireIso(payload.bar_time_utc, 'bar_time_utc');
    if (barTime.error) return { ok: false, error: barTime.error };
    const index = Number(payload.bars_since_entry);
    const ohlc = ['open', 'high', 'low', 'close'].map((key) => Number(payload[key]));
    if (!Number.isInteger(index) || index < 1 || index > 10000 ||
        !ohlc.every(Number.isFinite) || !(ohlc[1] >= ohlc[2] && ohlc[1] >= ohlc[0] &&
        ohlc[1] >= ohlc[3] && ohlc[2] <= ohlc[0] && ohlc[2] <= ohlc[3])) {
      return { ok: false, error: 'invalid_bar_index_or_ohlc' };
    }
    normalizedPayload = {
      bars_since_entry: index,
      bar_time_utc: barTime.value,
      open: ohlc[0], high: ohlc[1], low: ohlc[2], close: ohlc[3],
      spread_price: finite(payload.spread_price) && Number(payload.spread_price) >= 0 ? Number(payload.spread_price) : null,
      quote_age_seconds: finite(payload.quote_age_seconds) && Number(payload.quote_age_seconds) >= 0 ? Number(payload.quote_age_seconds) : null,
      tick_data_quality: cleanText(payload.tick_data_quality || 'BAR_OHLC_ONLY', 40)
    };
    eventTime = barTime.value;
  } else if (eventType === 'GAP') {
    const from = requireIso(payload.from_time_utc, 'from_time_utc');
    const to = requireIso(payload.to_time_utc, 'to_time_utc');
    if (from.error) return { ok: false, error: from.error };
    if (to.error) return { ok: false, error: to.error };
    const gapSeconds = Number(payload.gap_seconds);
    if (!Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 86400) return { ok: false, error: 'gap_seconds_out_of_range' };
    normalizedPayload = { from_time_utc: from.value, to_time_utc: to.value, gap_seconds: gapSeconds, reason: cleanText(payload.reason || 'missing_m5_bar', 80) };
    eventTime = to.value;
  } else {
    const exitTime = requireIso(payload.exit_time_utc, 'exit_time_utc');
    if (exitTime.error) return { ok: false, error: exitTime.error };
    if (!validPrice(payload.exit_price)) return { ok: false, error: 'exit_price_must_be_positive' };
    const exitReason = cleanText(payload.exit_reason, 24).toUpperCase();
    if (!['STOP', 'TARGET', 'TIME', 'MANUAL', 'DATA_GAP', 'OTHER'].includes(exitReason)) return { ok: false, error: 'invalid_exit_reason' };
    if (!finite(payload.net_r) || !finite(payload.holding_seconds) || Number(payload.holding_seconds) < 0) {
      return { ok: false, error: 'net_r_and_nonnegative_holding_seconds_required' };
    }
    normalizedPayload = {
      exit_time_utc: exitTime.value,
      exit_price: Number(payload.exit_price),
      exit_reason: exitReason,
      gross_r: finite(payload.gross_r) ? Number(payload.gross_r) : null,
      net_r: Number(payload.net_r),
      holding_seconds: Math.floor(Number(payload.holding_seconds)),
      exit_spread_price: finite(payload.exit_spread_price) && Number(payload.exit_spread_price) >= 0 ? Number(payload.exit_spread_price) : null,
      exit_slippage_price: finite(payload.exit_slippage_price) ? Number(payload.exit_slippage_price) : null,
      data_gap_seconds: finite(payload.data_gap_seconds) && Number(payload.data_gap_seconds) >= 0 ? Number(payload.data_gap_seconds) : null
    };
    eventTime = exitTime.value;
  }

  const timeKey = eventType === 'ENTRY' ? 'ENTRY'
    : eventType === 'EXIT' ? 'EXIT'
      : eventTime;
  const eventKey = [entryId, eventType, timeKey].join(':');
  return {
    ok: true,
    row: {
      event_key: eventKey,
      entry_id: entryId,
      event_type: eventType,
      symbol,
      strategy_version: strategyVersion,
      side,
      event_time: eventTime,
      payload: { ...common, ...normalizedPayload }
    }
  };
}
