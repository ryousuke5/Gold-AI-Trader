import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const DATA_FILE = process.env.GOLD_M1_SCALP_DATA_FILE || 'gold-xauusd-data/xauusd-m1.json.gz';
const OUTPUT_DIR = path.resolve(process.env.GOLD_M1_SCALP_OUTPUT_DIR || 'gold-m1-scalp-output');
const INITIAL_EQUITY = Math.max(1000, Number(process.env.GOLD_M1_SCALP_INITIAL_EQUITY || 100000));
const RISK_PCT = Math.max(0.01, Number(process.env.GOLD_M1_SCALP_RISK_PCT || 0.25));
const BASELINE_COST = { name: 'baseline', spread: 0.58, slippage: 0.10 };
const CONSERVATIVE_COST = { name: 'conservative', spread: 0.75, slippage: 0.10 };
const WINDOWS = [
  { id: 'five_year', days: 1825, minTrades: 100 },
  { id: 'recent_730d', days: 730, minTrades: 40 }
];

const RULES = {
  design: 'M1 trend-aligned micro-breakout during the New York morning; research hypothesis only',
  session_timezone: 'America/New_York',
  session_local: 'Monday-Friday 09:35-12:15 America/New_York; no new positions after 12:15',
  max_hold_minutes: 12,
  max_trades_per_ny_day: 3,
  entry_trend: 'EMA9 > EMA21 > EMA50 for BUY; reverse stack for SELL',
  breakout_lookback_bars: 5,
  breakout_buffer_atr: 0.05,
  min_body_atr: 0.35,
  close_location_buy_min: 0.65,
  close_location_sell_max: 0.35,
  rsi_buy: [52, 75],
  rsi_sell: [25, 48],
  stop_min_price: 1.50,
  stop_max_price: 4.50,
  stop_swing_buffer_atr: 0.10,
  stop_min_atr: 1.20,
  target_R: 2.0,
  min_effective_rr: 1.50,
  max_entry_gap_atr: 0.50,
  risk_per_trade_pct: RISK_PCT,
  max_daily_loss_pct: 2,
  max_drawdown_pct: 5,
  execution: 'next M1 bar open with modeled spread/slippage; stop-first on same-bar conflict',
  data_caveat: 'Dukascopy BID M1 OHLC; not XM historical ticks or historical Ask/spread',
  live_orders_enabled: false
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function isFiniteNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}
async function loadBars(file) {
  const raw = gunzipSync(await fs.readFile(file)).toString('utf8');
  const parsed = JSON.parse(raw);
  assert(Array.isArray(parsed) && parsed.length >= 500000, 'Insufficient M1 history: ' + (Array.isArray(parsed) ? parsed.length : 'not an array'));
  const bars = [];
  let lastTime = -Infinity;
  for (const r of parsed) {
    const b = {
      time: Number(r.time), open: Number(r.open), high: Number(r.high),
      low: Number(r.low), close: Number(r.close), volume: Number(r.volume || 0)
    };
    if (![b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)) continue;
    if (!(b.open > 0 && b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close))) continue;
    if (b.time <= lastTime) continue;
    bars.push(b); lastTime = b.time;
  }
  assert(bars.length >= 500000, 'Insufficient valid deduplicated M1 bars: ' + bars.length);
  return bars;
}
function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  const alpha = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (!Number.isFinite(x)) continue;
    prev = Number.isFinite(prev) ? alpha * x + (1 - alpha) * prev : x;
    out[i] = prev;
  }
  return out;
}
function atr(bars, period) {
  const tr = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i === 0 || bars[i].time - bars[i - 1].time !== 60) tr[i] = b.high - b.low;
    else {
      const pc = bars[i - 1].close;
      tr[i] = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    }
  }
  const out = new Array(bars.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += Number.isFinite(tr[i]) ? tr[i] : 0;
    if (i >= period) sum -= Number.isFinite(tr[i - period]) ? tr[i - period] : 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
function rsi(values, period) {
  const out = new Array(values.length).fill(NaN);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    gain += Math.max(0, d); loss += Math.max(0, -d);
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', hourCycle: 'h23'
});
const nyHourCache = new Map();
function nyLocalInfo(epochSeconds) {
  const utcHour = Math.floor(epochSeconds / 3600);
  let cached = nyHourCache.get(utcHour);
  if (!cached) {
    const parts = nyFormatter.formatToParts(new Date(utcHour * 3600 * 1000));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    cached = {
      date: p.year + '-' + p.month + '-' + p.day,
      weekday: p.weekday,
      hour: Number(p.hour)
    };
    nyHourCache.set(utcHour, cached);
  }
  return { ...cached, minute: new Date(epochSeconds * 1000).getUTCMinutes() };
}
function inSession(info) {
  if (['Sat', 'Sun'].includes(info.weekday)) return false;
  const minuteOfDay = info.hour * 60 + info.minute;
  return minuteOfDay >= 9 * 60 + 35 && minuteOfDay <= 12 * 60 + 15;
}
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
function summarize(trades, initialEquity, maxDrawdownPct, censoredTrades, candidates, rejectionCounts) {
  const wins = trades.filter(t => t.net_pnl > 0);
  const losses = trades.filter(t => t.net_pnl < 0);
  const grossWin = sum(wins.map(t => t.net_pnl));
  const grossLoss = -sum(losses.map(t => t.net_pnl));
  const totalR = sum(trades.map(t => t.net_r));
  const totalPnl = sum(trades.map(t => t.net_pnl));
  const bySide = {};
  for (const side of ['BUY', 'SELL']) {
    const xs = trades.filter(t => t.side === side);
    const w = xs.filter(t => t.net_pnl > 0);
    const l = xs.filter(t => t.net_pnl < 0);
    bySide[side] = {
      trades: xs.length, wins: w.length, losses: l.length,
      profit_factor: -sum(l.map(t => t.net_pnl)) > 0 ? sum(w.map(t => t.net_pnl)) / -sum(l.map(t => t.net_pnl)) : (w.length ? null : 0),
      expectancy_R: xs.length ? sum(xs.map(t => t.net_r)) / xs.length : null,
      total_R: sum(xs.map(t => t.net_r))
    };
  }
  return {
    initial_equity: initialEquity,
    final_equity: initialEquity + totalPnl,
    net_profit: totalPnl,
    return_pct: (totalPnl / initialEquity) * 100,
    trades: trades.length, wins: wins.length, losses: losses.length,
    win_rate_pct: trades.length ? wins.length / trades.length * 100 : null,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    expectancy_R: trades.length ? totalR / trades.length : null,
    total_R: totalR,
    max_drawdown_pct: maxDrawdownPct,
    avg_holding_minutes: trades.length ? sum(trades.map(t => t.holding_minutes)) / trades.length : null,
    trades_per_30d: trades.length ? trades.length / (Math.max(1, trades.at(-1).window_days || 730) / 30) : null,
    by_side: bySide,
    candidates,
    rejected: rejectionCounts,
    censored_trades: censoredTrades,
    full_window_result_valid: censoredTrades === 0
  };
}
function formatMoney(x) { return Number(x).toFixed(2); }

