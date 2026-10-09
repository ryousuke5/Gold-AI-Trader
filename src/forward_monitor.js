import {
  dbEnabled,
  getState,
  probeGoldDatabase,
  countSignals,
  listRecentSignals,
  listTradeResults,
  listEurUsdForwardTrades
} from './db.js';
import { getEurUsdForwardConfig, summarizeEurUsdForwardTrades } from './eurusd_forward.js';
import { getEurUsdNewsFeedState } from './eurusd_news_feed.js';

const GOLD_SYMBOLS = ['GOLD', 'XAUUSD'];

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function summarizeSignalRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const ordered = [...list].sort((a, b) => Date.parse(b?.created_at || '') - Date.parse(a?.created_at || ''));
  const candidate = { BUY: 0, SELL: 0, WAIT: 0 };
  const decision = { BUY: 0, SELL: 0, WAIT: 0 };
  const reasonCounts = {};
  for (const row of ordered) {
    const c = String(row?.candidate || 'WAIT').toUpperCase();
    const d = String(row?.decision || 'WAIT').toUpperCase();
    if (candidate[c] !== undefined) candidate[c] += 1;
    if (decision[d] !== undefined) decision[d] += 1;
    const reason = String(row?.reason || '').trim();
    if (reason) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
  const latestWait = ordered.find(row => String(row?.candidate || '').toUpperCase() === 'WAIT');
  return {
    sampled_rows: list.length,
    candidate,
    decision,
    latest_signal_at: ordered[0]?.created_at || null,
    latest_candidate: String(ordered[0]?.candidate || 'WAIT').toUpperCase(),
    latest_decision: String(ordered[0]?.decision || 'WAIT').toUpperCase(),
    latest_reason: String(ordered[0]?.reason || '').trim() || null,
    latest_wait_reason: String(latestWait?.reason || '').trim() || null,
    reason_counts: reasonCounts
  };
}

export function summarizeGoldFilterFunnel(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const orderedReasons = [
    ['session_filter', '取引時間'],
    ['h1_trend_filter', 'H1トレンド'],
    ['insufficient_or_noncontiguous_range', 'M5レンジ連続性'],
    ['compression_filter', 'レンジ圧縮'],
    ['impulse_body_filter', 'ブレイク足実体'],
    ['volume_expansion_filter', '出来高拡大'],
    ['breakout_trigger_filter', 'ブレイク幅'],
    ['close_location_filter', '終値位置'],
    ['m5_rsi_filter', 'M5 RSI'],
    ['m5_ema_alignment_filter', 'M5 EMA整合'],
    ['extension_filter', '過伸展'],
    ['stop_distance_filter', 'SL距離'],
    ['trend_compression_breakout_confirmed', '候補成立']
  ];
  const reasonCounts = {};
  let recognized = 0;
  for (const row of list) {
    const reason = String(row?.reason || '').trim();
    if (orderedReasons.some(([key]) => key === reason)) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      recognized += 1;
    }
  }

  let reached = recognized;
  const stages = [];
  for (const [reason, label] of orderedReasons) {
    const failed = reason === 'trend_compression_breakout_confirmed' ? 0 : Number(reasonCounts[reason] || 0);
    const passed = Math.max(0, reached - failed);
    stages.push({
      reason,
      label,
      reached,
      failed,
      passed,
      pass_rate_pct: reached > 0 ? passed / reached * 100 : null
    });
    reached = passed;
  }

  return {
    sampled_rows: list.length,
    recognized_rows: recognized,
    unclassified_rows: Math.max(0, list.length - recognized),
    coverage_pct: list.length ? recognized / list.length * 100 : 0,
    stages
  };
}

function normalizeInvalidReasons(value) {
  if (Array.isArray(value)) return value.map(item => String(item || ''));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(item => String(item || ''));
    } catch {}
    return [trimmed];
  }
  return value && typeof value === 'object' ? Object.values(value).map(item => String(item || '')) : [];
}

