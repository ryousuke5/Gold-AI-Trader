import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const DATA_FILE = process.env.GOLD_M15_BREAKOUT_RETEST_DATA_FILE || '';
const INPUT_TIMEFRAME = (process.env.GOLD_M15_BREAKOUT_RETEST_DATA_TIMEFRAME || (DATA_FILE.toLowerCase().includes('m1') ? 'm1' : 'm5')).toLowerCase();
const OUTPUT_DIR = path.resolve(process.env.GOLD_M15_BREAKOUT_RETEST_OUTPUT_DIR || 'gold-m15-breakout-retest-output');
const INITIAL_EQUITY = Math.max(1000, Number(process.env.GOLD_BREAKOUT_RETEST_INITIAL_EQUITY || 100000));
const RISK_PCT = Math.max(0.01, Number(process.env.GOLD_BREAKOUT_RETEST_RISK_PCT || 0.25));
const BASELINE_COST = { name: 'baseline', spread: 0.58, slippage: 0.10 };
const CONSERVATIVE_COST = { name: 'conservative', spread: 0.75, slippage: 0.10 };
const MIN_SESSION_COVERAGE_PCT = 95;
const WINDOWS = [
  { id: 'five_year', days: 1825, minTrades: 150 },
  { id: 'recent_730d', days: 730, minTrades: 50 }
];