function runWindow(bars, features, window, cost) {
  const { ema9, ema21, ema50, atr14, rsi14 } = features;
  const latest = bars[bars.length - 1].time;
  const windowStart = latest - window.days * 86400;
  let equity = INITIAL_EQUITY, peak = INITIAL_EQUITY, maxDD = 0;
  let dayKey = '', dayStartEquity = equity, tradesToday = 0, dailyLocked = false, permanentlyLocked = false;
  let candidates = 0, censoredTrades = 0, validWindow = true, censorDetail = null;
  const rejectionCounts = {};
  const trades = [];
  const touchReason = name => { rejectionCounts[name] = (rejectionCounts[name] || 0) + 1; };
  let nextAvailable = 0;
  for (let i = 55; i < bars.length - 15; i++) {
    const signal = bars[i];
    if (signal.time < windowStart) continue;
    if (i < nextAvailable) continue;
    if (![ema9[i], ema21[i], ema50[i], atr14[i], rsi14[i]].every(Number.isFinite) || !(atr14[i] > 0)) continue;
    const local = nyLocalInfo(signal.time);
    if (!inSession(local)) continue;
    if (local.date !== dayKey) {
      dayKey = local.date; dayStartEquity = equity; tradesToday = 0; dailyLocked = false;
    }
    if (permanentlyLocked || dailyLocked) continue;
    if (tradesToday >= 3) continue;
    const prev = bars.slice(i - 5, i);
    if (prev.length !== 5 || prev.some((b, j) => j > 0 && b.time - prev[j - 1].time !== 60) || signal.time - prev[4].time !== 60) {
      touchReason('noncontiguous_setup_bars'); continue;
    }
    candidates++;
    const trendUp = ema9[i] > ema21[i] && ema21[i] > ema50[i] && signal.close > ema21[i];
    const trendDown = ema9[i] < ema21[i] && ema21[i] < ema50[i] && signal.close < ema21[i];
    if (!trendUp && !trendDown) { touchReason('ema_trend_filter'); continue; }
    const high = Math.max(...prev.map(b => b.high));
    const low = Math.min(...prev.map(b => b.low));
    const range = signal.high - signal.low;
    const bodyAtr = Math.abs(signal.close - signal.open) / atr14[i];
    const closeLoc = range > 0 ? (signal.close - signal.low) / range : 0.5;
    const buffer = 0.05 * atr14[i];
    let side = null;
    if (trendUp && signal.close > signal.open && signal.close >= high + buffer) side = 'BUY';
    if (trendDown && signal.close < signal.open && signal.close <= low - buffer) side = 'SELL';
    if (!side) { touchReason('micro_breakout_filter'); continue; }
    if (bodyAtr < 0.35) { touchReason('body_atr_filter'); continue; }
    if (side === 'BUY' && (closeLoc < 0.65 || rsi14[i] < 52 || rsi14[i] > 75)) {
      touchReason('buy_close_location_or_rsi_filter'); continue;
    }
    if (side === 'SELL' && (closeLoc > 0.35 || rsi14[i] < 25 || rsi14[i] > 48)) {
      touchReason('sell_close_location_or_rsi_filter'); continue;
    }
    const next = bars[i + 1];
    if (!next || next.time - signal.time !== 60) { touchReason('next_m1_bar_gap'); continue; }
    const referenceEntry = signal.close;
    const swingStop = side === 'BUY'
      ? Math.min(...prev.map(b => b.low)) - 0.10 * atr14[i]
      : Math.max(...prev.map(b => b.high)) + 0.10 * atr14[i];
    const stopDistance = Math.max(Math.abs(referenceEntry - swingStop), 1.50, 1.20 * atr14[i]);
    if (stopDistance > 4.50) { touchReason('stop_too_wide'); continue; }
    const stop = side === 'BUY' ? referenceEntry - stopDistance : referenceEntry + stopDistance;
    const target = side === 'BUY'
      ? referenceEntry + RULES.target_R * stopDistance
      : referenceEntry - RULES.target_R * stopDistance;
    const entry = side === 'BUY'
      ? next.open + cost.spread + cost.slippage
      : next.open - cost.slippage;
    const realizedRisk = Math.abs(entry - stop);
    const entryGapAtr = Math.abs(next.open - signal.close) / atr14[i];
    const effectiveRR = realizedRisk > 0 ? Math.abs(target - entry) / realizedRisk : 0;
    if (!(entryGapAtr <= 0.50)) { touchReason('entry_gap_filter'); continue; }
    if (!(effectiveRR >= 1.50)) { touchReason('effective_rr_filter'); continue; }

    const riskCash = equity * RISK_PCT / 100;
    let exitTime = null, exitPrice = null, exitReason = 'TIME_EXIT', exitIndex = Math.min(i + 12, bars.length - 1);
    let localCensor = null;
    for (let j = i + 1; j <= exitIndex; j++) {
      const b = bars[j];
      if (j > i + 1 && b.time - bars[j - 1].time !== 60) {
        localCensor = {
          signal_time_utc: new Date(signal.time * 1000).toISOString(),
          previous_bar_utc: new Date(bars[j - 1].time * 1000).toISOString(),
          gap_bar_utc: new Date(b.time * 1000).toISOString(),
          gap_seconds: b.time - bars[j - 1].time
        };
        break;
      }
      const stopHit = side === 'BUY' ? b.low <= stop : b.high + cost.spread >= stop;
      const targetHit = side === 'BUY' ? b.high >= target : b.low + cost.spread <= target;
      if (stopHit) {
        exitTime = b.time; exitIndex = j; exitReason = 'STOP';
        exitPrice = side === 'BUY' ? stop - cost.slippage : stop + cost.spread + cost.slippage;
        break;
      }
      if (targetHit) {
        exitTime = b.time; exitIndex = j; exitReason = 'TARGET';
        exitPrice = side === 'BUY' ? target - cost.slippage : target + cost.spread + cost.slippage;
        break;
      }
    }
    if (localCensor) {
      censoredTrades++; validWindow = false; censorDetail = localCensor;
      break; // Do not fabricate an exit across an unverified minute-feed gap.
    }
    if (!Number.isFinite(exitTime)) {
      const last = bars[exitIndex];
      if (exitIndex > i + 1 && last.time - bars[exitIndex - 1].time !== 60) {
        censoredTrades++; validWindow = false;
        censorDetail = { signal_time_utc: new Date(signal.time * 1000).toISOString(), reason: 'time_exit_bar_not_contiguous' };
        break;
      }
      exitTime = last.time;
      exitPrice = side === 'BUY' ? last.close - cost.slippage : last.close + cost.spread + cost.slippage;
      exitReason = 'TIME_EXIT';
    }
    const pnlPrice = side === 'BUY' ? exitPrice - entry : entry - exitPrice;
    const netR = pnlPrice / realizedRisk;
    const netPnl = riskCash * netR;
    const trade = {
      signal_time: signal.time, entry_time: next.time, exit_time: exitTime,
      signal_time_utc: new Date(signal.time * 1000).toISOString(),
      entry_time_utc: new Date(next.time * 1000).toISOString(),
      exit_time_utc: new Date(exitTime * 1000).toISOString(),
      side, entry, stop_loss: stop, take_profit: target, effective_rr: effectiveRR,
      net_r: netR, net_pnl: netPnl, exit_reason: exitReason,
      holding_minutes: (exitTime - next.time) / 60,
      atr_m1: atr14[i], body_atr: bodyAtr, close_location: closeLoc, rsi14: rsi14[i],
      entry_gap_atr: entryGapAtr, risk_cash: riskCash, window_days: window.days
    };
    trades.push(trade);
    equity += netPnl; peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak > 0 ? (peak - equity) / peak * 100 : 0);
    if (equity <= dayStartEquity * 0.98) dailyLocked = true;
    if (equity <= peak * 0.95) permanentlyLocked = true;
    tradesToday++;
    nextAvailable = exitIndex + 1;
  }
  const grossWinners = trades.filter(t => t.net_pnl > 0).map(t => t.net_pnl);
  const grossLosers = trades.filter(t => t.net_pnl < 0).map(t => t.net_pnl);
  const grossWin = sum(grossWinners), grossLoss = -sum(grossLosers);
  const totalR = sum(trades.map(t => t.net_r));
  const netProfit = sum(trades.map(t => t.net_pnl));
  const summary = {
    initial_equity: INITIAL_EQUITY,
    final_equity: INITIAL_EQUITY + netProfit,
    net_profit: netProfit,
    return_pct: netProfit / INITIAL_EQUITY * 100,
    trades: trades.length,
    wins: grossWinners.length, losses: grossLosers.length,
    win_rate_pct: trades.length ? grossWinners.length / trades.length * 100 : null,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    expectancy_R: trades.length ? totalR / trades.length : null,
    total_R: totalR,
    max_drawdown_pct: maxDD,
    avg_holding_minutes: trades.length ? sum(trades.map(t => t.holding_minutes)) / trades.length : null,
    trades_per_week: trades.length / (window.days / 7),
    by_side: {}
  };
  for (const side of ['BUY', 'SELL']) {
    const xs = trades.filter(t => t.side === side);
    const wins = xs.filter(t => t.net_pnl > 0);
    const losses = xs.filter(t => t.net_pnl < 0);
    const sideWin = sum(wins.map(t => t.net_pnl));
    const sideLoss = -sum(losses.map(t => t.net_pnl));
    summary.by_side[side] = {
      trades: xs.length, wins: wins.length, losses: losses.length,
      profit_factor: sideLoss > 0 ? sideWin / sideLoss : (sideWin > 0 ? null : 0),
      expectancy_R: xs.length ? sum(xs.map(t => t.net_r)) / xs.length : null
    };
  }
  const fullWindowValid = validWindow && censoredTrades === 0;
  const gate = {
    min_trades: window.minTrades, min_profit_factor: 1.15,
    min_expectancy_R: 0.05, max_drawdown_pct: 5,
    passed: Boolean(fullWindowValid && summary.trades >= window.minTrades &&
      summary.profit_factor !== null && summary.profit_factor >= 1.15 &&
      summary.expectancy_R !== null && summary.expectancy_R >= 0.05 &&
      summary.max_drawdown_pct <= 5)
  };
  return {
    window: window.id, window_days: window.days, window_start_utc: new Date(windowStart * 1000).toISOString(),
    window_end_utc: new Date(latest * 1000).toISOString(), cost_model: cost.name,
    costs: { spread_price: cost.spread, slippage_price: cost.slippage },
    summary: { ...summary, full_window_result_valid: fullWindowValid, censored_trades: censoredTrades, censor_detail: censorDetail },
    quality_gate: gate, rejection_counts: rejectionCounts, candidates, trades
  };
}