function extractEurUsdDiagnostics(row) {
  const reasons = normalizeInvalidReasons(row?.invalid_reasons);
  const raw = reasons.find(value => String(value || '').startsWith('EURUSD_SETUP_DIAG:'));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw).slice('EURUSD_SETUP_DIAG:'.length));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeEurUsdSetup(rows = [], options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const reasons = {};
  for (const row of list) {
    for (const reason of normalizeInvalidReasons(row?.invalid_reasons)) {
      if (!reason || String(reason).startsWith('EURUSD_SETUP_DIAG:')) continue;
      reasons[reason] = (reasons[reason] || 0) + 1;
    }
  }
  const observations = list
    .map(row => ({ row, diagnostic: extractEurUsdDiagnostics(row) }))
    .filter(item => item.diagnostic);

  const requestedLimit = Number(options.spreadLimitPips ?? process.env.EURUSD_MAX_SPREAD_PIPS ?? 1.20);
  const activeSpreadLimitPips = Number.isFinite(requestedLimit) ? Math.max(0.1, requestedLimit) : 1.20;
  const numericOrNull = value => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const quantile = (sorted, q) => {
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return sorted[low] + ((sorted[high] - sorted[low]) * (position - low));
  };

  const spreadSamples = observations
    .map(({ row, diagnostic }) => {
      const spread = numericOrNull(diagnostic.spread_pips);
      if (spread === null || spread < 0) return null;
      const savedLimit = numericOrNull(diagnostic.spread_limit_pips);
      const limit = savedLimit !== null && savedLimit > 0 ? savedLimit : activeSpreadLimitPips;
      const setupReasons = Array.isArray(diagnostic.setup_reasons) ? diagnostic.setup_reasons.map(String) : [];
      const createdAt = Date.parse(row?.created_at || '');
      return {
        spread,
        limit,
        utcHour: Number.isFinite(createdAt) ? new Date(createdAt).getUTCHours() : null,
        pipsGateFailed: spread > limit,
        atrGateFailed: diagnostic.spread_atr_gate_passed === false,
        combinedSpreadGateFailed: setupReasons.includes('spread_filter_failed')
      };
    })
    .filter(Boolean);

  const summarizeSpreadSamples = samples => {
    const values = samples.map(sample => sample.spread).sort((a, b) => a - b);
    const count = values.length;
    const exceeded = samples.filter(sample => sample.pipsGateFailed).length;
    return {
      count,
      min: count ? values[0] : null,
      p25: quantile(values, 0.25),
      median: quantile(values, 0.50),
      p75: quantile(values, 0.75),
      p90: quantile(values, 0.90),
      max: count ? values[count - 1] : null,
      mean: count ? values.reduce((sum, value) => sum + value, 0) / count : null,
      over_limit_count: exceeded,
      over_limit_pct: count ? exceeded / count * 100 : null
    };
  };

  const byHour = new Map();
  for (const sample of spreadSamples) {
    if (sample.utcHour === null) continue;
    if (!byHour.has(sample.utcHour)) byHour.set(sample.utcHour, []);
    byHour.get(sample.utcHour).push(sample);
  }
  const spreadDistribution = {
    ...summarizeSpreadSamples(spreadSamples),
    limit_pips: activeSpreadLimitPips,
    pips_gate_failed_count: spreadSamples.filter(sample => sample.pipsGateFailed).length,
    atr_gate_failed_count: spreadSamples.filter(sample => sample.atrGateFailed).length,
    combined_filter_failed_count: spreadSamples.filter(sample => sample.combinedSpreadGateFailed).length,
    time_basis: 'signal_created_at_utc',
    by_utc_hour: [...byHour.entries()]
      .sort(([hourA], [hourB]) => hourA - hourB)
      .map(([hour, samples]) => ({
        hour,
        ...summarizeSpreadSamples(samples)
      }))
  };

  const avg = key => {
    const eligible = key === 'breakout_distance_atr'
      ? observations.filter(item => ['UP', 'DOWN'].includes(String(item.diagnostic?.trend || '').toUpperCase()))
      : observations;
    const values = eligible
      .map(item => item.diagnostic?.[key])
      .filter(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)))
      .map(Number);
    return values.length ? values.reduce((sum,v)=>sum+v,0)/values.length : null;
  };
  return {
    sampled_rows: list.length,
    observations: observations.length,
    reason_counts: reasons,
    averages: {
      range_width_atr: avg('range_width_atr'),
      breakout_distance_atr: avg('breakout_distance_atr'),
      breakout_body_atr: avg('breakout_body_atr'),
      breakout_close_location: avg('breakout_close_location'),
      volume_ratio: avg('volume_ratio'),
      spread_pips: avg('spread_pips'),
      spread_atr_pct: avg('spread_atr_pct')
    },
    spread_distribution: spreadDistribution
  };
}

