import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildEurUsdTechnicalCoreV4 } from '../src/eurusd_technical_core_v4.js';
import { normalizeEurUsdFeatures } from '../src/eurusd_features.js';

const C = {
  days: Math.max(365, Number(process.env.CORE_V4_LOOKBACK_DAYS || 1825)),
  tz: process.env.CORE_V4_SERVER_TIMEZONE || 'Europe/Nicosia',
  spread: Math.max(0, Number(process.env.CORE_V4_SPREAD_PIPS || 0.8)),
  slip: Math.max(0, Number(process.env.CORE_V4_SLIPPAGE_PIPS || 0.1)),
  hold: Math.max(8, Number(process.env.CORE_V4_MAX_HOLD_BARS || 96)),
  cooldown: Math.max(0, Number(process.env.CORE_V4_COOLDOWN_BARS || 2)),
  out: process.env.CORE_V4_OUTPUT_DIR || 'eurusd-core-v4-backtest-output',
  lookback: Number(process.env.CORE_V4_SETUP_LOOKBACK || 12),
  minImpulse: Number(process.env.CORE_V4_MIN_IMPULSE_ATR || 0.35),
  minPullback: Number(process.env.CORE_V4_MIN_PULLBACK_ATR || 0.05),
  touchBuffer: Number(process.env.CORE_V4_TOUCH_BUFFER_ATR || 0.30),
  structureBuffer: Number(process.env.CORE_V4_STRUCTURE_BUFFER_ATR || 0.20),
  triggerBuffer: Number(process.env.CORE_V4_TRIGGER_BUFFER_ATR || 0.02),
  minBody: Number(process.env.CORE_V4_MIN_BODY_ATR || 0.20),
  closeLocation: Number(process.env.CORE_V4_MIN_CLOSE_LOCATION || 0.60),
  h1Agreement: Number(process.env.CORE_V4_MIN_H1_AGREEMENT || 0.50),
  tpR: Number(process.env.CORE_V4_TAKE_PROFIT_R || 1.50)
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
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i] - values[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  let avgGain = gain / period, avgLoss = loss / period;
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
    : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)));
  let value = tr.slice(1, period + 1).reduce((s, v) => s + v, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function indicators(bars) {
  const closes = bars.map((b) => b.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const rr = rsi(closes, 14), aa = atr(bars, 14);
  return bars.map((b, i) => ({ ...b, ema20: e20[i], ema50: e50[i], ema200: e200[i], rsi14: rr[i], atr14: aa[i] }));
}

function localParts(ts, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ts * 1000)).reduce((o, p) => {
    if (p.type !== 'literal') o[p.type] = Number(p.value);
    return o;
  }, {});
}

function zonedHourStart(ts, tz) {
  const p = localParts(ts, tz);
  const localAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetSeconds = Math.round((localAsUtcMs - ts * 1000) / 1000);
  const localHourAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, 0, 0);
  return Math.floor((localHourAsUtcMs - offsetSeconds * 1000) / 1000);
}

