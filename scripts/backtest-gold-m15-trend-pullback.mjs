import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const DATA_FILE = process.env.GOLD_M15_PULLBACK_DATA_FILE || 'gold-xauusd-data/xauusd-m1.json.gz';
const OUTPUT_DIR = path.resolve(process.env.GOLD_M15_PULLBACK_OUTPUT_DIR || 'gold-m15-trend-pullback-output');
const INITIAL_EQUITY = Math.max(1000, Number(process.env.GOLD_PULLBACK_INITIAL_EQUITY || 100000));
const RISK_PCT = Math.max(0.01, Number(process.env.GOLD_PULLBACK_RISK_PCT || 0.25));
const BASELINE_COST = { name: 'baseline', spread: 0.58, slippage: 0.10 };
const CONSERVATIVE_COST = { name: 'conservative', spread: 0.75, slippage: 0.10 };
const MIN_SESSION_COVERAGE_PCT = 95;
const WINDOWS = [
  { id: 'five_year', days: 1825, minTrades: 150 },
  { id: 'recent_730d', days: 730, minTrades: 50 }
];

const RULES = {
  hypothesis: 'H1 trend filter + M15 EMA20 pullback/reclaim; research only',
  trend: 'BUY when closed H1 close > EMA50, EMA20 > EMA50, and EMA20 has risen over the previous 3 valid consecutive H1 bars; SELL is inverse',
  setup: 'Within the last 3 contiguous closed M15 bars price approaches EMA20 within +0.20/-0.40 ATR; latest bar closes with trend, beyond the prior bar high/low, with close location >=0.55 for BUY or <=0.45 for SELL',
  entry: 'Next M15 bar open only; skip if the next bar is missing or entry gap exceeds 0.35 ATR',
  stop: 'Beyond the 5-bar swing plus 0.10 ATR; skip if risk distance is outside 0.80-2.00 ATR',
  target_R: 1.8,
  max_hold_M15_bars: 16,
  session: 'Monday-Friday 09:35-12:15 America/New_York, based on actual local timezone/DST',
  max_trades_per_NY_day: 2,
  max_daily_loss_pct: 2,
  risk_per_trade_pct: RISK_PCT,
  cost_model: 'Dukascopy BID OHLC; modeled entry/exit spread and slippage; not historical XM Ask ticks',
  aggregation_quality: 'M15 buckets require >=70% active M1 bars, edges within 3 minutes, and maximum observed-minute gap <=5 minutes; H1 buckets require >=75% active M1 bars, edges within 10 minutes, and max gap <=10 minutes',
  same_bar_stop_and_target: 'STOP first (conservative)',
  live_orders_enabled: false
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}
function ema(values, period) {
  const out = new Array(values.length).fill(NaN);
  const alpha = 2 / (period + 1);
  let previous = NaN;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    previous = Number.isFinite(previous) ? alpha * value + (1 - alpha) * previous : value;
    out[i] = previous;
  }
  return out;
}
function atr(bars, period, secondsPerBar) {
  const ranges = new Array(bars.length).fill(NaN);
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const contiguous = i > 0 && bar.time - bars[i - 1].time === secondsPerBar;
    ranges[i] = contiguous
      ? Math.max(bar.high - bar.low, Math.abs(bar.high - bars[i - 1].close), Math.abs(bar.low - bars[i - 1].close))
      : bar.high - bar.low;
  }
  const out = new Array(bars.length).fill(NaN);
  for (let i = period - 1; i < bars.length; i++) {
    const window = ranges.slice(i - period + 1, i + 1);
    if (window.every(Number.isFinite)) out[i] = sum(window) / period;
  }
  return out;
}