function extractGoldV2Diagnostics(row) {
  const reasons = normalizeInvalidReasons(row?.invalid_reasons);
  const rangeToken = reasons.find(value => String(value || '').startsWith('GOLD_V2_RANGE_ATR:'));
  if (rangeToken) {
    const rangeAtr = Number(String(rangeToken).slice('GOLD_V2_RANGE_ATR:'.length));
    const configToken = reasons.find(value => String(value || '').startsWith('GOLD_V2_DIAG:'));
    let parsed = {};
    if (configToken) {
      try { parsed = JSON.parse(String(configToken).slice('GOLD_V2_DIAG:'.length)); } catch {}
    }
    const minRangeAtr = Number(parsed?.min_range_atr);
    const maxRangeAtr = Number(parsed?.max_range_atr);
    if (Number.isFinite(rangeAtr)) {
      return {
        ...parsed,
        range_atr: rangeAtr,
        min_range_atr: Number.isFinite(minRangeAtr) ? minRangeAtr : 0.8,
        max_range_atr: Number.isFinite(maxRangeAtr) ? maxRangeAtr : 2.8
      };
    }
  }
  const raw = reasons.find(value => String(value || '').startsWith('GOLD_V2_DIAG:'));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw).slice('GOLD_V2_DIAG:'.length));
    const rangeAtr = Number(parsed?.range_atr);
    const minRangeAtr = Number(parsed?.min_range_atr);
    const maxRangeAtr = Number(parsed?.max_range_atr);
    if (![rangeAtr, minRangeAtr, maxRangeAtr].every(Number.isFinite)) return null;
    return { ...parsed, range_atr: rangeAtr, min_range_atr: minRangeAtr, max_range_atr: maxRangeAtr };
  } catch {
    return null;
  }
}

export function summarizeGoldRangeAtr(rows = []) {
  const observations = (Array.isArray(rows) ? rows : [])
    .map(extractGoldV2Diagnostics)
    .filter(Boolean)
    .map(d => Number(d.range_atr))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const count = observations.length;
  if (!count) return {
    observations: 0,
    min: null,
    p25: null,
    median: null,
    p75: null,
    max: null,
    mean: null,
    below_min: 0,
    in_range: 0,
    above_max: 0,
    configured_min: 0.8,
    configured_max: 2.8
  };
  const percentile = p => observations[Math.min(count - 1, Math.max(0, Math.floor((count - 1) * p)))];
  const configuredMin = Number((Array.isArray(rows) ? rows : []).map(extractGoldV2Diagnostics).find(Boolean)?.min_range_atr);
  const configuredMax = Number((Array.isArray(rows) ? rows : []).map(extractGoldV2Diagnostics).find(Boolean)?.max_range_atr);
  const minBound = Number.isFinite(configuredMin) ? configuredMin : 0.8;
  const maxBound = Number.isFinite(configuredMax) ? configuredMax : 2.8;
  const mean = observations.reduce((sum, value) => sum + value, 0) / count;
  return {
    observations: count,
    min: observations[0],
    p25: percentile(0.25),
    median: percentile(0.5),
    p75: percentile(0.75),
    max: observations[count - 1],
    mean,
    below_min: observations.filter(value => value < minBound).length,
    in_range: observations.filter(value => value >= minBound && value <= maxBound).length,
    above_max: observations.filter(value => value > maxBound).length,
    configured_min: minBound,
    configured_max: maxBound
  };
}

export function summarizeTradeResultRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const wins = list.filter(row => finiteNumber(row?.r_multiple) > 0);
  const losses = list.filter(row => finiteNumber(row?.r_multiple) < 0);
  const netR = list.reduce((sum, row) => sum + finiteNumber(row?.r_multiple), 0);
  const grossWins = wins.reduce((sum, row) => sum + finiteNumber(row?.r_multiple), 0);
  const grossLosses = Math.abs(losses.reduce((sum, row) => sum + finiteNumber(row?.r_multiple), 0));
  return {
    results_total: list.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: list.filter(row => finiteNumber(row?.r_multiple) === 0).length,
    win_rate_pct: list.length ? wins.length / list.length * 100 : 0,
    net_r: netR,
    profit_factor: grossLosses > 0 ? grossWins / grossLosses : null,
    expectancy_r: list.length ? netR / list.length : 0,
    latest_result_at: list[0]?.created_at || null
  };
}