function aggregateH1(m15, tz) {
  const map = new Map();
  for (const b of m15) {
    const hour = zonedHourStart(b.time, tz);
    const x = map.get(hour);
    if (!x) map.set(hour, { time: hour, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    else {
      x.high = Math.max(x.high, b.high);
      x.low = Math.min(x.low, b.low);
      x.close = b.close;
      x.volume += b.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function latestH1(h1, signalClose) {
  let lo = 0, hi = h1.length - 1, best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (h1[mid].time + 3600 <= signalClose) {
      best = mid; lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function features(m15, i, h1, h1i) {
  const b = m15[i];
  const spread = C.spread * 0.0001;
  return normalizeEurUsdFeatures({
    bid: b.close - spread / 2,
    ask: b.close + spread / 2,
    point: 0.00001,
    spread,
    bar_time: b.time + 900,
    m15: { ema20: b.ema20, ema50: b.ema50, rsi14: b.rsi14, atr14: b.atr14 },
    h1: {
      close: h1[h1i].close,
      ema20: h1[h1i].ema20,
      ema50: h1[h1i].ema50,
      ema200: h1[h1i].ema200,
      rsi14: h1[h1i].rsi14,
      atr14: h1[h1i].atr14
    },
    recent_m15: m15.slice(Math.max(0, i - 79), i + 1).map((x) => ({ ...x, time: x.time + 900 })),
    recent_h1: h1.slice(Math.max(0, h1i - 79), h1i + 1).map((x) => ({ ...x, time: x.time + 3600 }))
  });
}

async function loadPreparedBars(file) {
  const raw = await fs.readFile(path.resolve(file));
  const text = file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error('Prepared EURUSD data must be an array');
  const now = Date.now();
  return rows.map((b) => ({
    time: Number(b.time),
    open: Number(b.open),
    high: Number(b.high),
    low: Number(b.low),
    close: Number(b.close),
    volume: Number(b.volume) || 0
  })).filter((b) =>
    Number.isFinite(b.time) && b.open > 0 &&
    b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close &&
    (b.time + 900) * 1000 <= now
  ).sort((a, b) => a.time - b.time);
}

async function fetchBars() {
  if (process.env.CORE_V4_DATA_FILE) return loadPreparedBars(process.env.CORE_V4_DATA_FILE);
  const mod = await import('dukascopy-node');
  const get = mod.getHistoricalRates || mod.default?.getHistoricalRates;
  if (typeof get !== 'function') throw new Error('dukascopy-node getHistoricalRates export missing');
  const end = new Date();
  const start = new Date(end.getTime() - C.days * 86400000);
  const rows = await get({
    instrument: 'eurusd',
    dates: { from: start, to: end },
    timeframe: 'm15',
    priceType: 'bid',
    volumes: true,
    format: 'array'
  });
  if (!Array.isArray(rows) || rows.length < 100000) throw new Error('Insufficient EURUSD M15 coverage: ' + (rows?.length || 0));
  const now = Date.now();
  return rows.map((r) => ({
    time: Math.floor(Number(r[0]) / 1000),
    open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) || 0
  })).filter((b) =>
    Number.isFinite(b.time) && b.open > 0 &&
    b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close &&
    (b.time + 900) * 1000 <= now
  ).sort((a, b) => a.time - b.time);
}

function simulate(m15, i, setup) {
  if (i + 1 >= m15.length) return null;
  const spread = C.spread * 0.0001, slip = C.slip * 0.0001;
  const dir = setup.candidate;
  const entry = dir === 'BUY' ? m15[i + 1].open + spread + slip : m15[i + 1].open - spread - slip;
  const risk = Math.abs(setup.entry - setup.stop_loss);
  if (!(risk > 0)) return null;
  const stop = dir === 'BUY' ? entry - risk : entry + risk;
  const target = dir === 'BUY' ? entry + risk * setup.risk_reward : entry - risk * setup.risk_reward;
  const end = Math.min(m15.length - 1, i + C.hold);
  let resultR = 0, exitReason = 'TIME', exitIndex = end;
  for (let j = i + 1; j <= end; j += 1) {
    const b = m15[j];
    const high = dir === 'BUY' ? b.high : b.high + spread;
    const low = dir === 'BUY' ? b.low : b.low + spread;
    const hitStop = dir === 'BUY' ? low <= stop : high >= stop;
    const hitTarget = dir === 'BUY' ? high >= target : low <= target;
    if (hitStop && hitTarget) {
      resultR = dir === 'BUY' ? (stop - slip - entry) / risk : (entry - (stop + slip)) / risk;
      exitReason = 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE'; exitIndex = j; break;
    }
    if (hitStop) {
      resultR = dir === 'BUY' ? (stop - slip - entry) / risk : (entry - (stop + slip)) / risk;
      exitReason = 'STOP'; exitIndex = j; break;
    }
    if (hitTarget) {
      resultR = dir === 'BUY' ? (target - slip - entry) / risk : (entry - (target + slip)) / risk;
      exitReason = 'TARGET'; exitIndex = j; break;
    }
  }
  if (exitReason === 'TIME') {
    const px = dir === 'BUY' ? m15[end].close : m15[end].close + spread;
    resultR = dir === 'BUY' ? (px - slip - entry) / risk : (entry - (px + slip)) / risk;
  }
  return {
    signal_time: new Date((m15[i].time + 900) * 1000).toISOString(),
    direction: dir,
    result_r: resultR,
    exit_reason: exitReason,
    exit_time: new Date((m15[exitIndex].time + 900) * 1000).toISOString(),
    hold_bars: exitIndex - i
  };
}

function stats(trades) {
  const wins = trades.filter((t) => t.result_r > 0), losses = trades.filter((t) => t.result_r < 0);
  const net = trades.reduce((s, t) => s + t.result_r, 0);
  const grossWin = wins.reduce((s, t) => s + t.result_r, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.result_r, 0));
  let eq = 0, peak = 0, dd = 0;
  for (const t of trades) {
    eq += t.result_r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
  }
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: trades.length ? wins.length / trades.length * 100 : 0,
    net_r: net,
    expectancy_r: trades.length ? net / trades.length : 0,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : null,
    max_drawdown_r: dd
  };
}

function byYear(trades) {
  const map = new Map();
  for (const t of trades) {
    const y = new Date(t.signal_time).getUTCFullYear().toString();
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(t);
  }
  return Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stats(v)]));
}

async function main() {
  await fs.mkdir(C.out, { recursive: true });
  const raw = await fetchBars();
  const m15 = indicators(raw);
  const h1 = indicators(aggregateH1(m15, C.tz));
  const trades = [];
  let nextEligible = 0;
  const diagnostics = { evaluated: 0, h1_up: 0, h1_down: 0, h1_range: 0, candidates: 0, waits: 0, wait_reasons: {} };

  for (let i = 250; i < m15.length - 2; i += 1) {
    if (i < nextEligible) continue;
    const h1i = latestH1(h1, m15[i].time + 900);
    if (h1i < 200) continue;
    diagnostics.evaluated += 1;
    const f = features(m15, i, h1, h1i);
    const setup = buildEurUsdTechnicalCoreV4(f, {
      lookback: C.lookback,
      minImpulseAtr: C.minImpulse,
      minPullbackAtr: C.minPullback,
      touchBufferAtr: C.touchBuffer,
      structureBufferAtr: C.structureBuffer,
      triggerBufferAtr: C.triggerBuffer,
      minBodyAtr: C.minBody,
      minCloseLocation: C.closeLocation,
      minH1Agreement: C.h1Agreement,
      takeProfitR: C.tpR,
      minStopAtr: 0.40,
      maxStopAtr: 1.80,
      maxH1ExtensionAtr: 3.00,
      maxSpreadPips: Math.max(C.spread, 1.2),
      maxSpreadAtrPct: 20
    });
    if (setup.trend === 'UP') diagnostics.h1_up += 1;
    else if (setup.trend === 'DOWN') diagnostics.h1_down += 1;
    else diagnostics.h1_range += 1;

    if (setup.candidate === 'WAIT') {
      diagnostics.waits += 1;
      for (const reason of setup.reasons || []) diagnostics.wait_reasons[reason] = (diagnostics.wait_reasons[reason] || 0) + 1;
      continue;
    }

    diagnostics.candidates += 1;
    const t = simulate(m15, i, setup);
    if (t) {
      trades.push(t);
      nextEligible = i + Math.max(1, t.hold_bars) + C.cooldown;
    }
  }

  const cutoff = new Date(Date.now() - 365 * 86400000);
  const recent365 = trades.filter((t) => new Date(t.signal_time) >= cutoff);
  const old = trades.filter((t) => new Date(t.signal_time) < cutoff);
  const first = trades[0]?.signal_time ?? null;
  const last = trades.at(-1)?.signal_time ?? null;

  const report = {
    schema_version: 1,
    strategy: 'EURUSD H1 trend + M15 pullback technical core V4',
    generated_at: new Date().toISOString(),
    period: { first_signal_time: first, last_signal_time: last, lookback_days: C.days },
    data: { source: 'Dukascopy EURUSD M15 BID', bars: m15.length, timezone: C.tz },
    execution: { spread_pips: C.spread, slippage_pips: C.slip, max_hold_bars: C.hold, cooldown_bars: C.cooldown },
    parameters: {
      lookback: C.lookback, min_impulse_atr: C.minImpulse, min_pullback_atr: C.minPullback,
      touch_buffer_atr: C.touchBuffer, structure_buffer_atr: C.structureBuffer,
      trigger_buffer_atr: C.triggerBuffer, min_body_atr: C.minBody,
      min_close_location: C.closeLocation, min_h1_agreement: C.h1Agreement, take_profit_r: C.tpR
    },
    overall: stats(trades),
    recent_365_days: stats(recent365),
    prior_period: stats(old),
    annual: byYear(trades),
    diagnostics
  };

  await fs.writeFile(path.join(C.out, 'summary.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(C.out, 'trades.csv'), [
    'signal_time,direction,result_r,exit_reason,exit_time,hold_bars',
    ...trades.map((t) => [t.signal_time, t.direction, t.result_r, t.exit_reason, t.exit_time, t.hold_bars].join(','))
  ].join('\n') + '\n');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
