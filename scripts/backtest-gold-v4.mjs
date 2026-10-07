import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildGoldV4Setup } from '../src/gold_strategy_v4.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = process.env.GOLD_BACKTEST_DATA_FILE || path.join(ROOT, 'gold-xauusd-data', 'xauusd-m5.json.gz');
const OUTPUT_DIR = path.resolve(process.env.GOLD_BACKTEST_OUTPUT_DIR || path.join(ROOT, 'gold-backtest-output'));

const CONFIG = {
  lookbackDays: Math.max(365, Number(process.env.GOLD_BACKTEST_LOOKBACK_DAYS || 1825)),
  initialEquity: Math.max(1000, Number(process.env.GOLD_BACKTEST_INITIAL_EQUITY || 100000)),
  riskPct: Math.max(0.01, Number(process.env.GOLD_BACKTEST_RISK_PCT || 0.25)),
  spreadPrice: Math.max(0, Number(process.env.GOLD_BACKTEST_SPREAD_PRICE || 0.50)),
  slippagePrice: Math.max(0, Number(process.env.GOLD_BACKTEST_SLIPPAGE_PRICE || 0.05)),
  maxDailyLossPct: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_DAILY_LOSS_PCT || 2)),
  maxDrawdownPct: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_DRAWDOWN_PCT || 5)),
  maxHoldBars: Math.max(1, Math.floor(Number(process.env.GOLD_BACKTEST_MAX_HOLD_BARS || 96))),
  maxEntryGapAtr: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_ENTRY_GAP_ATR || 0.50)),
  minEffectiveRR: Math.max(0.5, Number(process.env.GOLD_BACKTEST_MIN_EFFECTIVE_RR || 1.50))
};

const STRATEGY = {
  rangeLookback: Math.max(4, Number(process.env.GOLD_RANGE_LOOKBACK || 12)),
  minRangeAtr: Math.max(0.1, Number(process.env.GOLD_MIN_RANGE_ATR || 0.60)),
  maxRangeAtr: Math.max(0.2, Number(process.env.GOLD_MAX_RANGE_ATR || 2.40)),
  breakoutAtr: Math.max(0.01, Number(process.env.GOLD_BREAKOUT_ATR || 0.10)),
  breakoutBodyAtr: Math.max(0.05, Number(process.env.GOLD_BREAKOUT_BODY_ATR || 0.45)),
  breakoutCloseLocation: Math.min(0.95, Math.max(0.50, Number(process.env.GOLD_BREAKOUT_CLOSE_LOCATION || 0.70))),
  breakoutVolumeRatio: Math.max(0.1, Number(process.env.GOLD_BREAKOUT_VOLUME_RATIO || 1.15)),
  maxRetestBars: Math.max(1, Math.floor(Number(process.env.GOLD_MAX_RETEST_BARS || 4))),
  retestToleranceAtr: Math.max(0.01, Number(process.env.GOLD_RETEST_TOLERANCE_ATR || 0.20)),
  maxRetestDepthAtr: Math.max(0.05, Number(process.env.GOLD_MAX_RETEST_DEPTH_ATR || 0.35)),
  retestBodyAtr: Math.max(0.02, Number(process.env.GOLD_RETEST_BODY_ATR || 0.15)),
  retestCloseLocation: Math.min(0.95, Math.max(0.50, Number(process.env.GOLD_RETEST_CLOSE_LOCATION || 0.60))),
  confirmationBufferAtr: Math.max(0, Number(process.env.GOLD_CONFIRMATION_BUFFER_ATR || 0.05)),
  maxExtensionAtr: Math.max(0.1, Number(process.env.GOLD_MAX_EXTENSION_ATR || 1.30)),
  stopBufferAtr: Math.max(0, Number(process.env.GOLD_STOP_BUFFER_ATR || 0.15)),
  minStopAtr: Math.max(0.1, Number(process.env.GOLD_MIN_STOP_ATR || 0.70)),
  maxStopAtr: Math.max(0.2, Number(process.env.GOLD_MAX_STOP_ATR || 2.00)),
  takeProfitR: Math.max(1.0, Number(process.env.GOLD_TAKE_PROFIT_R || 2.00)),
  minH1RsiBuy: Math.max(1, Number(process.env.GOLD_MIN_H1_RSI_BUY || 50)),
  maxH1RsiBuy: Math.min(99, Number(process.env.GOLD_MAX_H1_RSI_BUY || 72)),
  minH1RsiSell: Math.max(1, Number(process.env.GOLD_MIN_H1_RSI_SELL || 28)),
  maxH1RsiSell: Math.min(99, Number(process.env.GOLD_MAX_H1_RSI_SELL || 50)),
  sessionStartUtc: Math.min(23, Math.max(0, Math.floor(Number(process.env.GOLD_SESSION_START_UTC || 7)))),
  sessionEndUtc: Math.min(23, Math.max(0, Math.floor(Number(process.env.GOLD_SESSION_END_UTC || 20))))
};

