import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const DATA_FILE = process.env.GOLD_M15_RANGE_REVERSION_DATA_FILE || '';
const OUTPUT_DIR = path.resolve(process.env.GOLD_M15_RANGE_REVERSION_OUTPUT_DIR || 'gold-m15-range-reversion-output');
const INITIAL_EQUITY = Math.max(1000, Number(process.env.GOLD_RANGE_REVERSION_INITIAL_EQUITY || 100000));
const RISK_PCT = Math.max(0.01, Number(process.env.GOLD_RANGE_REVERSION_RISK_PCT || 0.25));
const BASELINE_COST = { name: 'baseline', spread: 0.58, slippage: 0.10 };
const CONSERVATIVE_COST = { name: 'conservative', spread: 0.75, slippage: 0.10 };
const MIN_SESSION_COVERAGE_PCT = 95;
const WINDOWS = [
  { id: 'five_year', days: 1825, minTrades: 150 },
  { id: 'recent_730d', days: 730, minTrades: 50 }
];

const RULES = {
  hypothesis: 'H1 non-trending regime + M15 Bollinger excursion and re-entry toward the mean; research-only fixed hypothesis',
  regime: 'Closed H1: abs(close-EMA50) <= 1.25*ATR14, abs(EMA20-EMA50) <= 1.00*ATR14, and abs(EMA20-EMA20[4]) <= 0.60*ATR14; last 5 H1 bars must be contiguous',
  buy_setup: 'Previous closed M15 close < its lower Bollinger(20,2) band and RSI14 <= 35; current closed M15 candle bullish, low <= previous lower band + 0.10*ATR14 and current close back above that prior lower band while still below previous middle band',
  sell_setup: 'Previous closed M15 close > its upper Bollinger(20,2) band and RSI14 >= 65; current closed M15 candle bearish, high >= previous upper band - 0.10*ATR14 and current close back below that prior upper band while still above previous middle band',
  entry: 'Next contiguous M15 open; Monday-Friday 09:35-12:15 America/New_York; skip if entry gap > 0.35 ATR',
  stop: 'Beyond 5-bar swing including re-entry candle, plus 0.10 ATR; accept risk distance 0.75-2.00 ATR',
  target: 'Previous-bar Bollinger middle (predefined mean-reversion target); require post-cost reward/risk >= 0.80',
  max_hold_M15_bars: 8,
  session: 'Monday-Friday 09:35-12:15 America/New_York, IANA timezone handles DST',
  max_trades_per_NY_day: 2,
  max_daily_loss_pct: 2,
  risk_per_trade_pct: RISK_PCT,
  cost_model: 'Dukascopy BID OHLC, modeled Ask/spread and adverse slippage; not historical XM Ask/ticks',
  same_bar_stop_and_target: 'STOP first (conservative)',
  data_gap_policy: 'If an open trade encounters a missing M15 interval, exit at the first observed post-gap open with adverse spread/slippage. Do not assume the intragap stop or target was filled.',
  live_orders_enabled: false
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}
function ema(values, period) {
  const result = new Array(values.length).fill(NaN);
  const alpha = 2 / (period + 1);
  let previous = NaN;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    previous = Number.isFinite(previous) ? alpha * value + (1 - alpha) * previous : value;
    result[i] = previous;
  }
  return result;
}
function consecutive(bars, start, end, intervalSeconds) {
  if (start < 0 || end >= bars.length || start > end) return false;
  for (let i = start + 1; i <= end; i++) {
    if (bars[i].time - bars[i - 1].time !== intervalSeconds) return false;
  }
  return true;
}
function atr(bars, period, intervalSeconds) {
  const tr = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    tr[i] = i > 0 && bars[i].time - bars[i - 1].time === intervalSeconds
      ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))
      : b.high - b.low;
  }
  const out = new Array(bars.length).fill(NaN);
  for (let i = period - 1; i < bars.length; i++) {
    if (!consecutive(bars, i - period + 1, i, intervalSeconds)) continue;
    const items = tr.slice(i - period + 1, i + 1);
    if (items.every(Number.isFinite)) out[i] = sum(items) / period;
  }
  return out;
}
function rsi(values, bars, period, intervalSeconds) {
  const out = new Array(values.length).fill(NaN);
  for (let i = period; i < values.length; i++) {
    if (!consecutive(bars, i - period, i, intervalSeconds)) continue;
    let gain = 0, loss = 0;
    for (let k = i - period + 1; k <= i; k++) {
      const change = values[k] - values[k - 1];
      gain += Math.max(0, change);
      loss += Math.max(0, -change);
    }
    const avgGain = gain / period, avgLoss = loss / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
function bollinger(values, bars, period, multiplier, intervalSeconds) {
  const mid = new Array(values.length).fill(NaN);
  const upper = new Array(values.length).fill(NaN);
  const lower = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    if (!consecutive(bars, i - period + 1, i, intervalSeconds)) continue;
    const xs = values.slice(i - period + 1, i + 1);
    const mean = sum(xs) / period;
    const variance = sum(xs.map(x => (x - mean) ** 2)) / period;
    const deviation = Math.sqrt(variance);
    mid[i] = mean;
    upper[i] = mean + multiplier * deviation;
    lower[i] = mean - multiplier * deviation;
  }
  return { mid, upper, lower };
}
function aggregateBars(source, sourceSeconds, targetSeconds) {
  const grouped = new Map();
  for (const bar of source) {
    const bucket = Math.floor(bar.time / targetSeconds) * targetSeconds;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(bar);
  }
  const expected = targetSeconds / sourceSeconds;
  const result = [];
  let rejectedCoverage = 0, rejectedGap = 0;
  for (const [time, items] of grouped) {
    items.sort((a, b) => a.time - b.time);
    if (items.length !== expected || items[0].time !== time ||
        items[items.length - 1].time !== time + targetSeconds - sourceSeconds) {
      rejectedCoverage++;
      continue;
    }
    if (items.some((bar, i) => i > 0 && bar.time - items[i - 1].time !== sourceSeconds)) {
      rejectedGap++;
      continue;
    }
    result.push({
      time, open: items[0].open, high: Math.max(...items.map(x => x.high)),
      low: Math.min(...items.map(x => x.low)), close: items[items.length - 1].close,
      volume: sum(items.map(x => x.volume))
    });
  }
  result.sort((a, b) => a.time - b.time);
  return { bars: result, diagnostics: { candidate_buckets: grouped.size, rejected_coverage: rejectedCoverage, rejected_gap: rejectedGap } };
}
async function loadM5(file) {
  assert(file, 'GOLD_M15_RANGE_REVERSION_DATA_FILE is required');
  const bytes = await fs.readFile(file);
  const raw = file.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  const parsed = JSON.parse(raw);
  assert(Array.isArray(parsed), 'Input M5 data must be a JSON array');
  const rows = [];
  for (const row of parsed) {
    const bar = { time: Number(row.time), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0) };
    if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) continue;
    if (bar.open <= 0 || bar.low <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) continue;
    if (bar.time % 300 !== 0) continue;
    rows.push(bar);
  }
  rows.sort((a, b) => a.time - b.time);
  const unique = [];
  let last = -Infinity;
  for (const b of rows) {
    if (b.time > last) { unique.push(b); last = b.time; }
  }
  assert(unique.length >= 200000, 'Insufficient M5 history: ' + unique.length);
  return unique;
}

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', hourCycle: 'h23'
});
const nyCache = new Map();
function nyInfo(timestamp) {
  const hourKey = Math.floor(timestamp / 3600);
  let cached = nyCache.get(hourKey);
  if (!cached) {
    const parts = nyFormatter.formatToParts(new Date(hourKey * 3600 * 1000));
    const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
    cached = { date: obj.year + '-' + obj.month + '-' + obj.day, weekday: obj.weekday, hour: Number(obj.hour) };
    nyCache.set(hourKey, cached);
  }
  return { ...cached, minute: new Date(timestamp * 1000).getUTCMinutes() };
}
function inSession(value) {
  const info = typeof value === 'number' ? nyInfo(value) : value;
  if (!info || info.weekday === 'Sat' || info.weekday === 'Sun') return false;
  const minute = info.hour * 60 + info.minute;
  return minute >= 9 * 60 + 35 && minute <= 12 * 60 + 15;
}
function closedH1Index(h1, features, closeTime) {
  let lo = 0, hi = h1.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h1[mid].time + 3600 <= closeTime) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (best < 55 || closeTime - (h1[best].time + 3600) > 3600 ||
      !consecutive(h1, best - 4, best, 3600) ||
      !Number.isFinite(features.atr14[best]) ||
      !Number.isFinite(features.ema20[best]) ||
      !Number.isFinite(features.ema50[best]) ||
      !Number.isFinite(features.ema20[best - 4])) return -1;
  const a = features.atr14[best];
  const flatDistance = Math.abs(h1[best].close - features.ema50[best]) <= 1.25 * a;
  const closeAverages = Math.abs(features.ema20[best] - features.ema50[best]) <= 1.00 * a;
  const lowSlope = Math.abs(features.ema20[best] - features.ema20[best - 4]) <= 0.60 * a;
  return flatDistance && closeAverages && lowSlope ? best : -1;
}
function metrics(trades, window, cost, dataRangeValid, incompleteHistory) {
  const wins = trades.filter(t => t.net_pnl > 0), losses = trades.filter(t => t.net_pnl < 0);
  const grossWin = sum(wins.map(t => t.net_pnl)), grossLoss = -sum(losses.map(t => t.net_pnl));
  const totalR = sum(trades.map(t => t.net_r)), totalPnl = sum(trades.map(t => t.net_pnl));
  const summary = {
    initial_equity: INITIAL_EQUITY, final_equity: INITIAL_EQUITY + totalPnl,
    net_profit: totalPnl, return_pct: totalPnl / INITIAL_EQUITY * 100,
    trades: trades.length, wins: wins.length, losses: losses.length,
    win_rate_pct: trades.length ? 100 * wins.length / trades.length : null,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    expectancy_R: trades.length ? totalR / trades.length : null, total_R: totalR,
    max_drawdown_pct: trades.length ? Math.max(...trades.map(t => t.drawdown_after_pct || 0)) : 0,
    trades_per_week: trades.length / (window.days / 7),
    full_window_result_valid: dataRangeValid && !incompleteHistory,
    gap_open_exit_trades: trades.filter(t => t.exit_reason === 'GAP_OPEN_EXIT').length
  };
  const baseline = cost.name === 'baseline';
  const gate = {
    min_trades: window.minTrades, min_profit_factor: baseline ? 1.20 : 1.00,
    min_expectancy_R: baseline ? 0.10 : 0.00, max_drawdown_pct: 5,
    passed: Boolean(summary.full_window_result_valid && summary.trades >= window.minTrades &&
      summary.profit_factor !== null && summary.profit_factor >= (baseline ? 1.20 : 1.00) &&
      summary.expectancy_R !== null && summary.expectancy_R >= (baseline ? 0.10 : 0.00) &&
      summary.max_drawdown_pct <= 5)
  };
  return { summary, quality_gate: gate };
}
function runWindow(m15, h1, features, window, cost, latest, dataRangeValid) {
  const windowStart = latest - window.days * 86400;
  let equity = INITIAL_EQUITY, peak = INITIAL_EQUITY, maxDd = 0;
  let dateKey = '', dayStart = equity, tradesToday = 0, dailyLocked = false, h1Pointer = -1;
  let nextAvailable = 0, candidates = 0, incompleteHistory = false;
  const trades = [], rejected = {};
  const reject = key => { rejected[key] = (rejected[key] || 0) + 1; };

  for (let i = 60; i < m15.length - 10; i++) {
    const signal = m15[i];
    if (signal.time + 900 < windowStart || i < nextAvailable) continue;
    if (!consecutive(m15, i - 20, i, 900)) { reject('noncontiguous_m15'); continue; }
    if (![features.atr14[i], features.rsi14[i], features.bbMid[i], features.bbUpper[i], features.bbLower[i],
          features.rsi14[i - 1], features.bbUpper[i - 1], features.bbLower[i - 1], features.bbMid[i - 1]]
          .every(Number.isFinite) || !(features.atr14[i] > 0)) { reject('m15_indicator_unavailable'); continue; }
    const next = m15[i + 1];
    if (!next || next.time !== signal.time + 900) { reject('next_bar_gap'); continue; }
    const local = nyInfo(next.time);
    if (!inSession(signal.time) || !inSession(next.time)) continue;
    if (local.date !== dateKey) {
      dateKey = local.date; dayStart = equity; tradesToday = 0; dailyLocked = false;
    }
    if (dailyLocked) { reject('daily_loss_lock'); continue; }
    if (tradesToday >= 2) { reject('max_trades_per_day'); continue; }
    const hi = closedH1Index(h1, features.h1, signal.time + 900);
    if (hi < 0) { reject('h1_range_regime_filter'); continue; }
    candidates++;

    const prior = m15[i - 1], atrNow = features.atr14[i];
    const longSignal = prior.close < features.bbLower[i - 1] && features.rsi14[i - 1] <= 35 &&
      signal.close > signal.open && signal.low <= features.bbLower[i - 1] + 0.10 * atrNow &&
      signal.close > features.bbLower[i - 1] && signal.close < features.bbMid[i - 1];
    const shortSignal = prior.close > features.bbUpper[i - 1] && features.rsi14[i - 1] >= 65 &&
      signal.close < signal.open && signal.high >= features.bbUpper[i - 1] - 0.10 * atrNow &&
      signal.close < features.bbUpper[i - 1] && signal.close > features.bbMid[i - 1];
    if (!longSignal && !shortSignal) { reject('band_reentry_filter'); continue; }
    const side = longSignal ? 'BUY' : 'SELL';
    const entryGapAtr = Math.abs(next.open - signal.close) / atrNow;
    if (entryGapAtr > 0.35) { reject('entry_gap_filter'); continue; }

    const swing = m15.slice(i - 4, i + 1);
    const stop = side === 'BUY'
      ? Math.min(...swing.map(x => x.low)) - 0.10 * atrNow
      : Math.max(...swing.map(x => x.high)) + 0.10 * atrNow;
    const plannedRisk = side === 'BUY' ? signal.close - stop : stop - signal.close;
    if (!(plannedRisk >= 0.75 * atrNow && plannedRisk <= 2.00 * atrNow)) { reject('stop_distance_filter'); continue; }
    const target = features.bbMid[i - 1];
    const entry = side === 'BUY' ? next.open + cost.spread + cost.slippage : next.open - cost.slippage;
    const realizedRisk = side === 'BUY' ? entry - stop : stop + cost.spread + cost.slippage - entry;
    const targetNet = side === 'BUY'
      ? target - cost.slippage - entry
      : entry - (target + cost.spread + cost.slippage);
    const effRR = realizedRisk > 0 ? targetNet / realizedRisk : 0;
    if (!(realizedRisk > 0) || effRR < 0.80) { reject('target_rr_filter'); continue; }

    const riskCash = equity * RISK_PCT / 100;
    let exitTime = null, exitPrice = null, exitReason = 'TIME_EXIT', exitIndex = i + 1;
    const lastPossible = Math.min(i + 8, m15.length - 1);
    for (let j = i + 1; j <= lastPossible; j++) {
      if (j > i + 1 && m15[j].time - m15[j - 1].time !== 900) {
        const reopened = m15[j];
        exitTime = reopened.time; exitIndex = j; exitReason = 'GAP_OPEN_EXIT';
        exitPrice = side === 'BUY' ? reopened.open - cost.slippage : reopened.open + cost.spread + cost.slippage;
        break;
      }
      const b = m15[j];
      const stopHit = side === 'BUY' ? b.low <= stop : b.high + cost.spread >= stop;
      const targetHit = side === 'BUY' ? b.low <= target && false : b.high >= target && false;
      const targetReached = side === 'BUY' ? b.high >= target : b.low + cost.spread <= target;
      if (stopHit) {
        exitTime = b.time; exitIndex = j; exitReason = 'STOP';
        exitPrice = side === 'BUY' ? stop - cost.slippage : stop + cost.spread + cost.slippage;
        break;
      }
      if (targetReached) {
        exitTime = b.time; exitIndex = j; exitReason = 'TARGET';
        exitPrice = side === 'BUY' ? target - cost.slippage : target + cost.spread + cost.slippage;
        break;
      }
    }
    if (exitTime === null) {
      if (lastPossible < i + 8) { incompleteHistory = true; break; }
      exitIndex = lastPossible; const last = m15[exitIndex];
      exitTime = last.time + 900; exitPrice = side === 'BUY' ? last.close - cost.slippage : last.close + cost.spread + cost.slippage;
      exitReason = 'TIME_EXIT';
    }
    const pricePnl = side === 'BUY' ? exitPrice - entry : entry - exitPrice;
    const netR = pricePnl / realizedRisk, netPnl = riskCash * netR;
    equity += netPnl; peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak > 0 ? (peak - equity) / peak * 100 : 0);
    trades.push({
      signal_time_utc: new Date(signal.time * 1000).toISOString(),
      entry_time_utc: new Date(next.time * 1000).toISOString(),
      exit_time_utc: new Date(exitTime * 1000).toISOString(), side, entry, stop_loss: stop,
      take_profit: target, planned_risk_price: plannedRisk, effective_rr: effRR,
      net_r: netR, net_pnl: netPnl, exit_reason: exitReason,
      holding_minutes: (exitTime - next.time) / 60, atr_m15: atrNow,
      rsi_previous: features.rsi14[i - 1], entry_gap_atr: entryGapAtr, risk_cash: riskCash,
      drawdown_after_pct: peak > 0 ? (peak - equity) / peak * 100 : 0,
      window_days: window.days
    });
    if (equity <= dayStart * 0.98) dailyLocked = true;
    tradesToday++; nextAvailable = exitIndex + 1;
  }

  const result = metrics(trades, window, cost, dataRangeValid, incompleteHistory);
  return {
    window: window.id, window_days: window.days, window_start_utc: new Date(windowStart * 1000).toISOString(),
    window_end_utc: new Date(latest * 1000).toISOString(), cost_model: cost.name,
    costs: { spread_price: cost.spread, slippage_price: cost.slippage },
    summary: { ...result.summary, candidates, rejection_counts: rejected },
    quality_gate: result.quality_gate, trades
  };
}
function selfTest() {
  const m5 = [];
  const base = Math.floor(Date.UTC(2026, 9, 16, 13, 0, 0) / 1000);
  for (let i = 0; i < 12 * 24; i++) {
    const open = 2500 + Math.sin(i / 6) * 0.2;
    m5.push({ time: base + i * 300, open, high: open + 0.1, low: open - 0.1, close: open + Math.cos(i / 5) * 0.05, volume: 1 });
  }
  const m15 = aggregateBars(m5, 300, 900), h1 = aggregateBars(m5, 300, 3600);
  assert(m15.bars.length === 96, 'M15 aggregation self-test failed');
  assert(h1.bars.length === 24, 'H1 aggregation self-test failed');
  const bands = bollinger(m15.bars.map(x => x.close), m15.bars, 20, 2, 900);
  assert(Number.isFinite(bands.mid[25]) && bands.upper[25] > bands.mid[25] && bands.mid[25] > bands.lower[25], 'Bollinger self-test failed');
  const at = nyInfo(Date.UTC(2026, 9, 16, 13, 45) / 1000);
  assert(inSession(at) && inSession(Date.UTC(2026, 9, 16, 13, 45) / 1000), 'New York session timestamp/object test failed');
  assert(!inSession(Date.UTC(2026, 9, 16, 16, 30) / 1000), 'New York session end test failed');
  assert(Math.abs((2500 - 0.1) - 2499.9) < 1e-9, 'BUY gap open modeled exit sanity failed');
  console.log(JSON.stringify({ self_test: 'PASS', m15_bars: m15.bars.length, h1_bars: h1.bars.length }, null, 2));
}
function fmt(v, d = 3) { return v === null || v === undefined || !Number.isFinite(v) ? '—' : Number(v).toFixed(d); }
async function main() {
  if (process.argv.includes('--self-test')) { selfTest(); return; }
  const source = await loadM5(DATA_FILE);
  const m15Result = aggregateBars(source, 300, 900), h1Result = aggregateBars(source, 300, 3600);
  const m15 = m15Result.bars, h1 = h1Result.bars;
  assert(m15.length >= 10000 && h1.length >= 1000, 'Insufficient aggregated M15/H1 bars');
  const m15Close = m15.map(x => x.close), h1Close = h1.map(x => x.close);
  const bands = bollinger(m15Close, m15, 20, 2, 900);
  const features = {
    atr14: atr(m15, 14, 900),
    rsi14: rsi(m15Close, m15, 14, 900),
    bbMid: bands.mid, bbUpper: bands.upper, bbLower: bands.lower,
    h1: { ema20: ema(h1Close, 20), ema50: ema(h1Close, 50), atr14: atr(h1, 14, 3600) }
  };
  const actualEnd = m15[m15.length - 1].time + 900;
  const rawEnd = process.env.GOLD_RESEARCH_END_UTC || new Date(actualEnd * 1000).toISOString();
  const latest = Math.floor(Date.parse(rawEnd) / 1000);
  assert(Number.isFinite(latest) && latest > 0, 'Invalid GOLD_RESEARCH_END_UTC');
  const windowStart = latest - 1825 * 86400;
  const dataRangeValid = m15[0].time <= windowStart + 3 * 86400 && actualEnd >= latest - 3 * 86400;
  const results = [];
  for (const cost of [BASELINE_COST, CONSERVATIVE_COST]) {
    for (const window of WINDOWS) results.push(runWindow(m15, h1, features, window, cost, latest, dataRangeValid));
  }
  const report = {
    status: 'RESEARCH_ONLY_GOLD_M15_RANGE_REVERSION',
    generated_at_utc: new Date().toISOString(), production_config_changed: false,
    render_deployment_performed: false, real_orders_enabled: false,
    data: { instrument: 'XAUUSD / GOLD', provider: 'Dukascopy Historical Data Feed', input_timeframe: 'M5 BID OHLC',
      source_bars: source.length, first_source_bar_utc: new Date(source[0].time * 1000).toISOString(),
      last_source_bar_utc: new Date(source[source.length - 1].time * 1000).toISOString(),
      expected_window_start_utc: new Date(windowStart * 1000).toISOString(),
      configured_window_end_utc: new Date(latest * 1000).toISOString(), data_range_valid: dataRangeValid,
      m15_bars: m15.length, h1_bars: h1.length, m15_quality: m15Result.diagnostics,
      h1_quality: h1Result.diagnostics, historical_xm_ask_spread_available: false },
    rules: RULES,
    metrics: results.map(r => ({ window:r.window, window_days:r.window_days, window_start_utc:r.window_start_utc,
      window_end_utc:r.window_end_utc, cost_model:r.cost_model, costs:r.costs, summary:r.summary,
      quality_gate:r.quality_gate }))
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_range_reversion_summary.json'), JSON.stringify(report, null, 2));
  const allTrades = results.flatMap(r => r.trades.map(t => ({ window:r.window, cost_model:r.cost_model, ...t })));
  const fields = ['window','cost_model','signal_time_utc','entry_time_utc','exit_time_utc','side','entry','stop_loss','take_profit',
    'planned_risk_price','effective_rr','net_r','net_pnl','exit_reason','holding_minutes','atr_m15','rsi_previous','entry_gap_atr','risk_cash'];
  const csv = [fields.join(','), ...allTrades.map(t => fields.map(k => {
    const v = t[k], s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"','""') + '"' : s;
  }).join(','))].join('\n') + '\n';
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_range_reversion_trades.csv'), csv, 'utf8');
  const md = ['# GOLD M15 Range Reversion Research (research only)','',
    'No production settings changed, no Render deployment, and real orders remain OFF.','',
    'Fixed hypothesis: H1 non-trending regime; M15 Bollinger(20,2) excursion and close-back-inside; RSI confirmation; swing stop; target previous-bar Bollinger middle; maximum hold 8 M15 bars; New York morning only. No parameter sweep.','',
    '| Window | Cost | Spread | Slippage | Valid | Trades | Trades/week | PF | Expectancy (R) | Max DD % | Net PnL | Gate |',
    '|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---|'];
  for (const x of report.metrics) md.push('| ' + [x.window,x.cost_model,fmt(x.costs.spread_price,2),fmt(x.costs.slippage_price,2),
    String(x.summary.full_window_result_valid),String(x.summary.trades),fmt(x.summary.trades_per_week),fmt(x.summary.profit_factor),
    fmt(x.summary.expectancy_R),fmt(x.summary.max_drawdown_pct),fmt(x.summary.net_profit,2),x.quality_gate.passed?'PASS':'FAIL'].join(' | ') + ' |');
  md.push('','## Interpretation limits','',
    '- Dukascopy BID M5 OHLC is used; historical XM Ask/tick spreads are not available over the full period. Costs are modeled.',
    '- M15/H1 candles require complete M5 buckets. Open trades across a missing interval exit at the first observed post-gap open with adverse modeled execution costs.',
    '- The recent 730-day slice shares the five-year source and is not an untouched holdout.',
    '- Passing this screen would still require a separately reserved holdout and XM paper/forward execution.','');
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_range_reversion_summary.md'), md.join('\n'));
  console.log(md.join('\n'));
}
await main();