async function loadM1(file) {
  const bytes = await fs.readFile(file);
  const raw = file.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
  const parsed = JSON.parse(raw);
  assert(Array.isArray(parsed), 'M1 input must be a JSON array');
  const rows = [];
  for (const row of parsed) {
    const bar = {
      time: Number(row.time), open: Number(row.open), high: Number(row.high),
      low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0)
    };
    if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) continue;
    if (bar.open <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low <= 0) continue;
    if (bar.time % 60 !== 0) continue;
    rows.push(bar);
  }
  rows.sort((a, b) => a.time - b.time);
  const unique = [];
  let lastTime = -Infinity;
  for (const bar of rows) {
    if (bar.time <= lastTime) continue;
    unique.push(bar);
    lastTime = bar.time;
  }
  assert(unique.length >= 500000, 'Insufficient valid M1 history: ' + unique.length);
  return unique;
}

function aggregateActiveM1(m1, seconds, quality) {
  const grouped = new Map();
  for (const bar of m1) {
    const bucket = Math.floor(bar.time / seconds) * seconds;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(bar);
  }
  const expectedMinutes = seconds / 60;
  const result = [];
  let rejectedCoverage = 0;
  let rejectedGap = 0;
  for (const [time, rows] of grouped) {
    rows.sort((a, b) => a.time - b.time);
    const minRows = Math.ceil(expectedMinutes * quality.minCoverage);
    if (rows.length < minRows ||
        rows[0].time > time + quality.edgeMinutes * 60 ||
        rows[rows.length - 1].time < time + seconds - quality.edgeMinutes * 60) {
      rejectedCoverage++;
      continue;
    }
    let maxGap = 0;
    for (let i = 1; i < rows.length; i++) maxGap = Math.max(maxGap, rows[i].time - rows[i - 1].time);
    if (maxGap > quality.maxGapMinutes * 60) {
      rejectedGap++;
      continue;
    }
    result.push({
      time,
      open: rows[0].open,
      high: Math.max(...rows.map(x => x.high)),
      low: Math.min(...rows.map(x => x.low)),
      close: rows[rows.length - 1].close,
      volume: sum(rows.map(x => x.volume)),
      active_m1_rows: rows.length,
      coverage_pct: rows.length / expectedMinutes * 100
    });
  }
  result.sort((a, b) => a.time - b.time);
  return { bars: result, diagnostics: { candidate_buckets: grouped.size, rejected_coverage: rejectedCoverage, rejected_gap: rejectedGap } };
}

const nyFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', hourCycle: 'h23'
});
const nyHourCache = new Map();
function nyInfo(epochSeconds) {
  const utcHour = Math.floor(epochSeconds / 3600);
  let item = nyHourCache.get(utcHour);
  if (!item) {
    const parts = nyFormatter.formatToParts(new Date(utcHour * 3600 * 1000));
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    item = {
      date: p.year + '-' + p.month + '-' + p.day,
      weekday: p.weekday,
      hour: Number(p.hour)
    };
    nyHourCache.set(utcHour, item);
  }
  return { ...item, minute: new Date(epochSeconds * 1000).getUTCMinutes() };
}
function inSession(info) {
  if (info.weekday === 'Sat' || info.weekday === 'Sun') return false;
  const minute = info.hour * 60 + info.minute;
  return minute >= 9 * 60 + 35 && minute <= 12 * 60 + 15;
}
function localTimeToEpoch(dateKey, minuteOfDay) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcNoon = Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000);
  const local = nyInfo(utcNoon);
  const utcAsLocal = Math.floor(Date.UTC(year, month - 1, day, local.hour, new Date(utcNoon * 1000).getUTCMinutes(), 0) / 1000);
  const offsetSeconds = utcAsLocal - utcNoon;
  const targetAsUtc = Math.floor(Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0) / 1000);
  return targetAsUtc - offsetSeconds;
}
function sessionCoverage(bars, windowStart, windowEnd) {
  const startMinute = 9 * 60 + 30, endMinute = 12 * 60 + 15, stepMinutes = 15;
  const expected = new Map(), observed = new Map();
  for (let t = Math.floor(windowStart / 86400) * 86400 - 86400; t < windowEnd + 86400; t += 86400) {
    const local = nyInfo(t + 12 * 3600);
    if (local.weekday === 'Sat' || local.weekday === 'Sun' || expected.has(local.date)) continue;
    const first = localTimeToEpoch(local.date, startMinute);
    const last = localTimeToEpoch(local.date, endMinute);
    if (last < windowStart || first >= windowEnd) continue;
    const slots = [];
    for (let minute = startMinute; minute <= endMinute; minute += stepMinutes) {
      const ts = localTimeToEpoch(local.date, minute);
      if (ts >= windowStart && ts < windowEnd) slots.push(ts);
    }
    if (slots.length) expected.set(local.date, new Set(slots));
  }
  for (const bar of bars) {
    if (bar.time < windowStart || bar.time >= windowEnd) continue;
    const local = nyInfo(bar.time);
    if (local.weekday === 'Sat' || local.weekday === 'Sun') continue;
    const minute = local.hour * 60 + local.minute;
    if (minute < startMinute || minute > endMinute || (minute - startMinute) % stepMinutes !== 0 || !expected.has(local.date)) continue;
    if (!observed.has(local.date)) observed.set(local.date, new Set());
    observed.get(local.date).add(minute);
  }
  let coveredDays = 0, observedSlots = 0, expectedSlots = 0;
  let maxConsecutiveIncompleteWeekdays = 0, consecutiveIncompleteWeekdays = 0;
  for (const [date, slots] of [...expected.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const count = observed.get(date)?.size || 0;
    observedSlots += count;
    expectedSlots += slots.size;
    if (count >= Math.min(slots.size, 11)) {
      coveredDays++;
      consecutiveIncompleteWeekdays = 0;
    } else {
      consecutiveIncompleteWeekdays++;
      maxConsecutiveIncompleteWeekdays = Math.max(maxConsecutiveIncompleteWeekdays, consecutiveIncompleteWeekdays);
    }
  }
  return {
    expected_weekdays: expected.size, covered_weekdays: coveredDays,
    incomplete_weekdays: expected.size - coveredDays,
    coverage_pct: expected.size ? coveredDays / expected.size * 100 : 0,
    max_consecutive_incomplete_weekdays: maxConsecutiveIncompleteWeekdays,
    observed_m15_bars: observedSlots, expected_m15_bars: expectedSlots,
    m15_slot_coverage_pct: expectedSlots ? observedSlots / expectedSlots * 100 : 0,
    minimum_day_bars: 11, required_window_coverage_pct: MIN_SESSION_COVERAGE_PCT
  };
}
function getWindowEnd(defaultEnd) {
  const raw = process.env.GOLD_RESEARCH_END_UTC;
  if (!raw) return defaultEnd;
  const ms = Date.parse(raw);
  assert(Number.isFinite(ms), 'Invalid GOLD_RESEARCH_END_UTC: ' + raw);
  return Math.floor(ms / 1000);
}
function consecutive(bars, start, end, intervalSeconds) {
  if (start < 0 || end >= bars.length || start > end) return false;
  for (let i = start + 1; i <= end; i++) {
    if (bars[i].time - bars[i - 1].time !== intervalSeconds) return false;
  }
  return true;
}
function computeFeatures(m15, h1) {
  const m15Close = m15.map(x => x.close);
  const h1Close = h1.map(x => x.close);
  return {
    m15Ema20: ema(m15Close, 20),
    m15Atr14: atr(m15, 14, 900),
    h1Ema20: ema(h1Close, 20),
    h1Ema50: ema(h1Close, 50)
  };
}
function locateClosedH1(signalCloseTime, h1, pointer) {
  while (pointer + 1 < h1.length && h1[pointer + 1].time + 3600 <= signalCloseTime) pointer++;
  if (pointer < 0) return { index: -1, pointer };
  const age = signalCloseTime - (h1[pointer].time + 3600);
  if (age < 0 || age > 3600) return { index: -1, pointer };
  if (pointer < 3 || !consecutive(h1, pointer - 3, pointer, 3600)) return { index: -1, pointer };
  return { index: pointer, pointer };
}
function fmt(value, decimals = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : Number(value).toFixed(decimals);
}

function runWindow(m15, h1, features, window, cost, latest, dataRangeValid) {
  const windowStart = latest - window.days * 86400;
  let equity = INITIAL_EQUITY;
  let peakEquity = INITIAL_EQUITY;
  let maxDrawdownPct = 0;
  let nyDay = '';
  let dayStartEquity = INITIAL_EQUITY;
  let tradesToday = 0;
  let dailyLocked = false;
  let candidates = 0;
  let censoredTrades = 0;
  let censorDetail = null;
  let validWindow = true;
  let h1Pointer = -1;
  let nextAvailable = 0;
  const trades = [];
  const rejection = {};
  const reject = key => { rejection[key] = (rejection[key] || 0) + 1; };

  for (let i = 55; i < m15.length - 16; i++) {
    const signal = m15[i];
    if (signal.time + 900 < windowStart) continue;
    if (i < nextAvailable) continue;
    if (!consecutive(m15, i - 4, i, 900)) { reject('noncontiguous_m15_setup'); continue; }
    const signalEnd = signal.time + 900;
    const aligned = locateClosedH1(signalEnd, h1, h1Pointer);
    h1Pointer = aligned.pointer;
    const h = aligned.index;
    if (h < 50 || !Number.isFinite(features.m15Ema20[i]) || !Number.isFinite(features.m15Atr14[i]) ||
        !Number.isFinite(features.h1Ema20[h]) || !Number.isFinite(features.h1Ema50[h]) ||
        !Number.isFinite(features.h1Ema20[h - 3]) || !(features.m15Atr14[i] > 0)) {
      reject('indicator_or_h1_availability');
      continue;
    }
    const entryBar = m15[i + 1];
    if (!entryBar || entryBar.time !== signalEnd) { reject('next_m15_bar_gap'); continue; }
    const entryLocal = nyInfo(entryBar.time);
    if (!inSession(entryLocal)) continue;
    if (entryLocal.date !== nyDay) {
      nyDay = entryLocal.date;
      dayStartEquity = equity;
      tradesToday = 0;
      dailyLocked = false;
    }
    if (dailyLocked) { reject('daily_loss_lock'); continue; }
    if (tradesToday >= 2) { reject('max_trades_per_day'); continue; }
    candidates++;

    const trendUp = h1[h].close > features.h1Ema50[h] &&
      features.h1Ema20[h] > features.h1Ema50[h] &&
      features.h1Ema20[h] > features.h1Ema20[h - 3];
    const trendDown = h1[h].close < features.h1Ema50[h] &&
      features.h1Ema20[h] < features.h1Ema50[h] &&
      features.h1Ema20[h] < features.h1Ema20[h - 3];
    if (!trendUp && !trendDown) { reject('h1_trend_filter'); continue; }

    const atrNow = features.m15Atr14[i];
    const emaNow = features.m15Ema20[i];
    let touchedForBuy = false, touchedForSell = false;
    for (let k = i - 2; k <= i; k++) {
      const a = features.m15Atr14[k], e = features.m15Ema20[k];
      if (!Number.isFinite(a) || !Number.isFinite(e) || !(a > 0)) continue;
      if (m15[k].low <= e + 0.20 * a && m15[k].low >= e - 0.40 * a) touchedForBuy = true;
      if (m15[k].high >= e - 0.20 * a && m15[k].high <= e + 0.40 * a) touchedForSell = true;
    }
    const range = signal.high - signal.low;
    const closeLocation = range > 0 ? (signal.close - signal.low) / range : 0.5;
    const bodyAtr = Math.abs(signal.close - signal.open) / atrNow;
    let side = null;
    if (trendUp && touchedForBuy && signal.close > emaNow && signal.close > signal.open &&
        signal.close > m15[i - 1].high && closeLocation >= 0.55 && bodyAtr >= 0.20) side = 'BUY';
    if (trendDown && touchedForSell && signal.close < emaNow && signal.close < signal.open &&
        signal.close < m15[i - 1].low && closeLocation <= 0.45 && bodyAtr >= 0.20) side = 'SELL';
    if (!side) { reject('m15_pullback_reclaim_filter'); continue; }

    const entryGapAtr = Math.abs(entryBar.open - signal.close) / atrNow;
    if (entryGapAtr > 0.35) { reject('entry_gap_filter'); continue; }

    const swing = m15.slice(i - 4, i + 1);
    const stop = side === 'BUY'
      ? Math.min(...swing.map(x => x.low)) - 0.10 * atrNow
      : Math.max(...swing.map(x => x.high)) + 0.10 * atrNow;
    const plannedRisk = side === 'BUY' ? signal.close - stop : stop - signal.close;
    if (!(plannedRisk >= 0.80 * atrNow && plannedRisk <= 2.00 * atrNow)) {
      reject('stop_distance_atr_filter');
      continue;
    }
    const target = side === 'BUY'
      ? signal.close + 1.80 * plannedRisk
      : signal.close - 1.80 * plannedRisk;
    const entry = side === 'BUY'
      ? entryBar.open + cost.spread + cost.slippage
      : entryBar.open - cost.slippage;
    const realizedRisk = side === 'BUY'
      ? entry - stop
      : stop + cost.spread + cost.slippage - entry;
    const netRewardAtTarget = side === 'BUY'
      ? target - cost.slippage - entry
      : entry - (target + cost.spread + cost.slippage);
    const effectiveRR = realizedRisk > 0 ? netRewardAtTarget / realizedRisk : 0;
    if (!(realizedRisk > 0) || effectiveRR < 1.25) { reject('effective_rr_filter'); continue; }

    const riskCash = equity * RISK_PCT / 100;
    let exitTime = null, exitPrice = null, exitReason = 'TIME_EXIT', exitIndex = i + 1;
    let localCensor = null;
    const lastPossible = Math.min(i + 16, m15.length - 1);
    for (let j = i + 1; j <= lastPossible; j++) {
      if (j > i + 1 && m15[j].time - m15[j - 1].time !== 900) {
        localCensor = {
          signal_time_utc: new Date(signal.time * 1000).toISOString(),
          prior_bar_utc: new Date(m15[j - 1].time * 1000).toISOString(),
          gap_bar_utc: new Date(m15[j].time * 1000).toISOString(),
          gap_seconds: m15[j].time - m15[j - 1].time
        };
        break;
      }
      const bar = m15[j];
      const stopHit = side === 'BUY' ? bar.low <= stop : bar.high + cost.spread >= stop;
      const targetHit = side === 'BUY' ? bar.high >= target : bar.low + cost.spread <= target;
      if (stopHit) {
        exitTime = bar.time;
        exitIndex = j;
        exitReason = 'STOP';
        exitPrice = side === 'BUY' ? stop - cost.slippage : stop + cost.spread + cost.slippage;
        break;
      }
      if (targetHit) {
        exitTime = bar.time;
        exitIndex = j;
        exitReason = 'TARGET';
        exitPrice = side === 'BUY' ? target - cost.slippage : target + cost.spread + cost.slippage;
        break;
      }
    }
    if (localCensor) {
      censoredTrades++;
      validWindow = false;
      censorDetail = localCensor;
      break;
    }
    if (exitTime === null) {
      if (lastPossible < i + 16) {
        censoredTrades++;
        validWindow = false;
        censorDetail = { signal_time_utc: new Date(signal.time * 1000).toISOString(), reason: 'insufficient_future_bars_for_max_hold' };
        break;
      }
      exitIndex = lastPossible;
      const last = m15[exitIndex];
      exitTime = last.time + 900;
      exitPrice = side === 'BUY' ? last.close - cost.slippage : last.close + cost.spread + cost.slippage;
      exitReason = 'TIME_EXIT';
    }

    const pricePnl = side === 'BUY' ? exitPrice - entry : entry - exitPrice;
    const netR = pricePnl / realizedRisk;
    const netPnl = riskCash * netR;
    trades.push({
      signal_time_utc: new Date(signal.time * 1000).toISOString(),
      entry_time_utc: new Date(entryBar.time * 1000).toISOString(),
      exit_time_utc: new Date(exitTime * 1000).toISOString(),
      side, entry, stop_loss: stop, take_profit: target,
      planned_risk_price: plannedRisk, effective_rr: effectiveRR,
      net_r: netR, net_pnl: netPnl, exit_reason: exitReason,
      holding_minutes: (exitTime - entryBar.time) / 60,
      atr_m15: atrNow, body_atr: bodyAtr, close_location: closeLocation,
      entry_gap_atr: entryGapAtr, risk_cash: riskCash,
      window_days: window.days, window_start_utc: new Date(windowStart * 1000).toISOString()
    });
    equity += netPnl;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peakEquity > 0 ? (peakEquity - equity) / peakEquity * 100 : 0);
    if (equity <= dayStartEquity * 0.98) dailyLocked = true;
    tradesToday++;
    nextAvailable = exitIndex + 1;
  }

  const wins = trades.filter(t => t.net_pnl > 0);
  const losses = trades.filter(t => t.net_pnl < 0);
  const grossProfit = sum(wins.map(t => t.net_pnl));
  const grossLoss = -sum(losses.map(t => t.net_pnl));
  const totalR = sum(trades.map(t => t.net_r));
  const totalPnl = sum(trades.map(t => t.net_pnl));
  const coverage = sessionCoverage(m15, windowStart, latest);
  const summary = {
    initial_equity: INITIAL_EQUITY,
    final_equity: INITIAL_EQUITY + totalPnl,
    net_profit: totalPnl,
    return_pct: totalPnl / INITIAL_EQUITY * 100,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: trades.length ? wins.length / trades.length * 100 : null,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
    expectancy_R: trades.length ? totalR / trades.length : null,
    total_R: totalR,
    max_drawdown_pct: maxDrawdownPct,
    avg_holding_minutes: trades.length ? sum(trades.map(t => t.holding_minutes)) / trades.length : null,
    trades_per_week: trades.length / (window.days / 7),
    full_window_result_valid: validWindow && censoredTrades === 0 && dataRangeValid && coverage.coverage_pct >= MIN_SESSION_COVERAGE_PCT && coverage.max_consecutive_incomplete_weekdays <= 2,
    data_range_valid: dataRangeValid,
    session_coverage: coverage,
    censored_trades: censoredTrades,
    censor_detail: censorDetail,
    by_side: {}
  };
  for (const side of ['BUY', 'SELL']) {
    const subset = trades.filter(t => t.side === side);
    const sideWins = subset.filter(t => t.net_pnl > 0);
    const sideLosses = subset.filter(t => t.net_pnl < 0);
    const sideGain = sum(sideWins.map(t => t.net_pnl));
    const sideLoss = -sum(sideLosses.map(t => t.net_pnl));
    summary.by_side[side] = {
      trades: subset.length, wins: sideWins.length, losses: sideLosses.length,
      profit_factor: sideLoss > 0 ? sideGain / sideLoss : (sideGain > 0 ? null : 0),
      expectancy_R: subset.length ? sum(subset.map(t => t.net_r)) / subset.length : null
    };
  }
  const baseline = cost.name === 'baseline';
  const gate = {
    min_trades: window.minTrades,
    min_profit_factor: baseline ? 1.20 : 1.00,
    min_expectancy_R: baseline ? 0.10 : 0.00,
    max_drawdown_pct: 5,
    passed: Boolean(summary.full_window_result_valid && summary.trades >= window.minTrades &&
      summary.profit_factor !== null && summary.profit_factor >= (baseline ? 1.20 : 1.00) &&
      summary.expectancy_R !== null && summary.expectancy_R >= (baseline ? 0.10 : 0.00) &&
      summary.max_drawdown_pct <= 5)
  };
  return {
    window: window.id,
    window_days: window.days,
    window_start_utc: new Date(windowStart * 1000).toISOString(),
    window_end_utc: new Date(latest * 1000).toISOString(),
    cost_model: cost.name,
    costs: { spread_price: cost.spread, slippage_price: cost.slippage },
    summary,
    quality_gate: gate,
    rejection_counts: rejection,
    candidates,
    trades
  };
}

