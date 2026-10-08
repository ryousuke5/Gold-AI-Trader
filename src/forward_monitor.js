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
    filter_funnel: filterFunnel,
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
