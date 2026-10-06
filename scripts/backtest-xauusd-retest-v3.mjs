import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { findXauRetestSetupV3 } from '../src/xauusd_retest_v3.js';

const CFG = {
  days: Number(process.env.XAU_V3_DAYS || 1825),
  timezone: process.env.XAU_V3_TIMEZONE || 'Europe/Nicosia',
  spread: Number(process.env.XAU_V3_SPREAD_PRICE || 0.55),
  slippage: Number(process.env.XAU_V3_SLIPPAGE_PRICE || 0.10),
  maxHoldBars: Number(process.env.XAU_V3_MAX_HOLD_BARS || 96),
  cooldownBars: Number(process.env.XAU_V3_COOLDOWN_BARS || 2),
  out: process.env.XAU_V3_OUTPUT_DIR || 'xauusd-retest-v3-output',
  dataFile: process.env.XAU_V3_DATA_FILE || 'gold-xauusd-data/xauusd-m5.json.gz',
  endUtc: process.env.XAU_V3_END_UTC || '2026-10-05T00:00:00Z',
  breakoutLookback: Number(process.env.XAU_V3_BREAKOUT_LOOKBACK || 12),
  minRangeAtr: Number(process.env.XAU_V3_MIN_RANGE_ATR || 0.60),
  maxRangeAtr: Number(process.env.XAU_V3_MAX_RANGE_ATR || 3.20),
  breakoutAtr: Number(process.env.XAU_V3_BREAKOUT_ATR || 0.08),
  breakoutBodyAtr: Number(process.env.XAU_V3_BREAKOUT_BODY_ATR || 0.30),
  breakoutCloseLocation: Number(process.env.XAU_V3_BREAKOUT_CLOSE_LOCATION || 0.60),
  maxBreakoutBodyAtr: Number(process.env.XAU_V3_MAX_BREAKOUT_BODY_ATR || 1.80),
  maxRetestBars: Number(process.env.XAU_V3_MAX_RETEST_BARS || 6),
  maxConfirmBars: Number(process.env.XAU_V3_MAX_CONFIRM_BARS || 3),
  retestToleranceAtr: Number(process.env.XAU_V3_RETEST_TOLERANCE_ATR || 0.20),
  maxPenetrationAtr: Number(process.env.XAU_V3_MAX_PENETRATION_ATR || 0.20),
  retestCloseBufferAtr: Number(process.env.XAU_V3_RETEST_CLOSE_BUFFER_ATR || 0.05),
  confirmBufferAtr: Number(process.env.XAU_V3_CONFIRM_BUFFER_ATR || 0.02),
  confirmBodyAtr: Number(process.env.XAU_V3_CONFIRM_BODY_ATR || 0.25),
  minConfirmCloseLocation: Number(process.env.XAU_V3_CONFIRM_CLOSE_LOCATION || 0.60),
  maxConfirmBodyAtr: Number(process.env.XAU_V3_MAX_CONFIRM_BODY_ATR || 1.50),
  minStopAtr: Number(process.env.XAU_V3_MIN_STOP_ATR || 0.60),
  maxStopAtr: Number(process.env.XAU_V3_MAX_STOP_ATR || 2.20),
  stopBufferAtr: Number(process.env.XAU_V3_STOP_BUFFER_ATR || 0.12),
  takeProfitR: Number(process.env.XAU_V3_TAKE_PROFIT_R || 1.80),
  maxEntryDistanceAtr: Number(process.env.XAU_V3_MAX_ENTRY_DISTANCE_ATR || 0.25),
  maxExtensionAtr: Number(process.env.XAU_V3_MAX_EXTENSION_ATR || 1.80),
  minH1Agreement: Number(process.env.XAU_V3_MIN_H1_AGREEMENT || 0.60),
  h1BuyRsiMin: Number(process.env.XAU_V3_H1_BUY_RSI_MIN || 45),
  h1BuyRsiMax: Number(process.env.XAU_V3_H1_BUY_RSI_MAX || 75),
  h1SellRsiMin: Number(process.env.XAU_V3_H1_SELL_RSI_MIN || 25),
  h1SellRsiMax: Number(process.env.XAU_V3_H1_SELL_RSI_MAX || 55),
  useVolumeFilter: String(process.env.XAU_V3_USE_VOLUME_FILTER || 'false') === 'true',
  minVolumeRatio: Number(process.env.XAU_V3_MIN_VOLUME_RATIO || 0.90),
  maxSpreadPrice: Number(process.env.XAU_V3_MAX_SPREAD_PRICE || 0.60)
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
  let gain = 0;
  let loss = 0;
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

function inSessionJst(ts) {
  const p = localParts(ts, 'Asia/Tokyo');
  const minute = p.hour * 60 + p.minute;
  const start = 21 * 60;
  const end = 24 * 60;
  return minute >= start && minute < end;
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
    if (!x) {
      map.set(h, { time: h, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    } else {
      x.high = Math.max(x.high, b.high);
      x.low = Math.min(x.low, b.low);
      x.close = b.close;
      x.volume += b.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function latestCompletedH1Index(h1, signalCloseTime) {
  let lo = 0;
  let hi = h1.length - 1;
  let answer = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (h1[mid].time + 3600 <= signalCloseTime) {
      answer = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return answer;
}

async function loadPreparedBars() {
  const dataPath = path.resolve(CFG.dataFile);
  let raw;
  try {
    raw = await fs.readFile(dataPath);
  } catch (error) {
    throw new Error(`Prepared XAUUSD M5 dataset not found: ${dataPath}. Refusing live network fallback.`);
  }

  const digest = createHash('sha256').update(raw).digest('hex');
  let payload;
  try {
    payload = dataPath.endsWith('.gz')
      ? JSON.parse(gunzipSync(raw).toString('utf8'))
      : JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(`Failed to parse prepared XAUUSD M5 dataset: ${error.message}`);
  }

  if (!Array.isArray(payload) || payload.length < 200000) {
    throw new Error(`Insufficient prepared XAUUSD M5 coverage: ${payload?.length || 0}`);
  }

  const bars = payload.map(b => ({
    time: Math.floor(Number(b.time)),
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
    volume: Number(b.volume) || 0
  })).filter(b =>
    Number.isFinite(b.time) && b.open > 0 &&
    b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close
  ).sort((a, b) => a.time - b.time);

  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].time <= bars[i - 1].time) {
      throw new Error('Prepared XAUUSD M5 timestamps are not strictly increasing');
    }
  }

  return { bars, sha256: digest, file: dataPath };
}

function stats(trades) {
  const wins = trades.filter(t => t.result_r > 0);
  const losses = trades.filter(t => t.result_r < 0);
  const net = trades.reduce((s, t) => s + t.result_r, 0);
  const grossWin = wins.reduce((s, t) => s + t.result_r, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.result_r, 0));
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.result_r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const first = trades[0] ? Date.parse(trades[0].signal_time) : NaN;
  const last = trades.at(-1) ? Date.parse(trades.at(-1).signal_time) : NaN;
  const weeks = Number.isFinite(first) && Number.isFinite(last)
    ? Math.max(1, (last - first) / 604800000)
    : 0;
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: trades.length ? wins.length / trades.length * 100 : 0,
    net_r: net,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy_r: trades.length ? net / trades.length : 0,
    max_drawdown_r: maxDd,
    trades_per_week: weeks ? trades.length / weeks : 0
  };
}

function breakdown(trades) {
  const byYear = {};
  const byDirection = {};
  const byExit = {};
  for (const t of trades) {
    const year = new Date(t.signal_time).getUTCFullYear();
    (byYear[year] ||= []).push(t);
    (byDirection[t.direction] ||= []).push(t);
    byExit[t.exit_reason] = (byExit[t.exit_reason] || 0) + 1;
  }
  return {
    by_year: Object.fromEntries(Object.entries(byYear).map(([y, x]) => [y, stats(x)])),
    by_direction: Object.fromEntries(Object.entries(byDirection).map(([d, x]) => [d, stats(x)])),
    exit_reason_counts: byExit
  };
}

function buildFeatures(m5, i, h1, h1i) {
  const b = m5[i];
  const spread = CFG.spread;
  return {
    barTime: b.time + 300,
    bid: b.close,
    ask: b.close + spread,
    spread,
    m5: {
      ema20: b.ema20,
      ema50: b.ema50,
      rsi14: b.rsi14,
      atr14: b.atr14
    },
    h1: {
      close: h1[h1i].close,
      ema20: h1[h1i].ema20,
      ema50: h1[h1i].ema50,
      ema200: h1[h1i].ema200,
      rsi14: h1[h1i].rsi14,
      atr14: h1[h1i].atr14
    },
    recentM5: m5.slice(Math.max(0, i - 95), i + 1).map(x => ({ ...x, time: x.time + 300 })),
    recentH1: h1.slice(Math.max(0, h1i - 19), h1i + 1).map(x => ({ ...x, time: x.time + 3600 }))
  };
}

function simulate(m5, confirmationIndex, setup) {
  const entryBarIndex = confirmationIndex + 1;
  if (entryBarIndex >= m5.length) return null;
  const spread = CFG.spread;
  const slip = CFG.slippage;
  const dir = setup.candidate;
  const entry = dir === 'BUY'
    ? m5[entryBarIndex].open + spread + slip
    : m5[entryBarIndex].open - slip;
  const stop = setup.stop_loss;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const stopAtr = risk / m5[confirmationIndex].atr14;
  if (!(stopAtr >= CFG.minStopAtr && stopAtr <= CFG.maxStopAtr)) return null;
  const target = dir === 'BUY'
    ? entry + risk * setup.risk_reward
    : entry - risk * setup.risk_reward;
  const end = Math.min(m5.length - 1, entryBarIndex + CFG.maxHoldBars);
  let resultR = 0;
  let reason = 'TIME';
  let exitIndex = end;
  for (let j = entryBarIndex; j <= end; j++) {
    const b = m5[j];
    const askHigh = b.high + spread;
    const askLow = b.low + spread;
    const exitHigh = dir === 'BUY' ? b.high : askHigh;
    const exitLow = dir === 'BUY' ? b.low : askLow;
    const hitStop = dir === 'BUY' ? exitLow <= stop : exitHigh >= stop;
    const hitTarget = dir === 'BUY' ? exitHigh >= target : exitLow <= target;
    if (hitStop && hitTarget) {
      resultR = -1 - slip / risk;
      reason = 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE';
      exitIndex = j;
      break;
    }
    if (hitStop) {
      resultR = -1 - slip / risk;
      reason = 'STOP';
      exitIndex = j;
      break;
    }
    if (hitTarget) {
      resultR = setup.risk_reward - slip / risk;
      reason = 'TARGET';
      exitIndex = j;
      break;
    }
  }
  if (reason === 'TIME') {
    const b = m5[end];
    const exit = dir === 'BUY' ? b.close : b.close + spread;
    resultR = dir === 'BUY'
      ? (exit - slip - entry) / risk
      : (entry - (exit + slip)) / risk;
  }
  return {
    signal_time: new Date((m5[confirmationIndex].time + 300) * 1000).toISOString(),
    entry_time: new Date((m5[entryBarIndex].time + 300) * 1000).toISOString(),
    direction: dir,
    result_r: resultR,
    exit_reason: reason,
    exit_time: new Date((m5[exitIndex].time + 300) * 1000).toISOString(),
    hold_bars: exitIndex - entryBarIndex,
    breakout_time: new Date((setup.diagnostics.breakout_time) * 1000).toISOString(),
    retest_time: new Date((setup.diagnostics.retest_time) * 1000).toISOString()
  };
}

async function main() {
  await fs.mkdir(CFG.out, { recursive: true });
  const endMs = Date.parse(CFG.endUtc);
  if (!Number.isFinite(endMs)) throw new Error(`Invalid XAU_V3_END_UTC: ${CFG.endUtc}`);
  const startMs = endMs - CFG.days * 86400000;
  const endTs = Math.floor(endMs / 1000);
  const startTs = Math.floor(startMs / 1000);
  const prepared = await loadPreparedBars();
  const m5 = indicators(prepared.bars);
  const h1 = indicators(aggregateH1(m5, CFG.timezone));
  const trades = [];
  const diagnostics = {
    evaluated: 0,
    session_bars: 0,
    h1_up: 0,
    h1_down: 0,
    candidates: 0,
    wait_by_reason: {}
  };
  let nextEligible = 0;

  const strategyOptions = {
    breakoutLookback: CFG.breakoutLookback,
    minRangeAtr: CFG.minRangeAtr,
    maxRangeAtr: CFG.maxRangeAtr,
    breakoutAtr: CFG.breakoutAtr,
    breakoutBodyAtr: CFG.breakoutBodyAtr,
    breakoutCloseLocation: CFG.breakoutCloseLocation,
    maxBreakoutBodyAtr: CFG.maxBreakoutBodyAtr,
    maxRetestBars: CFG.maxRetestBars,
    minRetestBars: 1,
    maxConfirmBars: CFG.maxConfirmBars,
    retestToleranceAtr: CFG.retestToleranceAtr,
    maxPenetrationAtr: CFG.maxPenetrationAtr,
    retestCloseBufferAtr: CFG.retestCloseBufferAtr,
    confirmBufferAtr: CFG.confirmBufferAtr,
    confirmBodyAtr: CFG.confirmBodyAtr,
    minConfirmCloseLocation: CFG.minConfirmCloseLocation,
    maxConfirmBodyAtr: CFG.maxConfirmBodyAtr,
    minStopAtr: CFG.minStopAtr,
    maxStopAtr: CFG.maxStopAtr,
    stopBufferAtr: CFG.stopBufferAtr,
    takeProfitR: CFG.takeProfitR,
    maxEntryDistanceAtr: CFG.maxEntryDistanceAtr,
    maxExtensionAtr: CFG.maxExtensionAtr,
    minH1Agreement: CFG.minH1Agreement,
    h1BuyRsiMin: CFG.h1BuyRsiMin,
    h1BuyRsiMax: CFG.h1BuyRsiMax,
    h1SellRsiMin: CFG.h1SellRsiMin,
    h1SellRsiMax: CFG.h1SellRsiMax,
    useVolumeFilter: CFG.useVolumeFilter,
    minVolumeRatio: CFG.minVolumeRatio,
    maxSpreadPrice: CFG.maxSpreadPrice
  };

  for (let i = 260; i < m5.length - 2; i++) {
    const signalCloseTime = m5[i].time + 300;
    if (signalCloseTime < startTs || signalCloseTime >= endTs) continue;
    if (i < nextEligible) continue;
    diagnostics.evaluated++;
    if (!inSessionJst(m5[i].time + 300)) {
      diagnostics.wait_by_reason.outside_session = (diagnostics.wait_by_reason.outside_session || 0) + 1;
      continue;
    }
    diagnostics.session_bars++;
    const h1i = latestCompletedH1Index(h1, m5[i].time + 300);
    if (h1i < 20) continue;

    const f = buildFeatures(m5, i, h1, h1i);
    const setup = findXauRetestSetupV3(f, strategyOptions);
    if (setup.trend === 'UP') diagnostics.h1_up++;
    else if (setup.trend === 'DOWN') diagnostics.h1_down++;
    if (setup.candidate === 'WAIT') {
      for (const reason of setup.reasons || []) {
        diagnostics.wait_by_reason[reason] = (diagnostics.wait_by_reason[reason] || 0) + 1;
      }
      continue;
    }

    if (i + 1 >= m5.length) continue;
    const trade = simulate(m5, i, setup);
    if (!trade) {
      diagnostics.wait_by_reason.execution_validation = (diagnostics.wait_by_reason.execution_validation || 0) + 1;
      continue;
    }

    diagnostics.candidates++;
    trades.push(trade);
    nextEligible = i + Math.max(1, trade.hold_bars) + 1 + CFG.cooldownBars;
  }

  const cutoff = endMs - 365 * 86400000;
  const validation = trades.filter(t => Date.parse(t.signal_time) >= cutoff);
  const development = trades.filter(t => Date.parse(t.signal_time) < cutoff);

  const summary = {
    strategy: 'XAUUSD M5/H1 Range Breakout Retest Reclaim V3',
    design: {
      sequence: 'range -> confirmed breakout -> retest -> reclaim confirmation (1-3 bars) -> next-bar entry',
      no_lookahead: true,
      session: '21:00-00:00 JST',
      data_source: 'fixed prepared Dukascopy XAUUSD M5 bid dataset',
      data_file: prepared.file,
      data_sha256: prepared.sha256,
      fixed_end_utc: CFG.endUtc,
      backtest_start_utc: new Date(startMs).toISOString(),
      backtest_end_exclusive_utc: new Date(endMs).toISOString()
    },
    parameters: CFG,
    bars: m5.length,
    statistics: stats(trades),
    walk_forward: {
      development_period: stats(development),
      validation_recent_365_days: stats(validation),
      rule: 'fixed parameters; no parameter fitting inside backtester'
    },
    breakdown: breakdown(trades),
    diagnostics
  };

  await fs.writeFile(path.join(CFG.out, 'summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(CFG.out, 'trades.csv'), [
    'signal_time,entry_time,direction,result_r,exit_reason,exit_time,hold_bars,breakout_time,retest_time',
    ...trades.map(t => [
      t.signal_time, t.entry_time, t.direction, t.result_r, t.exit_reason,
      t.exit_time, t.hold_bars, t.breakout_time, t.retest_time
    ].join(','))
  ].join('\n') + '\n');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
