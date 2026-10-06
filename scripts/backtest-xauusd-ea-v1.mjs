import fs from 'node:fs/promises';
import path from 'node:path';

const CFG = {
  days: Number(process.env.XAU_BACKTEST_DAYS || 1825),
  timezone: process.env.XAU_BACKTEST_TIMEZONE || 'Europe/Nicosia',
  spreadPrice: Number(process.env.XAU_BACKTEST_SPREAD_PRICE || 0.55),
  slippagePrice: Number(process.env.XAU_BACKTEST_SLIPPAGE_PRICE || 0.10),
  maxHoldBars: Number(process.env.XAU_BACKTEST_MAX_HOLD_BARS || 96),
  cooldownBars: Number(process.env.XAU_BACKTEST_COOLDOWN_BARS || 2),
  out: process.env.XAU_BACKTEST_OUTPUT_DIR || 'xauusd-backtest-output',
  rangeLookback: Number(process.env.XAU_RANGE_LOOKBACK || 12),
  minRangeAtr: Number(process.env.XAU_MIN_RANGE_ATR || 0.80),
  maxRangeAtr: Number(process.env.XAU_MAX_RANGE_ATR || 2.80),
  breakoutAtr: Number(process.env.XAU_BREAKOUT_ATR || 0.10),
  minBodyAtr: Number(process.env.XAU_MIN_BODY_ATR || 0.40),
  minCloseLocation: Number(process.env.XAU_MIN_CLOSE_LOCATION || 0.65),
  minVolumeRatio: Number(process.env.XAU_MIN_VOLUME_RATIO || 1.10),
  buyRsiMin: Number(process.env.XAU_BUY_RSI_MIN || 52),
  buyRsiMax: Number(process.env.XAU_BUY_RSI_MAX || 75),
  sellRsiMin: Number(process.env.XAU_SELL_RSI_MIN || 25),
  sellRsiMax: Number(process.env.XAU_SELL_RSI_MAX || 48),
  maxExtensionAtr: Number(process.env.XAU_MAX_EXTENSION_ATR || 1.50),
  stopBufferAtr: Number(process.env.XAU_STOP_BUFFER_ATR || 0.15),
  triggerStopPadAtr: Number(process.env.XAU_TRIGGER_STOP_PAD_ATR || 0.05),
  minStopAtr: Number(process.env.XAU_MIN_STOP_ATR || 0.80),
  maxStopAtr: Number(process.env.XAU_MAX_STOP_ATR || 2.00),
  tpR: Number(process.env.XAU_TAKE_PROFIT_R || 2.00),
  maxEntryDistanceAtr: Number(process.env.XAU_MAX_ENTRY_DISTANCE_ATR || 0.20),
  sessionStartHour: Number(process.env.XAU_SESSION_START_HOUR || 17),
  sessionEndHour: Number(process.env.XAU_SESSION_END_HOUR || 20)
};

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    prev = prev === null ? values[i] : alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
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
    : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)));
  let value = tr.slice(1, period + 1).reduce((s, x) => s + x, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i++) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function indicators(bars) {
  const closes = bars.map(b => b.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r14 = rsi(closes, 14);
  const a14 = atr(bars, 14);
  return bars.map((b, i) => ({ ...b, ema20: e20[i], ema50: e50[i], ema200: e200[i], rsi14: r14[i], atr14: a14[i] }));
}

function localParts(ts, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ts * 1000));
  const out = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

function inSession(ts) {
  const h = localParts(ts, CFG.timezone).hour;
  if (CFG.sessionStartHour === CFG.sessionEndHour) return true;
  if (CFG.sessionStartHour < CFG.sessionEndHour) return h >= CFG.sessionStartHour && h <= CFG.sessionEndHour;
  return h >= CFG.sessionStartHour || h <= CFG.sessionEndHour;
}

function hourStart(ts, timezone) {
  const p = localParts(ts, timezone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = Math.round((localAsUtc - ts * 1000) / 1000);
  const localHourAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour);
  return Math.floor((localHourAsUtc - offset * 1000) / 1000);
}