async function summarizeSignalSource({
  symbol,
  symbols,
  timeframe,
  strategyVersion,
  recentLimit = 50
} = {}) {
  const values = symbols || [symbol];
  const [total, buy, sell, wait, latestSignals] = await Promise.all([
    countSignals({ symbols: values, timeframe, strategyVersion }),
    countSignals({ symbols: values, timeframe, strategyVersion, candidate: 'BUY' }),
    countSignals({ symbols: values, timeframe, strategyVersion, candidate: 'SELL' }),
    countSignals({ symbols: values, timeframe, strategyVersion, candidate: 'WAIT' }),
    listRecentSignals({ symbols: values, timeframe, strategyVersion, limit: recentLimit })
  ]);
  const sampled = summarizeSignalRows(latestSignals);
  const filterFunnel = symbols?.length && values.some(value => GOLD_SYMBOLS.includes(value))
    ? summarizeGoldFilterFunnel(latestSignals)
    : null;
  return {
    total_signals: total,
    candidate_counts_all_time: { BUY: buy, SELL: sell, WAIT: wait },
    recent: sampled,
    eurusd_setup: symbols?.length === 0 || values.includes('EURUSD') ? summarizeEurUsdSetup(latestSignals) : null,
    filter_funnel: filterFunnel,
    range_atr: symbols?.length && values.some(value => GOLD_SYMBOLS.includes(value))
      ? summarizeGoldRangeAtr(latestSignals)
      : null,
    latest_signals: latestSignals
  };
}

export async function buildForwardMonitorSnapshot(nowMs = Date.now()) {
  const eurStrategy = process.env.EURUSD_STRATEGY_VERSION || 'eurusd-m15-h1-deterministic-forward-v1';
  const goldStrategy = process.env.STRATEGY_VERSION || 'gold-m5-h1-v2';
  const [state, dbProbe, eurTrades, eurSignals, goldSignals, goldResults] = await Promise.all([
    getState(),
    probeGoldDatabase(),
    listEurUsdForwardTrades({ limit: 5000 }),
    summarizeSignalSource({
      symbol: 'EURUSD',
      timeframe: 'M15',
      strategyVersion: eurStrategy,
      recentLimit: 200
    }),
    summarizeSignalSource({
      symbols: GOLD_SYMBOLS,
      timeframe: 'M5',
      strategyVersion: goldStrategy,
      recentLimit: 200
    }),
    listTradeResults({ symbols: GOLD_SYMBOLS, limit: 500 })
  ]);

  const eurSummary = summarizeEurUsdForwardTrades(eurTrades, nowMs);
  const goldResultSummary = summarizeTradeResultRows(goldResults);
  const feed = getEurUsdNewsFeedState();
  const eurExecutionEnabled = String(process.env.EURUSD_EXECUTION_ENABLED || 'false').toLowerCase() === 'true';
  const eurLiveApproved = String(process.env.EURUSD_LIVE_TRADING_APPROVED || 'false').toLowerCase() === 'true';
  const goldLiveApproved = String(process.env.GOLD_LIVE_TRADING_APPROVED || 'false').toLowerCase() === 'true';

  return {
    ok: true,
    generated_at: new Date(nowMs).toISOString(),
    refresh_seconds: 30,
    system: {
      service: 'gold-ai-trader-v1',
      database: {
        enabled: dbEnabled(),
        probe_ok: dbProbe?.ok === true,
        status: dbProbe?.status || 'unknown'
      },
      gold_state: state || null,
      signal_engines: {
        eurusd: {
          enabled: true,
          status: 'RUNNING',
          mode: 'DETERMINISTIC_TECHNICAL'
        },
        gold: {
          enabled: true,
          status: 'RUNNING',
          mode: 'GOLD_V2_RULE_ENGINE'
        }
      },
      real_execution: {
        eurusd: {
          execution_enabled: eurExecutionEnabled,
          live_trading_approved: eurLiveApproved,
          effective_live_gate: eurExecutionEnabled && eurLiveApproved
        },
        gold: {
          live_trading_approved_env: goldLiveApproved,
          state_mode: String(state?.mode || 'ANALYSIS'),
          auto_trading_enabled: state?.auto_trading_enabled === true,
          effective_live_gate: goldLiveApproved && String(state?.mode || '') === 'LIVE' && state?.auto_trading_enabled === true
        }
      }
    },
    eurusd: {
      symbol: 'EURUSD',
      timeframe: 'M15',
      strategy_version: eurStrategy,
      ai_enabled: String(process.env.EURUSD_AI_ENABLED || 'false').toLowerCase() === 'true',
      forward_config: getEurUsdForwardConfig(),
      signals: eurSignals,
      forward: {
        ...eurSummary,
        latest_trades: eurTrades.slice(-25).reverse()
      },
      safety: {
        mode: 'FAIL_CLOSED',
        news_feed: feed
      }
    },
    gold: {
      symbols: GOLD_SYMBOLS,
      timeframe: 'M5',
      strategy_version: goldStrategy,
      ai_only_on_candidate: String(process.env.AI_ONLY_ON_CANDIDATE || 'true').toLowerCase() === 'true',
      signals: goldSignals,
      trade_results: {
        summary: goldResultSummary,
        latest: goldResults.slice(0, 25)
      }
    }
  };
}