const RULES = {
  hypothesis: 'H1 trend-filtered M15 range breakout followed by a controlled retest/reclaim; research-only fixed hypothesis',
  trend: 'BUY when a closed H1 bar has close > EMA50, EMA20 > EMA50, and EMA20 risen versus 3 valid consecutive H1 bars; SELL is inverse. Trend must agree at breakout and retest.',
  breakout: 'Break prior 8 completed contiguous M15 bars by at least 0.10 ATR; breakout candle direction agrees with H1 trend, body >=0.35 ATR and close location >=0.65 for BUY or <=0.35 for SELL.',
  retest: 'Within 1-3 subsequent contiguous M15 bars, price revisits the breakout level within +0.15/-0.30 breakout ATR, closes back beyond the level by at least 0.05 ATR, and closes in breakout direction; invalid if an interim close has broken back through the level.',
  entry: 'Next M15 bar open; only during Monday-Friday 09:35-12:15 America/New_York; skip if entry gap >0.35 retest ATR.',
  stop: 'Beyond the observed swing from breakout through retest plus 0.10 ATR; skip if planned risk is outside 0.60-2.00 ATR.',
  target_R: 2.0,
  max_hold_M15_bars: 12,
  session: 'Monday-Friday 09:35-12:15 America/New_York, using the IANA time zone for daylight-saving time',
  max_trades_per_NY_day: 2,
  max_daily_loss_pct: 2,
  risk_per_trade_pct: RISK_PCT,
  cost_model: 'Dukascopy BID OHLC; modeled entry/exit spread and slippage; not historical XM Ask ticks',
  allowed_input_timeframes: ['M1 BID OHLC', 'M5 BID OHLC'],
  aggregation_quality: 'M1 input uses active-minute coverage and gap checks; M5 input requires complete contiguous M5 bars inside each M15/H1 bucket',
  same_bar_stop_and_target: 'STOP first (conservative)',
  data_gap_policy: 'If the next observed M15 bar starts after a gap while a position is open, exit at the first observed post-gap M15 open with modeled adverse spread/slippage, mark GAP_OPEN_EXIT, and do not assume an intragap stop/target fill.',
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

async function loadSourceBars() {
  let parsed;
  if (DATA_FILE) {
    const bytes = await fs.readFile(DATA_FILE);
    const raw = DATA_FILE.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8');
    parsed = JSON.parse(raw);
    assert(Array.isArray(parsed), 'Input data must be a JSON array');
  } else {
    assert(INPUT_TIMEFRAME === 'm5', 'Direct historical fetch supports M5 input only');
    const rawEnd = process.env.GOLD_RESEARCH_END_UTC || '2026-10-05T00:00:00Z';
    const end = new Date(rawEnd);
    assert(Number.isFinite(end.getTime()), 'Invalid GOLD_RESEARCH_END_UTC: ' + rawEnd);
    const start = new Date(end.getTime() - 1825 * 86400000);
    const mod = await import('dukascopy-node');
    const getHistoricalRates = mod.getHistoricalRates || mod.default?.getHistoricalRates;
    assert(typeof getHistoricalRates === 'function', 'dukascopy-node getHistoricalRates export not found');
    parsed = await getHistoricalRates({
      instrument: 'xauusd',
      dates: { from: start, to: end },
      timeframe: 'm5',
      priceType: 'bid',
      volumes: true,
      format: 'array'
    });
  }
  const sourceSeconds = INPUT_TIMEFRAME === 'm1' ? 60 : 300;
  const rows = [];
  for (const row of parsed) {
    const tuple = Array.isArray(row);
    const bar = {
      time: Math.floor(Number(tuple ? Number(row[0]) / 1000 : row.time)),
      open: Number(tuple ? row[1] : row.open),
      high: Number(tuple ? row[2] : row.high),
      low: Number(tuple ? row[3] : row.low),
      close: Number(tuple ? row[4] : row.close),
      volume: Number((tuple ? row[5] : row.volume) || 0)
    };
    if (![bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)) continue;
    if (bar.open <= 0 || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low <= 0) continue;
    if (bar.time % sourceSeconds !== 0) continue;
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
  const minBars = INPUT_TIMEFRAME === 'm1' ? 500000 : 200000;
  assert(unique.length >= minBars, 'Insufficient valid ' + INPUT_TIMEFRAME.toUpperCase() + ' history: ' + unique.length);
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


function aggregateSourceBars(source, sourceSeconds, targetSeconds) {
  const grouped = new Map();
  for (const bar of source) {
    const bucket = Math.floor(bar.time / targetSeconds) * targetSeconds;
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket).push(bar);
  }
  const expectedBars = targetSeconds / sourceSeconds;
  const result = [];
  let rejectedCoverage = 0;
  let rejectedGap = 0;
  for (const [time, rows] of grouped) {
    rows.sort((a, b) => a.time - b.time);
    if (rows.length !== expectedBars || rows[0].time !== time ||
        rows[rows.length - 1].time !== time + targetSeconds - sourceSeconds) {
      rejectedCoverage++;
      continue;
    }
    let valid = true;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].time - rows[i - 1].time !== sourceSeconds) {
        valid = false;
        break;
      }
    }
    if (!valid) {
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
      source_bars: rows.length,
      coverage_pct: 100
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
function inSession(value) {
  // Call sites may provide an epoch timestamp or already-resolved New York parts.
  const info = typeof value === 'number' ? nyInfo(value) : value;
  if (!info || info.weekday === 'Sat' || info.weekday === 'Sun') return false;
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
function gapOpenExitPrice(side, reopeningOpen, cost) {
  assert((side === 'BUY' || side === 'SELL') && Number.isFinite(reopeningOpen), 'Invalid gap-open exit inputs');
  return side === 'BUY' ? reopeningOpen - cost.slippage : reopeningOpen + cost.spread + cost.slippage;
}

function closedH1Index(h1, features, closeTime) {
  let lo = 0, hi = h1.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h1[mid].time + 3600 <= closeTime) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 50 || closeTime - (h1[best].time + 3600) > 3600 ||
      !consecutive(h1, best - 3, best, 3600)) return { index: -1, up: false, down: false };
  const up = h1[best].close > features.h1Ema50[best] &&
    features.h1Ema20[best] > features.h1Ema50[best] &&
    features.h1Ema20[best] > features.h1Ema20[best - 3];
  const down = h1[best].close < features.h1Ema50[best] &&
    features.h1Ema20[best] < features.h1Ema50[best] &&
    features.h1Ema20[best] < features.h1Ema20[best - 3];
  return { index: best, up, down };
}
function detectBreakout(m15, h1, features, k) {
  if (k < 8 || !consecutive(m15, k - 8, k, 900)) return null;
  const atrK = features.m15Atr14[k];
  if (!Number.isFinite(atrK) || !(atrK > 0)) return null;
  const trend = closedH1Index(h1, features, m15[k].time + 900);
  if (trend.index < 0 || (!trend.up && !trend.down) ||
      !Number.isFinite(features.h1Ema20[trend.index]) ||
      !Number.isFinite(features.h1Ema50[trend.index])) return null;
  const prior = m15.slice(k - 8, k);
  const rangeHigh = Math.max(...prior.map(b => b.high));
  const rangeLow = Math.min(...prior.map(b => b.low));
  const bar = m15[k];
  const span = bar.high - bar.low;
  const closeLoc = span > 0 ? (bar.close - bar.low) / span : 0.5;
  const bodyAtr = Math.abs(bar.close - bar.open) / atrK;
  if (bodyAtr < 0.35 || !inSession(bar.time)) return null;
  if (trend.up && bar.close > bar.open && bar.close >= rangeHigh + 0.10 * atrK && closeLoc >= 0.65) {
    return { side: 'BUY', breakoutIndex: k, level: rangeHigh, atr: atrK };
  }
  if (trend.down && bar.close < bar.open && bar.close <= rangeLow - 0.10 * atrK && closeLoc <= 0.35) {
    return { side: 'SELL', breakoutIndex: k, level: rangeLow, atr: atrK };
  }
  return null;
}

function fmt(value, decimals = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : Number(value).toFixed(decimals);
}

function runWindow(m15, h1, features, window, cost, latest, dataRangeValid) {
  const windowStart = latest - window.days * 86400;
  let equity = INITIAL_EQUITY, peakEquity = INITIAL_EQUITY, maxDrawdownPct = 0;
  let nyDay = '', dayStartEquity = INITIAL_EQUITY, tradesToday = 0, dailyLocked = false;
  let candidates = 0, censoredTrades = 0, validWindow = true, nextAvailable = 0;
  const trades = [], rejection = {};
  const reject = key => { rejection[key] = (rejection[key] || 0) + 1; };

  for (let i = 60; i < m15.length - 12; i++) {
    const signal = m15[i];
    if (signal.time + 900 < windowStart || i < nextAvailable) continue;
    if (!consecutive(m15, i - 8, i, 900)) { reject('noncontiguous_retest_bars'); continue; }
    const entryBar = m15[i + 1];
    if (!entryBar || entryBar.time !== signal.time + 900) { reject('next_m15_bar_gap'); continue; }
    const entryLocal = nyInfo(entryBar.time);
    if (!inSession(signal.time) || !inSession(entryBar.time)) continue;
    if (entryLocal.date !== nyDay) {
      nyDay = entryLocal.date;
      dayStartEquity = equity;
      tradesToday = 0;
      dailyLocked = false;
    }
    if (dailyLocked) { reject('daily_loss_lock'); continue; }
    if (tradesToday >= 2) { reject('max_trades_per_day'); continue; }

    const atrNow = features.m15Atr14[i];
    if (!Number.isFinite(atrNow) || !(atrNow > 0) ||
        !Number.isFinite(features.m15Ema20[i])) { reject('m15_indicator_unavailable'); continue; }
    const currentTrend = closedH1Index(h1, features, signal.time + 900);
    if (currentTrend.index < 0) { reject('h1_indicator_unavailable'); continue; }
    candidates++;

    // Search at most three preceding M15 bars. Keep the newest valid breakout
    // that remains intact through the retest; no future bars are consulted.
    let setup = null;
    for (let k = Math.max(8, i - 3); k < i; k++) {
      const breakout = detectBreakout(m15, h1, features, k);
      if (!breakout || i - k < 1 || i - k > 3) continue;
      if ((breakout.side === 'BUY' && !currentTrend.up) ||
          (breakout.side === 'SELL' && !currentTrend.down)) continue;
      if (!consecutive(m15, k, i, 900)) continue;

      let invalidated = false;
      for (let t = k + 1; t < i; t++) {
        if (breakout.side === 'BUY' && m15[t].close < breakout.level - 0.25 * breakout.atr) invalidated = true;
        if (breakout.side === 'SELL' && m15[t].close > breakout.level + 0.25 * breakout.atr) invalidated = true;
      }
      if (invalidated) continue;
      const retest = m15[i];
      const span = retest.high - retest.low;
      const closeLoc = span > 0 ? (retest.close - retest.low) / span : 0.5;
      if (breakout.side === 'BUY') {
        const retestTouch = retest.low <= breakout.level + 0.15 * breakout.atr &&
          retest.low >= breakout.level - 0.30 * breakout.atr;
        const reclaim = retest.close >= breakout.level + 0.05 * breakout.atr;
        if (!retestTouch || !reclaim || retest.close <= retest.open || closeLoc < 0.55) continue;
      } else {
        const retestTouch = retest.high >= breakout.level - 0.15 * breakout.atr &&
          retest.high <= breakout.level + 0.30 * breakout.atr;
        const reclaim = retest.close <= breakout.level - 0.05 * breakout.atr;
        if (!retestTouch || !reclaim || retest.close >= retest.open || closeLoc > 0.45) continue;
      }
      setup = { ...breakout, retest_age: i - k };
    }
    if (!setup) { reject('breakout_retest_filter'); continue; }

    const side = setup.side;
    const entryGapAtr = Math.abs(entryBar.open - signal.close) / atrNow;
    if (entryGapAtr > 0.35) { reject('entry_gap_filter'); continue; }

    const swing = m15.slice(setup.breakoutIndex, i + 1);
    const stop = side === 'BUY'
      ? Math.min(...swing.map(x => x.low)) - 0.10 * atrNow
      : Math.max(...swing.map(x => x.high)) + 0.10 * atrNow;
    const plannedRisk = side === 'BUY' ? signal.close - stop : stop - signal.close;
    if (!(plannedRisk >= 0.60 * atrNow && plannedRisk <= 2.00 * atrNow)) {
      reject('stop_distance_atr_filter');
      continue;
    }
    const target = side === 'BUY'
      ? signal.close + 2.00 * plannedRisk
      : signal.close - 2.00 * plannedRisk;
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
    const lastPossible = Math.min(i + 12, m15.length - 1);
    for (let j = i + 1; j <= lastPossible; j++) {
      if (j > i + 1 && m15[j].time - m15[j - 1].time !== 900) {
        const reopened = m15[j];
        exitTime = reopened.time;
        exitIndex = j;
        exitReason = 'GAP_OPEN_EXIT';
        exitPrice = gapOpenExitPrice(side, reopened.open, cost);
        break;
      }
      const bar = m15[j];
      const stopHit = side === 'BUY' ? bar.low <= stop : bar.high + cost.spread >= stop;
      const targetHit = side === 'BUY' ? bar.high >= target : bar.low + cost.spread <= target;
      if (stopHit) {
        exitTime = bar.time; exitIndex = j; exitReason = 'STOP';
        exitPrice = side === 'BUY' ? stop - cost.slippage : stop + cost.spread + cost.slippage;
        break;
      }
      if (targetHit) {
        exitTime = bar.time; exitIndex = j; exitReason = 'TARGET';
        exitPrice = side === 'BUY' ? target - cost.slippage : target + cost.spread + cost.slippage;
        break;
      }
    }
    if (exitTime === null) {
      if (lastPossible < i + 12) {
        censoredTrades++; validWindow = false;
        break; // Insufficient future OHLC to price a full max-hold path.
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
      breakout_time_utc: new Date(m15[setup.breakoutIndex].time * 1000).toISOString(),
      entry_time_utc: new Date(entryBar.time * 1000).toISOString(),
      exit_time_utc: new Date(exitTime * 1000).toISOString(),
      breakout_level: setup.level, retest_age_bars: setup.retest_age,
      side, entry, stop_loss: stop, take_profit: target,
      planned_risk_price: plannedRisk, effective_rr: effectiveRR,
      net_r: netR, net_pnl: netPnl, exit_reason: exitReason,
      holding_minutes: (exitTime - entryBar.time) / 60,
      atr_m15: atrNow, breakout_atr: setup.atr, entry_gap_atr: entryGapAtr,
      risk_cash: riskCash, window_days: window.days
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
    trades: trades.length, wins: wins.length, losses: losses.length,
    win_rate_pct: trades.length ? wins.length / trades.length * 100 : null,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
    expectancy_R: trades.length ? totalR / trades.length : null,
    total_R: totalR,
    max_drawdown_pct: maxDrawdownPct,
    avg_holding_minutes: trades.length ? sum(trades.map(t => t.holding_minutes)) / trades.length : null,
    trades_per_week: trades.length / (window.days / 7),
    full_window_result_valid: validWindow && censoredTrades === 0 && dataRangeValid &&
      coverage.coverage_pct >= MIN_SESSION_COVERAGE_PCT &&
      coverage.max_consecutive_incomplete_weekdays <= 2,
    data_range_valid: dataRangeValid,
    session_coverage: coverage,
    censored_trades: censoredTrades,
    gap_open_exit_trades: trades.filter(t => t.exit_reason === 'GAP_OPEN_EXIT').length,
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
    window: window.id, window_days: window.days,
    window_start_utc: new Date(windowStart * 1000).toISOString(),
    window_end_utc: new Date(latest * 1000).toISOString(),
    cost_model: cost.name, costs: { spread_price: cost.spread, slippage_price: cost.slippage },
    summary, quality_gate: gate, rejection_counts: rejection, candidates, trades
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
  const syntheticM5 = [];
  for (let i = 0; i < synthetic.length; i += 5) {
    const group = synthetic.slice(i, i + 5);
    syntheticM5.push({ time: group[0].time, open: group[0].open, high: Math.max(...group.map(x => x.high)), low: Math.min(...group.map(x => x.low)), close: group[group.length - 1].close, volume: sum(group.map(x => x.volume)) });
  }
  const m15FromM5 = aggregateSourceBars(syntheticM5, 300, 900);
  const h1FromM5 = aggregateSourceBars(syntheticM5, 300, 3600);
  assert(m15FromM5.bars.length === 8, 'M5-to-M15 aggregation self-test failed: ' + m15FromM5.bars.length);
  assert(h1FromM5.bars.length === 2, 'M5-to-H1 aggregation self-test failed: ' + h1FromM5.bars.length);
  assert(m15.bars.length === 8, 'M15 aggregation self-test failed: ' + m15.bars.length);
  assert(h1.bars.length === 2, 'H1 aggregation self-test failed: ' + h1.bars.length);
  assert(consecutive(m15.bars, 0, 7, 900), 'M15 continuity self-test failed');
  const sessionTimestamp = Date.UTC(2026, 9, 16, 13, 45) / 1000;
  const session = nyInfo(sessionTimestamp);
  assert(inSession(session), 'America/New_York session/DST self-test failed: ' + JSON.stringify(session));
  assert(inSession(sessionTimestamp), 'Timestamp-based New York session check failed');
  const afterSessionTimestamp = Date.UTC(2026, 9, 16, 16, 30) / 1000;
  assert(!inSession(nyInfo(afterSessionTimestamp)), 'Session end object check failed');
  assert(!inSession(afterSessionTimestamp), 'Session end timestamp check failed');
  assert(Math.abs(gapOpenExitPrice('BUY', 2500, { spread: 0.75, slippage: 0.10 }) - 2499.90) < 1e-9, 'BUY gap-open exit cost test failed');
  assert(Math.abs(gapOpenExitPrice('SELL', 2500, { spread: 0.75, slippage: 0.10 }) - 2500.85) < 1e-9, 'SELL gap-open exit cost test failed');
  const coverage = sessionCoverage(m15.bars, base, base + 2 * 3600);
  assert(coverage.coverage_pct === 100, 'M15 session coverage self-test failed: ' + JSON.stringify(coverage));
  console.log(JSON.stringify({ self_test: 'PASS', m15_bars: m15.bars.length, h1_bars: h1.bars.length, timezone: 'America/New_York' }, null, 2));
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const sourceBars = await loadSourceBars();
  const sourceSeconds = INPUT_TIMEFRAME === 'm1' ? 60 : 300;
  const m15Result = INPUT_TIMEFRAME === 'm1'
    ? aggregateActiveM1(sourceBars, 900, { minCoverage: 0.70, edgeMinutes: 3, maxGapMinutes: 5 })
    : aggregateSourceBars(sourceBars, sourceSeconds, 900);
  const h1Result = INPUT_TIMEFRAME === 'm1'
    ? aggregateActiveM1(sourceBars, 3600, { minCoverage: 0.75, edgeMinutes: 10, maxGapMinutes: 10 })
    : aggregateSourceBars(sourceBars, sourceSeconds, 3600);
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
    status: 'RESEARCH_ONLY_GOLD_M15_BREAKOUT_RETEST',
    generated_at_utc: new Date().toISOString(),
    production_config_changed: false,
    render_deployment_performed: false,
    real_orders_enabled: false,
    data: {
      instrument: 'XAUUSD / GOLD',
      provider: 'Dukascopy Historical Data Feed',
      input_timeframe: INPUT_TIMEFRAME.toUpperCase() + ' BID OHLC',
      source_bars: sourceBars.length,
      first_source_bar_utc: new Date(sourceBars[0].time * 1000).toISOString(),
      last_source_bar_utc: new Date(sourceBars[sourceBars.length - 1].time * 1000).toISOString(),
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
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_breakout_retest_summary.json'), JSON.stringify(report, null, 2));
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
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_breakout_retest_trades.csv'), csv, 'utf8');

  const md = [
    '# GOLD M15 Breakout-Retest Research (research only)', '',
    'No production settings changed, no Render deployment, and real orders remain OFF.', '',
    'Fixed hypothesis: closed-H1 trend filter, 8-bar M15 range breakout, retest and reclaim within 3 bars, next-bar entry; swing stop; 2R target; 12-M15-bar time limit; New York morning only. No parameter sweep is performed.', '',
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
    '- Source is Dukascopy BID OHLC (direct M5 history in the standalone workflow), not historical XM Ask/tick data. Costs are modeled using recent observed XM spread reference values and a conservative alternative.',
    '- M15/H1 bars are derived from contiguous source bars; the M1 path applies active-minute coverage and gap checks, while the direct M5 path rejects incomplete M15/H1 buckets.',
    '- If an open trade encounters a gap in observed M15 bars, it is exited at the first observable post-gap M15 open with modeled adverse spread/slippage and marked GAP_OPEN_EXIT. No intragap OHLC is fabricated, and no stop/target fill is assumed during the gap. This remains an approximation, not confirmation of XM fills.',
    '- Separate 5-year and recent-730-day equity/trade-state runs share the same underlying history; the 730-day slice is not an untouched holdout for future tuning.',
    '- The metrics are research outputs only. Passing this initial gate would still require an untouched holdout and XM forward/paper execution before any consideration of live orders.', '');
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m15_breakout_retest_summary.md'), md.join('\n'));
  console.log(md.join('\n'));
}
await main();