function aggregateH1(m5, timezone) {
  const map = new Map();
  for (const b of m5) {
    const h = hourStart(b.time, timezone);
    const x = map.get(h);
    if (!x) map.set(h, { time: h, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    else {
      x.high = Math.max(x.high, b.high);
      x.low = Math.min(x.low, b.low);
      x.close = b.close;
      x.volume += b.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function latestCompletedH1(h1, signalClose) {
  let lo = 0; let hi = h1.length - 1; let answer = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (h1[mid].time + 3600 <= signalClose) { answer = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return answer;
}

async function fetchBars() {
  const mod = await import('dukascopy-node');
  const get = mod.getHistoricalRates || mod.default?.getHistoricalRates;
  if (typeof get !== 'function') throw new Error('dukascopy-node getHistoricalRates export missing');
  const end = new Date();
  const start = new Date(end.getTime() - CFG.days * 86400000);
  const rows = await get({
    instrument: 'xauusd',
    dates: { from: start, to: end },
    timeframe: 'm5',
    priceType: 'bid',
    volumes: true,
    format: 'array'
  });
  if (!Array.isArray(rows) || rows.length < 100000)
    throw new Error('Insufficient XAUUSD M5 coverage: ' + (rows?.length || 0));
  const now = Date.now();
  return rows.map(r => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) || 0
  })).filter(b =>
    Number.isFinite(b.time) && b.open > 0 &&
    b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close &&
    (b.time + 300) * 1000 <= now
  ).sort((a, b) => a.time - b.time);
}

function stats(trades) {
  const wins = trades.filter(t => t.result_r > 0);
  const losses = trades.filter(t => t.result_r < 0);
  const net = trades.reduce((s, t) => s + t.result_r, 0);
  const grossWin = wins.reduce((s, t) => s + t.result_r, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.result_r, 0));
  let equity = 0, peak = 0, maxDd = 0;
  for (const t of trades) {
    equity += t.result_r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const first = trades[0] ? Date.parse(trades[0].signal_time) : NaN;
  const last = trades.at(-1) ? Date.parse(trades.at(-1).signal_time) : NaN;
  const weeks = Number.isFinite(first) && Number.isFinite(last) ? Math.max(1, (last - first) / 604800000) : 0;
  return {
    trades: trades.length, wins: wins.length, losses: losses.length,
    win_rate_pct: trades.length ? wins.length / trades.length * 100 : 0,
    net_r: net, profit_factor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy_r: trades.length ? net / trades.length : 0,
    max_drawdown_r: maxDd, trades_per_week: weeks ? trades.length / weeks : 0
  };
}

function buildSignal(m, i, h1, h1i) {
  if (!inSession(m[i].time + 300)) return null;
  const atrM5 = m[i].atr14;
  const h = h1[h1i];
  if (!(atrM5 > 0 && h?.atr14 > 0)) return null;

  const trendUp = h.close > h.ema20 && h.ema20 > h.ema50 && h.ema50 > h.ema200 &&
                  h.rsi14 >= CFG.buyRsiMin && h.rsi14 <= CFG.buyRsiMax;
  const trendDown = h.close < h.ema20 && h.ema20 < h.ema50 && h.ema50 < h.ema200 &&
                    h.rsi14 >= CFG.sellRsiMin && h.rsi14 <= CFG.sellRsiMax;
  if (!trendUp && !trendDown) return null;

  const rangeBars = m.slice(i - CFG.rangeLookback, i);
  if (rangeBars.length !== CFG.rangeLookback) return null;
  const rangeHigh = Math.max(...rangeBars.map(b => b.high));
  const rangeLow = Math.min(...rangeBars.map(b => b.low));
  const rangeAtr = (rangeHigh - rangeLow) / atrM5;
  if (!(rangeAtr >= CFG.minRangeAtr && rangeAtr <= CFG.maxRangeAtr)) return null;

  const signal = m[i];
  const range = signal.high - signal.low;
  const body = Math.abs(signal.close - signal.open);
  if (!(range > 0 && body / atrM5 >= CFG.minBodyAtr)) return null;

  const closeLocation = (signal.close - signal.low) / range;
  const avgVolume = rangeBars.reduce((s, b) => s + Math.max(0, b.volume), 0) / rangeBars.length;
  const volumeRatio = avgVolume > 0 ? signal.volume / avgVolume : 0;
  if (avgVolume > 0 && volumeRatio < CFG.minVolumeRatio) return null;

  const m5Ema20 = signal.ema20, m5Ema50 = signal.ema50, m5Rsi = signal.rsi14;
  const buy = trendUp && m5Ema20 > m5Ema50 && m5Rsi >= CFG.buyRsiMin && m5Rsi <= CFG.buyRsiMax &&
              signal.close >= rangeHigh + CFG.breakoutAtr * atrM5 &&
              closeLocation >= CFG.minCloseLocation &&
              signal.close >= m5Ema20 &&
              ((signal.close - m5Ema20) / atrM5) <= CFG.maxExtensionAtr;
  const sell = trendDown && m5Ema20 < m5Ema50 && m5Rsi >= CFG.sellRsiMin && m5Rsi <= CFG.sellRsiMax &&
               signal.close <= rangeLow - CFG.breakoutAtr * atrM5 &&
               closeLocation <= (1 - CFG.minCloseLocation) &&
               signal.close <= m5Ema20 &&
               ((m5Ema20 - signal.close) / atrM5) <= CFG.maxExtensionAtr;
  if (!buy && !sell) return null;

  const next = m[i + 1];
  if (!next) return null;
  const entry = buy ? next.open + CFG.spreadPrice + CFG.slippagePrice : next.open - CFG.slippagePrice;
  const stop = buy
    ? Math.min(rangeLow - CFG.stopBufferAtr * atrM5, signal.low - CFG.triggerStopPadAtr * atrM5)
    : Math.max(rangeHigh + CFG.stopBufferAtr * atrM5, signal.high + CFG.triggerStopPadAtr * atrM5);
  const stopDistance = Math.abs(entry - stop);
  const stopAtr = stopDistance / atrM5;
  if (stopAtr < CFG.minStopAtr || stopAtr > CFG.maxStopAtr) return null;

  const target = buy ? entry + CFG.tpR * stopDistance : entry - CFG.tpR * stopDistance;

  const drift = Math.abs((buy ? next.open : next.open) - signal.close);
  if (drift > CFG.maxEntryDistanceAtr * atrM5) return null;

  return { direction: buy ? 'BUY' : 'SELL', entry, stop, target, signalIndex: i };
}

function simulate(m, i, setup) {
  const spread = CFG.spreadPrice, slip = CFG.slippagePrice;
  const dir = setup.direction, risk = Math.abs(setup.entry - setup.stop);
  if (!(risk > 0)) return null;
  const end = Math.min(m.length - 1, i + CFG.maxHoldBars);
  for (let j = i + 1; j <= end; j++) {
    const b = m[j];
    const exitHigh = dir === 'BUY' ? b.high : b.high + spread;
    const exitLow = dir === 'BUY' ? b.low : b.low + spread;
    const hitStop = dir === 'BUY' ? exitLow <= setup.stop : exitHigh >= setup.stop;
    const hitTarget = dir === 'BUY' ? exitHigh >= setup.target : exitLow <= setup.target;
    if (hitStop && hitTarget) {
      return { result_r: -1 - slip / risk, exit_reason: 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE', exitIndex: j };
    }
    if (hitStop) {
      return { result_r: -1 - slip / risk, exit_reason: 'STOP', exitIndex: j };
    }
    if (hitTarget) {
      return { result_r: CFG.tpR - slip / risk, exit_reason: 'TARGET', exitIndex: j };
    }
  }
  const b = m[end];
  const exit = dir === 'BUY' ? b.close : b.close + spread;
  const rr = dir === 'BUY' ? (exit - slip - setup.entry) / risk : (setup.entry - (exit + slip)) / risk;
  return { result_r: rr, exit_reason: 'TIME', exitIndex: end };
}

function breakdown(trades) {
  const byYear = {}, byDirection = {}, byExit = {};
  for (const t of trades) {
    const y = new Date(t.signal_time).getUTCFullYear();
    (byYear[y] ||= []).push(t);
    (byDirection[t.direction] ||= []).push(t);
    byExit[t.exit_reason] = (byExit[t.exit_reason] || 0) + 1;
  }
  return {
    by_year: Object.fromEntries(Object.entries(byYear).map(([y, x]) => [y, stats(x)])),
    by_direction: Object.fromEntries(Object.entries(byDirection).map(([d, x]) => [d, stats(x)])),
    exit_reason_counts: byExit
  };
}

async function main() {
  await fs.mkdir(CFG.out, { recursive: true });
  const m15 = indicators(await fetchBars());
  const h1 = indicators(aggregateH1(m15, CFG.timezone));
  const trades = [];
  const diagnostics = { evaluated: 0, candidates: 0, h1_up: 0, h1_down: 0, wait_by_reason: {} };
  let nextEligible = 0;

  for (let i = 250; i < m15.length - 2; i++) {
    if (i < nextEligible) continue;
    const signalClose = m15[i].time + 300;
    const h1i = latestCompletedH1(h1, signalClose);
    if (h1i < 200) continue;
    diagnostics.evaluated++;
    const h = h1[h1i];
    const up = h.close > h.ema20 && h.ema20 > h.ema50 && h.ema50 > h.ema200 && h.rsi14 >= CFG.buyRsiMin && h.rsi14 <= CFG.buyRsiMax;
    const down = h.close < h.ema20 && h.ema20 < h.ema50 && h.ema50 < h.ema200 && h.rsi14 >= CFG.sellRsiMin && h.rsi14 <= CFG.sellRsiMax;
    if (up) diagnostics.h1_up++; else if (down) diagnostics.h1_down++;

    const setup = buildSignal(m15, i, h1, h1i);
    if (!setup) continue;
    diagnostics.candidates++;
    const result = simulate(m15, i, setup);
    if (!result) continue;
    const t = {
      signal_time: new Date(signalClose * 1000).toISOString(),
      direction: setup.direction,
      result_r: result.result_r,
      exit_reason: result.exit_reason,
      exit_time: new Date((m15[result.exitIndex].time + 300) * 1000).toISOString(),
      hold_bars: result.exitIndex - i
    };
    trades.push(t);
    nextEligible = i + Math.max(1, t.hold_bars) + CFG.cooldownBars;
  }

  const cutoff = Date.now() - 365 * 86400000;
  const recent = trades.filter(t => Date.parse(t.signal_time) >= cutoff);
  const development = trades.filter(t => Date.parse(t.signal_time) < cutoff);
  const summary = {
    strategy: 'XAUUSD M5/H1 Trend Compression Breakout EA V1',
    lookback_days: CFG.days,
    source: 'Dukascopy historical XAUUSD M5 bid data',
    timezone_for_session: CFG.timezone,
    bars: m15.length,
    parameters: CFG,
    statistics: stats(trades),
    walk_forward: {
      development_period: stats(development),
      validation_recent_365_days: stats(recent),
      rule: 'fixed parameters; no parameter fitting inside the backtester'
    },
    breakdown: breakdown(trades),
    diagnostics
  };
  await fs.writeFile(path.join(CFG.out, 'summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(CFG.out, 'trades.csv'), [
    'signal_time,direction,result_r,exit_reason,exit_time,hold_bars',
    ...trades.map(t => [t.signal_time, t.direction, t.result_r, t.exit_reason, t.exit_time, t.hold_bars].join(','))
  ].join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