function selfTest() {
  const base = Math.floor(Date.UTC(2026, 9, 16, 13, 0, 0) / 1000);
  const synthetic = [];
  for (let i = 0; i < 120; i++) {
    const open = 2500 + i * 0.01;
    synthetic.push({ time: base + i * 60, open, high: open + 0.08, low: open - 0.04, close: open + 0.03, volume: 1 });
  }
  const m15 = aggregateActiveM1(synthetic, 900, { minCoverage: 0.70, edgeMinutes: 3, maxGapMinutes: 5 });
  const h1 = aggregateActiveM1(synthetic, 3600, { minCoverage: 0.75, edgeMinutes: 10, maxGapMinutes: 10 });
  assert(m15.bars.length === 8, 'M15 aggregation self-test failed: ' + m15.bars.length);
  assert(h1.bars.length === 2, 'H1 aggregation self-test failed: ' + h1.bars.length);
  assert(consecutive(m15.bars, 0, 7, 900), 'M15 continuity self-test failed');
  const session = nyInfo(Date.UTC(2026, 9, 16, 13, 45) / 1000);
  assert(inSession(session), 'America/New_York session/DST self-test failed: ' + JSON.stringify(session));
  assert(!inSession(nyInfo(Date.UTC(2026, 9, 16, 16, 30) / 1000)), 'Session end self-test failed');
  const coverage = sessionCoverage(m15.bars, base, base + 2 * 3600);
  assert(coverage.coverage_pct === 100, 'M15 session coverage self-test failed: ' + JSON.stringify(coverage));
  console.log(JSON.stringify({ self_test: 'PASS', m15_bars: m15.bars.length, h1_bars: h1.bars.length, timezone: 'America/New_York' }, null, 2));
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const m1 = await loadM1(DATA_FILE);
  const m15Result = aggregateActiveM1(m1, 900, { minCoverage: 0.70, edgeMinutes: 3, maxGapMinutes: 5 });
  const h1Result = aggregateActiveM1(m1, 3600, { minCoverage: 0.75, edgeMinutes: 10, maxGapMinutes: 10 });
  const m15 = m15Result.bars;
  const h1 = h1Result.bars;
  assert(m15.length >= 10000, 'Insufficient quality-filtered M15 bars: ' + m15.length);
  assert(h1.length >= 1000, 'Insufficient quality-filtered H1 bars: ' + h1.length);
  const features = computeFeatures(m15, h1);
  const latestActual = m15[m15.length - 1].time + 900;
  const windowEnd = getWindowEnd(latestActual);
  const expectedStart = windowEnd - Math.max(...WINDOWS.map(w => w.days)) * 86400;
  const dataRangeValid = m15[0].time <= expectedStart + 3 * 86400 && latestActual >= windowEnd - 3 * 86400;
  const costs = [BASELINE_COST, CONSERVATIVE_COST];
  const results = [];
  for (const cost of costs) {
    for (const window of WINDOWS) results.push(runWindow(m15, h1, features, window, cost, windowEnd, dataRangeValid));
  }
  const report = {
    status: 'RESEARCH_ONLY_GOLD_M15_TREND_PULLBACK',
    generated_at_utc: new Date().toISOString(),
    production_config_changed: false,
    render_deployment_performed: false,
    real_orders_enabled: false,
    data: {
      instrument: 'XAUUSD / GOLD',
      provider: 'Dukascopy Historical Data Feed',
      input_timeframe: 'M1 BID OHLC, inactive zero-volume flat placeholders removed',
      m1_bars: m1.length,
      first_m1_bar_utc: new Date(m1[0].time * 1000).toISOString(),
      last_m1_bar_utc: new Date(m1[m1.length - 1].time * 1000).toISOString(),
      expected_window_start_utc: new Date(expectedStart * 1000).toISOString(),
      configured_window_end_utc: new Date(windowEnd * 1000).toISOString(),
      data_range_valid: dataRangeValid,
      m15_bars_after_quality_filter: m15.length,
      h1_bars_after_quality_filter: h1.length,
      m15_quality: m15Result.diagnostics,
      h1_quality: h1Result.diagnostics,
      historical_xm_ask_spread_available: false
    },
    rules: RULES,
    metrics: results.map(x => ({
      window: x.window, window_days: x.window_days,
      window_start_utc: x.window_start_utc, window_end_utc: x.window_end_utc,
      cost_model: x.cost_model, costs: x.costs, summary: x.summary,
      quality_gate: x.quality_gate, rejection_counts: x.rejection_counts,
      candidates: x.candidates
    }))
  };
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_trend_pullback_summary.json'), JSON.stringify(report, null, 2));
  const tradeRows = results.flatMap(result => result.trades.map(trade => ({
    window: result.window, cost_model: result.cost_model, ...trade
  })));
  const fields = [
    'window','cost_model','signal_time_utc','entry_time_utc','exit_time_utc','side','entry',
    'stop_loss','take_profit','planned_risk_price','effective_rr','net_r','net_pnl',
    'exit_reason','holding_minutes','atr_m15','body_atr','close_location','entry_gap_atr','risk_cash'
  ];
  const csv = [fields.join(','), ...tradeRows.map(row => fields.map(key => {
    const value = row[key];
    const string = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(string) ? '"' + string.replaceAll('"', '""') + '"' : string;
  }).join(','))].join('\n') + '\n';
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_trend_pullback_trades.csv'), csv, 'utf8');

  const md = [
    '# GOLD M15 Trend Pullback Research (research only)', '',
    'No production settings changed, no Render deployment, and real orders remain OFF.', '',
    'Fixed hypothesis: closed-H1 trend filter plus M15 EMA20 pullback/reclaim; next-bar entry; swing-based stop; 1.8R target; 16 M15-bar time limit; New York morning only. No parameter sweep is performed.', '',
    '| Window | Cost | Spread | Slippage | Valid | Trades | Trades/week | PF | Expectancy (R) | Max DD % | Net PnL | Gate |',
    '|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---|'
  ];
  for (const row of report.metrics) {
    md.push('| ' + [
      row.window, row.cost_model, fmt(row.costs.spread_price, 2), fmt(row.costs.slippage_price, 2),
      String(row.summary.full_window_result_valid), String(row.summary.trades), fmt(row.summary.trades_per_week),
      fmt(row.summary.profit_factor), fmt(row.summary.expectancy_R), fmt(row.summary.max_drawdown_pct),
      fmt(row.summary.net_profit, 2), row.quality_gate.passed ? 'PASS' : 'FAIL'
    ].join(' | ') + ' |');
  }
  md.push('', '## Data and interpretation limits', '',
    '- Source is Dukascopy BID M1 OHLC, not historical XM Ask/tick data. Costs are modeled using recent observed XM spread reference values and a conservative alternative.',
    '- M15/H1 bars are derived only from active M1 bars and are rejected when active coverage, edge coverage, or gap quality is insufficient.',
    '- If an open trade crosses an invalid/missing M15 interval, the window is censored and marked invalid rather than inventing an exit. A censored window cannot pass the quality gate.',
    '- Separate 5-year and recent-730-day equity/trade-state runs share the same underlying history; the 730-day slice is not an untouched holdout for future tuning.',
    '- The metrics are research outputs only. Passing this initial gate would still require an untouched holdout and XM forward/paper execution before any consideration of live orders.', '');
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_trend_pullback_summary.md'), md.join('\n'));
  console.log(md.join('\n'));
}
await main();