const COSTS = {
  baseline: { spreadPrice: CONFIG.spreadPrice, slippagePrice: CONFIG.slippagePrice },
  conservative: {
    spreadPrice: Math.max(CONFIG.spreadPrice, Number(process.env.GOLD_CONSERVATIVE_SPREAD_PRICE || 0.75)),
    slippagePrice: Math.max(CONFIG.slippagePrice, Number(process.env.GOLD_CONSERVATIVE_SLIPPAGE_PRICE || 0.10))
  }
};

const QUALITY = {
  minTrades: 25,
  minProfitFactor: 1.15,
  minExpectancyR: 0.05,
  maxDrawdownPct: 5,
  minRecent365Trades: 6,
  minRecent365ProfitFactor: 1.0,
  minPositiveYears: 3
};

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) continue;
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsi(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atr(bars, period) {
  const out = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr = bars.map((b, i) => i === 0
    ? b.high - b.low
    : Math.max(
        b.high - b.low,
        Math.abs(b.high - bars[i - 1].close),
        Math.abs(b.low - bars[i - 1].close)
      ));
  let value = 0;
  for (let i = 1; i <= period; i += 1) value += tr[i];
  value /= period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function addIndicators(bars) {
  const closes = bars.map((b) => b.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const rs = rsi(closes, 14);
  const at = atr(bars, 14);
  return bars.map((b, i) => ({
    ...b, ema20: e20[i], ema50: e50[i], ema200: e200[i], rsi14: rs[i], atr14: at[i]
  }));
}

function aggregateH1(m5) {
  const buckets = new Map();
  for (const bar of m5) {
    const hour = Math.floor(bar.time / 3600) * 3600;
    const existing = buckets.get(hour);
    if (!existing) {
      buckets.set(hour, {
        time: hour, open: bar.open, high: bar.high, low: bar.low,
        close: bar.close, volume: bar.volume
      });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
      existing.close = bar.close;
      existing.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function latestCompletedH1Index(h1, signalTime) {
  let lo = 0;
  let hi = h1.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h1[mid].time + 3600 <= signalTime) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function recentM5(indicators, index, count) {
  return indicators
    .slice(Math.max(0, index - count + 1), index + 1)
    .map((b) => ({ ...b, time: b.time + 300 }));
}

async function loadData() {
  const raw = await fs.readFile(DATA_FILE);
  const text = DATA_FILE.endsWith('.gz')
    ? gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Prepared GOLD data must be an array');

  const rows = parsed.map((b) => ({
    time: Number(b.time),
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
    volume: Number(b.volume) || 0
  })).filter((b) =>
    Number.isFinite(b.time) && b.open > 0 &&
    b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close
  ).sort((a, b) => a.time - b.time);

  const unique = [];
  let last = null;
  for (const bar of rows) {
    if (bar.time === last) continue;
    unique.push(bar);
    last = bar.time;
  }
  if (unique.length < 200000) throw new Error('Insufficient prepared GOLD M5 data: ' + unique.length);
  return unique;
}

function riskGate(state, equity, timestamp, costs) {
  const day = new Date(timestamp * 1000).toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.dayStartEquity = equity;
  }
  state.peak = Math.max(state.peak, equity);
  const dailyLossPct = state.dayStartEquity > 0
    ? (equity - state.dayStartEquity) / state.dayStartEquity * 100
    : 0;
  const drawdownPct = state.peak > 0 ? (state.peak - equity) / state.peak * 100 : 0;
  const reasons = [];
  if (dailyLossPct <= -Math.abs(CONFIG.maxDailyLossPct)) reasons.push('daily_loss_limit');
  if (drawdownPct >= Math.abs(CONFIG.maxDrawdownPct)) reasons.push('drawdown_limit');
  if (!(costs.spreadPrice >= 0 && costs.slippagePrice >= 0)) reasons.push('invalid_cost');
  return { allowed: reasons.length === 0, reasons, dailyLossPct, drawdownPct };
}

function simulateTrade(signalBar, nextBar, futureBars, setup, equity, costs) {
  const side = setup.candidate;
  const entry = side === 'BUY'
    ? nextBar.open + costs.spreadPrice + costs.slippagePrice
    : nextBar.open - costs.slippagePrice;
  const stop = setup.stop_loss;
  const target = setup.take_profit;
  const stopDistance = Math.abs(entry - stop);
  const entryGapAtr = Math.abs(entry - setup.entry_reference) / Math.max(1e-9, Number(signalBar.atr14));
  const effectiveTargetDistance = Math.abs(target - entry);
  const effectiveRR = effectiveTargetDistance / Math.max(1e-9, stopDistance);

  if (!(entry > 0 && stop > 0 && target > 0 && stopDistance > 0)) return { rejected: 'invalid_geometry' };
  if (entryGapAtr > CONFIG.maxEntryGapAtr) return { rejected: 'entry_gap' };
  if (effectiveRR < CONFIG.minEffectiveRR) return { rejected: 'effective_rr' };

  const riskCash = equity * CONFIG.riskPct / 100;
  const scan = futureBars.slice(0, CONFIG.maxHoldBars);
  let exitBar = scan.at(-1) || nextBar;
  let exitReason = 'TIME';
  let exitPrice = exitBar.close;
  let previous = null;

  for (const bar of scan) {
    if (previous && bar.time - previous.time > 900) {
      exitBar = previous;
      exitReason = 'DATA_GAP';
      exitPrice = side === 'BUY'
        ? previous.close - costs.slippagePrice
        : previous.close + costs.spreadPrice + costs.slippagePrice;
      break;
    }

    const stopHit = side === 'BUY'
      ? bar.low <= stop
      : bar.high + costs.spreadPrice >= stop;
    const targetHit = side === 'BUY'
      ? bar.high >= target
      : bar.low + costs.spreadPrice <= target;

    if (stopHit) {
      exitBar = bar;
      exitReason = 'STOP';
      exitPrice = side === 'BUY'
        ? stop - costs.slippagePrice
        : stop + costs.spreadPrice + costs.slippagePrice;
      break;
    }
    if (targetHit) {
      exitBar = bar;
      exitReason = 'TARGET';
      exitPrice = side === 'BUY'
        ? target - costs.slippagePrice
        : target + costs.spreadPrice + costs.slippagePrice;
      break;
    }
    previous = bar;
  }

  const netR = (side === 'BUY' ? exitPrice - entry : entry - exitPrice) / stopDistance;
  return {
    rejected: null,
    signal_time: signalBar.time,
    entry_time: nextBar.time,
    exit_time: exitBar.time,
    side,
    setup_type: setup.setup_type,
    entry,
    stop_loss: stop,
    take_profit: target,
    risk_cash: riskCash,
    entry_gap_atr: entryGapAtr,
    effective_rr: effectiveRR,
    net_r: netR,
    net_pnl: riskCash * netR,
    exit_reason: exitReason,
    holding_minutes: Math.max(0, (exitBar.time - nextBar.time) / 60),
    breakout_time: setup.diagnostics?.breakout_time ?? null,
    breakout_age_bars: setup.diagnostics?.breakout_age_bars ?? null,
    range_atr: setup.diagnostics?.range_atr ?? null,
    retest_depth_atr: setup.diagnostics?.retest_depth_atr ?? null,
    breakout_volume_ratio: setup.diagnostics?.breakout_volume_ratio ?? null
  };
}

function summarize(trades, initialEquity) {
  let equity = initialEquity;
  let peak = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let holding = 0;
  let wins = 0;
  let losses = 0;
  const bySide = {
    BUY: { trades: 0, wins: 0, losses: 0, net_r: 0 },
    SELL: { trades: 0, wins: 0, losses: 0, net_r: 0 }
  };

  for (const trade of trades) {
    equity += trade.net_pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    maxDrawdown = Math.max(maxDrawdown, dd);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? dd / peak * 100 : 0);
    if (trade.net_pnl > 0) {
      wins += 1;
      grossProfit += trade.net_pnl;
      bySide[trade.side].wins += 1;
    } else if (trade.net_pnl < 0) {
      losses += 1;
      grossLoss += -trade.net_pnl;
      bySide[trade.side].losses += 1;
    }
    bySide[trade.side].trades += 1;
    bySide[trade.side].net_r += trade.net_r;
    holding += trade.holding_minutes;
  }

  for (const side of Object.keys(bySide)) {
    bySide[side].win_rate_pct = bySide[side].trades
      ? bySide[side].wins / bySide[side].trades * 100
      : 0;
    bySide[side].expectancy_R = bySide[side].trades
      ? bySide[side].net_r / bySide[side].trades
      : 0;
  }

  const totalR = trades.reduce((sum, trade) => sum + trade.net_r, 0);
  return {
    initial_equity: initialEquity,
    final_equity: equity,
    net_profit: equity - initialEquity,
    return_pct: (equity / initialEquity - 1) * 100,
    trades: trades.length,
    wins,
    losses,
    win_rate_pct: trades.length ? wins / trades.length * 100 : 0,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    expectancy_R: trades.length ? totalR / trades.length : 0,
    total_R: totalR,
    max_drawdown: maxDrawdown,
    max_drawdown_pct: maxDrawdownPct,
    avg_holding_minutes: trades.length ? holding / trades.length : 0,
    target_exits: trades.filter((t) => t.exit_reason === 'TARGET').length,
    stop_exits: trades.filter((t) => t.exit_reason === 'STOP').length,
    by_side: bySide
  };
}

function periodSummary(trades, initialEquity, days, periodEnd) {
  const end = Number.isFinite(Number(periodEnd))
    ? Number(periodEnd)
    : Math.max(0, ...trades.map((t) => t.exit_time));
  const start = end - days * 86400;
  const inPeriod = trades.filter((t) => t.exit_time >= start && t.exit_time <= end);
  const priorPnl = trades
    .filter((t) => t.exit_time < start)
    .reduce((sum, t) => sum + t.net_pnl, 0);
  return summarize(inPeriod, initialEquity + priorPnl);
}

function annualSummary(trades) {
  const map = new Map();
  for (const trade of trades) {
    const year = new Date(trade.exit_time * 1000).toISOString().slice(0, 4);
    const row = map.get(year) || { year, trades: 0, wins: 0, losses: 0, net_r: 0, net_pnl: 0 };
    row.trades += 1;
    if (trade.net_pnl > 0) row.wins += 1;
    if (trade.net_pnl < 0) row.losses += 1;
    row.net_r += trade.net_r;
    row.net_pnl += trade.net_pnl;
    map.set(year, row);
  }
  return [...map.values()].sort((a, b) => a.year.localeCompare(b.year)).map((row) => ({
    ...row,
    win_rate_pct: row.trades ? row.wins / row.trades * 100 : 0
  }));
}

function qualityGate(result) {
  const reasons = [];
  if (result.summary.trades < QUALITY.minTrades) reasons.push('insufficient_trades');
  if (!Number.isFinite(result.summary.profit_factor) || result.summary.profit_factor < QUALITY.minProfitFactor) reasons.push('profit_factor');
  if (!Number.isFinite(result.summary.expectancy_R) || result.summary.expectancy_R < QUALITY.minExpectancyR) reasons.push('expectancy_R');
  if (!Number.isFinite(result.summary.max_drawdown_pct) || result.summary.max_drawdown_pct > QUALITY.maxDrawdownPct) reasons.push('max_drawdown');
  if (result.recent365.trades < QUALITY.minRecent365Trades) reasons.push('recent365_trades');
  if (!Number.isFinite(result.recent365.profit_factor) || result.recent365.profit_factor < QUALITY.minRecent365ProfitFactor) reasons.push('recent365_profit_factor');
  if (result.positiveYears < QUALITY.minPositiveYears) reasons.push('positive_years');
  return { passed: reasons.length === 0, reasons };
}

async function runScenario(indM5, indH1, costs, periodEnd) {
  const latest = indM5.at(-1).time;
  const start = latest - CONFIG.lookbackDays * 86400;
  const warmup = Math.max(300, STRATEGY.rangeLookback + STRATEGY.maxRetestBars + 10);
  const firstEligibleIndex = indM5.findIndex((bar) => bar.time >= start);
  const loopStart = firstEligibleIndex >= 0 ? Math.max(warmup, firstEligibleIndex) : indM5.length;
  let equity = CONFIG.initialEquity;
  const trades = [];
  const state = { day: null, dayStartEquity: equity, peak: equity };
  const diagnostic = {
    signals_evaluated: 0,
    breakout_retest_candidates: 0,
    buy_candidates: 0,
    sell_candidates: 0,
    blocked_by_risk: 0,
    rejected_entry_gap: 0,
    rejected_effective_rr: 0,
    rejected_geometry: 0,
    setup_wait_reasons: {}
  };
  let nextAvailable = 0;
  let loop_iterations = 0;

  for (let i = loopStart; i < indM5.length - 1; i += 1) {
    loop_iterations += 1;
    const signal = indM5[i];
    diagnostic.signals_evaluated += 1;
    if (i < nextAvailable) continue;

    const h1Index = latestCompletedH1Index(indH1, signal.time + 300);
    const h = indH1[h1Index];
    if (!h || ![h.close, h.ema20, h.ema50, h.ema200, h.rsi14, h.atr14].every(Number.isFinite)) continue;

    const setup = buildGoldV4Setup({
      m5: {
        ema20: signal.ema20,
        ema50: signal.ema50,
        rsi14: signal.rsi14,
        atr14: signal.atr14
      },
      h1: {
        close: h.close,
        ema20: h.ema20,
        ema50: h.ema50,
        ema200: h.ema200,
        rsi14: h.rsi14,
        atr14: h.atr14
      },
      recentM5: recentM5(indM5, i, Math.max(24, STRATEGY.rangeLookback + STRATEGY.maxRetestBars + 2))
    }, STRATEGY);

    if (setup.candidate === 'WAIT') {
      diagnostic.setup_wait_reasons[setup.reason] = (diagnostic.setup_wait_reasons[setup.reason] || 0) + 1;
      const waitStage = setup.diagnostics?.wait_stage;
      if (waitStage) {
        diagnostic.setup_wait_stages = diagnostic.setup_wait_stages || {};
        diagnostic.setup_wait_stages[waitStage] = (diagnostic.setup_wait_stages[waitStage] || 0) + 1;
      }
      continue;
    }

    diagnostic.breakout_retest_candidates += 1;
    if (setup.candidate === 'BUY') diagnostic.buy_candidates += 1;
    if (setup.candidate === 'SELL') diagnostic.sell_candidates += 1;

    const risk = riskGate(state, equity, signal.time + 300, costs);
    if (!risk.allowed) {
      diagnostic.blocked_by_risk += 1;
      continue;
    }

    const nextBar = indM5[i + 1];
    if (nextBar.time - signal.time !== 300) {
      diagnostic.rejected_entry_gap += 1;
      continue;
    }

    const trade = simulateTrade(signal, nextBar, indM5.slice(i + 1), setup, equity, costs);
    if (trade.rejected) {
      diagnostic['rejected_' + trade.rejected] = (diagnostic['rejected_' + trade.rejected] || 0) + 1;
      continue;
    }

    trades.push(trade);
    equity += trade.net_pnl;
    const exitIndex = indM5.findIndex((b) => b.time === trade.exit_time);
    nextAvailable = exitIndex >= 0 ? Math.min(indM5.length, exitIndex + 1) : i + 2;
  }

  diagnostic.loop_iterations = loop_iterations;
  diagnostic.loop_start_index = loopStart;
  diagnostic.first_eligible_index = firstEligibleIndex;
  diagnostic.lookback_bars = Math.max(0, indM5.length - loopStart);
  diagnostic.lookback_start_utc = new Date(Math.max(start, indM5[0].time) * 1000).toISOString();
  diagnostic.lookback_end_utc = new Date(indM5.at(-1).time * 1000).toISOString();

  if (diagnostic.loop_iterations <= 0 || diagnostic.signals_evaluated <= 0) {
    throw new Error(JSON.stringify({
      code: 'V4_NO_SIGNAL_EVALUATION',
      latest: indM5.at(-1)?.time ?? null,
      start,
      warmup,
      firstEligibleIndex,
      loopStart,
      bars: indM5.length,
      lookbackDays: CONFIG.lookbackDays
    }));
  }

  const summary = summarize(trades, CONFIG.initialEquity);
  const recent365 = periodSummary(trades, CONFIG.initialEquity, 365, periodEnd);
  const annual = annualSummary(trades);
  const positiveYears = annual.filter((r) => r.net_r > 0).length;
  const result = { summary, recent365, annual, positiveYears, qualityGate: null, diagnostics: diagnostic };
  result.qualityGate = qualityGate(result);
  return result;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const raw = await loadData();
  const indM5 = addIndicators(raw);
  const indH1 = addIndicators(aggregateH1(raw));
  const latest = indM5.at(-1).time;
  const periodEnd = latest + 300;

  console.log(JSON.stringify({
    version: 'GOLD_V4',
    sanity: 'data_loaded',
    bars: indM5.length,
    first_utc: new Date(indM5[0].time * 1000).toISOString(),
    last_utc: new Date(indM5.at(-1).time * 1000).toISOString(),
    lookback_days: CONFIG.lookbackDays
  }));

  const results = {};
  for (const [name, costs] of Object.entries(COSTS)) {
    results[name] = await runScenario(indM5, indH1, costs, periodEnd);
  }

  results.robustAcrossCosts = Boolean(
    results.baseline?.qualityGate?.passed &&
    results.conservative?.qualityGate?.passed
  );

  const report = {
    version: 'GOLD_V4',
    strategy: 'H1_TREND_RANGE_BREAKOUT_RETEST',
    data_file: DATA_FILE,
    source_period: {
      start_utc: new Date(indM5[0].time * 1000).toISOString(),
      end_utc_exclusive: new Date((indM5.at(-1).time + 300) * 1000).toISOString(),
      bars: indM5.length
    },
    configuration: { backtest: CONFIG, strategy: STRATEGY, costs: COSTS, quality: QUALITY },
    methodology: {
      entry: 'completed M5 retest-confirmation bar, order simulated at next M5 open',
      h1_lookahead_protection: 'only H1 bars with close time <= signal time are used',
      intra_bar_conflict: 'STOP is conservatively resolved before TARGET when both occur in one bar',
      data_gap: 'gaps greater than 15 minutes terminate the open trade at the previous bar',
      fundamental_ai: 'NOT_USED_IN_HISTORICAL_TECHNICAL_PERFORMANCE',
      real_orders: 'DISABLED'
    },
    results
  };

  await fs.writeFile(
    path.join(OUTPUT_DIR, 'gold_v4_backtest_report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );
  const primary = results.conservative?.summary;
  console.log(JSON.stringify({
    version: 'GOLD_V4',
    robustAcrossCosts: results.robustAcrossCosts,
    conservative: {
      trades: primary?.trades ?? 0,
      profit_factor: primary?.profit_factor ?? null,
      expectancy_R: primary?.expectancy_R ?? null,
      max_drawdown_pct: primary?.max_drawdown_pct ?? null,
      return_pct: primary?.return_pct ?? null,
      quality_gate: results.conservative?.qualityGate ?? null
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
