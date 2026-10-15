import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { findXauRetestSetupV3, hasValidStopGeometry } from '../src/xauusd_retest_v3.js';

const CFG = {
  days: Number(process.env.XAU_V3_DAYS || 1825),
  timezone: process.env.XAU_V3_TIMEZONE || 'Europe/Nicosia',
  // Keep signal eligibility constant while varying execution spread in cost-stress runs.
  spread: Number(process.env.XAU_V3_SPREAD_PRICE || 0.55),
  signalSpread: process.env.XAU_V3_SIGNAL_SPREAD_PRICE === undefined
    ? Number(process.env.XAU_V3_SPREAD_PRICE || 0.55)
    : Number(process.env.XAU_V3_SIGNAL_SPREAD_PRICE),
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
  const spread = CFG.signalSpread;
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
  const signalBar = m5[confirmationIndex];
  const entryBar = m5[entryBarIndex];
  const atr = signalBar.atr14;
  const signalClose = signalBar.close;
  const rawNextOpen = entryBar.open;
  const entry = dir === 'BUY'
    ? rawNextOpen + spread + slip
    : rawNextOpen - slip;
  const stop = setup.stop_loss;
  const signalEntryReference = setup.entry;
  const setupTargetReference = setup.take_profit;
  const diagnostics = setup.diagnostics || {};

  // A market order with SL already on the wrong side of the next-bar fill
  // is not a valid executable setup. Do not count it as an immediate stop loss.
  if (!hasValidStopGeometry(dir, entry, stop)) return { rejected: 'invalid_stop_geometry' };

  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || !(atr > 0)) return null;
  const stopAtr = risk / atr;
  if (!(stopAtr >= CFG.minStopAtr && stopAtr <= CFG.maxStopAtr)) return null;
  const target = dir === 'BUY'
    ? entry + risk * setup.risk_reward
    : entry - risk * setup.risk_reward;

  const end = Math.min(m5.length - 1, entryBarIndex + CFG.maxHoldBars);
  let resultR = 0;
  let reason = 'TIME';
  let exitIndex = end;
  let exitModelledPrice = null;

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
      exitModelledPrice = dir === 'BUY' ? stop - slip : stop + slip;
      break;
    }
    if (hitStop) {
      resultR = -1 - slip / risk;
      reason = 'STOP';
      exitIndex = j;
      exitModelledPrice = dir === 'BUY' ? stop - slip : stop + slip;
      break;
    }
    if (hitTarget) {
      resultR = setup.risk_reward - slip / risk;
      reason = 'TARGET';
      exitIndex = j;
      exitModelledPrice = dir === 'BUY' ? target - slip : target + slip;
      break;
    }
  }

  if (reason === 'TIME') {
    const b = m5[end];
    const sideExit = dir === 'BUY' ? b.close : b.close + spread;
    resultR = dir === 'BUY'
      ? (sideExit - slip - entry) / risk
      : (entry - (sideExit + slip)) / risk;
    exitModelledPrice = dir === 'BUY' ? sideExit - slip : sideExit + slip;
  }

  const exitBar = m5[exitIndex];
  const entryBarRange = entryBar.high - entryBar.low;
  const exitBarRange = exitBar.high - exitBar.low;
  const adverseEntryGap = dir === 'BUY' ? entry - signalClose : signalClose - entry;
  const adverseExecutionGap = dir === 'BUY' ? entry - signalEntryReference : signalEntryReference - entry;
  const entryBarStopOvershoot = dir === 'BUY'
    ? (stop - entryBar.low) / atr
    : (entryBar.high - stop) / atr;
  const exitBarStopOvershoot = reason === 'STOP' || reason === 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE'
    ? (dir === 'BUY' ? (stop - exitBar.low) / atr : (exitBar.high - stop) / atr)
    : null;
  const exitBarTargetOvershoot = reason === 'TARGET'
    ? (dir === 'BUY' ? (exitBar.high - target) / atr : (target - exitBar.low) / atr)
    : null;

  return {
    signal_time: new Date(signalBar.time + 300).toISOString(),
    entry_time: new Date(entryBar.time).toISOString(),
    direction: dir,
    result_r: resultR,
    exit_reason: reason,
    exit_bar_close_time: new Date(exitBar.time + 300).toISOString(),
    hold_bars: exitIndex - entryBarIndex,
    breakout_time: new Date((diagnostics.breakout_time) * 1000).toISOString(),
    retest_time: new Date((diagnostics.retest_time) * 1000).toISOString(),
    confirmation_lag_bars: diagnostics.confirmation_lag_bars ?? null,
    signal_close: signalClose,
    signal_atr: atr,
    signal_entry_reference: signalEntryReference,
    setup_target_reference: setupTargetReference,
    entry_bar_open_bid: rawNextOpen,
    entry_bar_high_bid: entryBar.high,
    entry_bar_low_bid: entryBar.low,
    entry_bar_close_bid: entryBar.close,
    entry_price_modelled: entry,
    entry_gap_adverse_price: adverseEntryGap,
    entry_gap_adverse_atr: adverseEntryGap / atr,
    entry_vs_signal_entry_reference_adverse_atr: adverseExecutionGap / atr,
    stop_loss: stop,
    take_profit_execution_model: target,
    risk_price: risk,
    stop_distance_signal_reference_atr: Math.abs(signalEntryReference - stop) / atr,
    stop_distance_execution_atr: stopAtr,
    entry_bar_range_atr: entryBarRange / atr,
    entry_bar_stop_overshoot_atr: entryBarStopOvershoot,
    exit_bar_open_bid: exitBar.open,
    exit_bar_high_bid: exitBar.high,
    exit_bar_low_bid: exitBar.low,
    exit_bar_close_bid: exitBar.close,
    exit_bar_range_atr: exitBarRange / atr,
    exit_bar_stop_overshoot_atr: exitBarStopOvershoot,
    exit_bar_target_overshoot_atr: exitBarTargetOvershoot,
    exit_price_modelled: exitModelledPrice,
    range_high: diagnostics.range_high ?? null,
    range_low: diagnostics.range_low ?? null,
    range_atr: diagnostics.range_atr ?? null,
    breakout_body_atr: diagnostics.breakout_body_atr ?? null,
    breakout_close_location: diagnostics.breakout_close_location ?? null,
    retest_low: diagnostics.retest_low ?? null,
    retest_high: diagnostics.retest_high ?? null,
    retest_close: diagnostics.retest_close ?? null,
    confirmation_body_atr: diagnostics.confirmation_body_atr ?? null,
    confirmation_close_location: diagnostics.confirmation_close_location ?? null,
    extension_atr: diagnostics.extension_atr ?? null,
    h1_slope_agreement: diagnostics.h1_slope_agreement ?? null,
    volume_ratio: diagnostics.volume_ratio ?? null,
    execution_spread_price: spread,
    slippage_assumption_price: slip
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
    if (trade.rejected) {
      diagnostics.wait_by_reason[trade.rejected] = (diagnostics.wait_by_reason[trade.rejected] || 0) + 1;
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
    trade_execution_audit: {
      schema_version: 2,
      entry_time_resolution: 'next M5 bar open',
      exit_time_resolution: 'exit M5 bar close; intrabar fill timestamp is not known from OHLC data',
      entries_stopped_in_entry_bar: trades.filter(t => t.hold_bars === 0 && (t.exit_reason === 'STOP' || t.exit_reason === 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE')).length,
      oos_trades: trades.filter(t => Date.parse(t.signal_time) >= endMs - 365 * 86400000).length,
      oos_stops_in_entry_bar: trades.filter(t => Date.parse(t.signal_time) >= endMs - 365 * 86400000 && t.hold_bars === 0 && (t.exit_reason === 'STOP' || t.exit_reason === 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE')).length
    },
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
  const tradeAuditColumns = [
    'signal_time','entry_time','direction','result_r','exit_reason','exit_bar_close_time','hold_bars',
    'breakout_time','retest_time','confirmation_lag_bars',
    'signal_close','signal_atr','signal_entry_reference','setup_target_reference',
    'entry_bar_open_bid','entry_bar_high_bid','entry_bar_low_bid','entry_bar_close_bid',
    'entry_price_modelled','entry_gap_adverse_price','entry_gap_adverse_atr',
    'entry_vs_signal_entry_reference_adverse_atr','stop_loss','take_profit_execution_model','risk_price',
    'stop_distance_signal_reference_atr','stop_distance_execution_atr','entry_bar_range_atr','entry_bar_stop_overshoot_atr',
    'exit_bar_open_bid','exit_bar_high_bid','exit_bar_low_bid','exit_bar_close_bid','exit_bar_range_atr',
    'exit_bar_stop_overshoot_atr','exit_bar_target_overshoot_atr','exit_price_modelled',
    'range_high','range_low','range_atr','breakout_body_atr','breakout_close_location',
    'retest_low','retest_high','retest_close','confirmation_body_atr','confirmation_close_location',
    'extension_atr','h1_slope_agreement','volume_ratio','execution_spread_price','slippage_assumption_price'
  ];
  const csvCell = value => {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  await fs.writeFile(path.join(CFG.out, 'trades.csv'), [
    tradeAuditColumns.join(','),
    ...trades.map(t => tradeAuditColumns.map(k => csvCell(t[k])).join(','))
  ].join('\n') + '\n');

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