async function main() {
  const bars = await loadBars(DATA_FILE);
  const closes = bars.map(b => b.close);
  const features = {
    ema9: ema(closes, 9), ema21: ema(closes, 21), ema50: ema(closes, 50),
    atr14: atr(bars, 14), rsi14: rsi(closes, 14)
  };
  const windows = WINDOWS.map(w => runWindow(bars, features, w, BASELINE_COST))
    .concat(WINDOWS.map(w => runWindow(bars, features, w, CONSERVATIVE_COST)));
  const report = {
    status: 'RESEARCH_ONLY_M1_SCALP',
    generated_at_utc: new Date().toISOString(),
    production_config_changed: false,
    render_deployment_performed: false,
    real_orders_enabled: false,
    data: {
      instrument: 'XAUUSD / GOLD',
      provider: 'Dukascopy Historical Data Feed',
      timeframe: 'M1 BID OHLC',
      bars: bars.length,
      first_bar_utc: new Date(bars[0].time * 1000).toISOString(),
      last_bar_utc: new Date(bars[bars.length - 1].time * 1000).toISOString(),
      historical_xm_ask_spread_available: false
    },
    rules: RULES,
    metrics: windows.map(x => ({
      window: x.window, window_days: x.window_days, window_start_utc: x.window_start_utc, window_end_utc: x.window_end_utc,
      cost_model: x.cost_model, costs: x.costs, summary: x.summary, quality_gate: x.quality_gate,
      rejection_counts: x.rejection_counts
    }))
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m1_scalp_summary.json'), JSON.stringify(report, null, 2));
  const allTrades = windows.flatMap(w => w.trades.map(t => ({
    window: w.window, cost_model: w.cost_model, ...t
  })));
  const fields = ['window','cost_model','signal_time_utc','entry_time_utc','exit_time_utc','side','entry','stop_loss','take_profit','effective_rr','net_r','net_pnl','exit_reason','holding_minutes','atr_m1','body_atr','close_location','rsi14','entry_gap_atr','risk_cash'];
  const csv = [fields.join(','), ...allTrades.map(t => fields.map(k => {
    const v = t[k];
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"','""') + '"' : s;
  }).join(','))].join('\n') + '\n';
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m1_scalp_trades.csv'), csv, 'utf8');
  const fmt = (x, d=3) => x === null || x === undefined ? '—' : Number(x).toFixed(d);
  const md = [
    '# GOLD M1 Scalping Research (research only)', '',
    'No production settings changed, no Render deployment, and real orders remain OFF.', '',
    'M1 trend-aligned micro-breakout, New York morning only, maximum 12-minute hold. Entry uses the next M1 open; stop is the recent 5-bar swing with a minimum $1.50 stop distance; target is 2R. This is a fixed hypothesis, not a parameter sweep.', '',
    '| Window | Cost model | Spread | Slippage | Valid | Trades | Trades/week | PF | Expectancy (R) | Max DD % | PnL | Gate |',
    '|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---|'
  ];
  for (const m of report.metrics) {
    md.push('| ' + [
      m.window, m.cost_model, fmt(m.costs.spread_price,2), fmt(m.costs.slippage_price,2),
      String(m.summary.full_window_result_valid), String(m.summary.trades), fmt(m.summary.trades_per_week),
      fmt(m.summary.profit_factor), fmt(m.summary.expectancy_R), fmt(m.summary.max_drawdown_pct),
      fmt(m.summary.net_profit,2), m.quality_gate.passed ? 'PASS' : 'FAIL'
    ].join(' | ') + ' |');
  }
  md.push('', '## Important limits', '',
    '- The history is Dukascopy BID M1 OHLC, not historical XM tick/Ask data. Spread/slippage are modeled and anchored to only a few days of recent XM observations.',
    '- A data gap encountered while a hypothetical trade is open censors the period rather than inventing an exit; censored windows are not valid complete-window evidence.',
    '- Positive PF/expectancy is not sufficient if the sample is too small. The gate requires at least 100 trades over five years and 40 over the independently reset 730-day period, plus PF >= 1.15, expectancy >= 0.05R and max drawdown <= 5%.',
    '- The recent 730-day window is examined in this experiment and is not an untouched holdout for later tuning.', '');
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m1_scalp_summary.md'), md.join('\n'));
  console.log(md.join('\n'));
}
await main();
