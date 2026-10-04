import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEurUsdTrendPullbackSetup } from '../src/eurusd_pullback.js';

const CONFIG = {
  lookbackDays: Math.max(30, Number(process.env.PULLBACK_BACKTEST_LOOKBACK_DAYS || 1825)),
  spreadPips: Math.max(0, Number(process.env.PULLBACK_BACKTEST_SPREAD_PIPS || 0.8)),
  slippagePips: Math.max(0, Number(process.env.PULLBACK_BACKTEST_SLIPPAGE_PIPS || 0.1)),
  maxHoldBars: Math.max(8, Number(process.env.PULLBACK_BACKTEST_MAX_HOLD_BARS || 96)),
  cooldownBars: Math.max(0, Number(process.env.PULLBACK_BACKTEST_COOLDOWN_BARS || 2)),
  outputDir: process.env.PULLBACK_BACKTEST_OUTPUT_DIR || 'pullback-backtest-output',
  minRetraceAtr: Number(process.env.PULLBACK_BACKTEST_MIN_RETRACE_ATR || 0.20),
  maxRetraceAtr: Number(process.env.PULLBACK_BACKTEST_MAX_RETRACE_ATR || 1.20),
  minBodyAtr: Number(process.env.PULLBACK_BACKTEST_MIN_BODY_ATR || 0.30),
  minCloseLocation: Number(process.env.PULLBACK_BACKTEST_MIN_CLOSE_LOCATION || 0.65),
  buyRsiMin: Number(process.env.PULLBACK_BACKTEST_BUY_RSI_MIN || 50),
  buyRsiMax: Number(process.env.PULLBACK_BACKTEST_BUY_RSI_MAX || 70),
  sellRsiMin: Number(process.env.PULLBACK_BACKTEST_SELL_RSI_MIN || 30),
  sellRsiMax: Number(process.env.PULLBACK_BACKTEST_SELL_RSI_MAX || 50)
};

const SOURCE = process.env.PULLBACK_BACKTEST_M15_SOURCE ||
  'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDm15.csv';

function parseTimestamp(raw) {
  const s = String(raw || '').trim().replace(/^"|"$/g, '');
  if (!s) return NaN;
  if (/^\d{8}(?:\s|T)?\d{6}$/.test(s)) {
    const d = s.replace(/\D/g, '');
    return Date.parse(d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6,8) + 'T' +
      d.slice(8,10) + ':' + d.slice(10,12) + ':' + d.slice(12,14) + 'Z');
  }
  if (/^\d{8}$/.test(s)) return Date.parse(s.slice(0,4) + '-' + s.slice(4,6) + '-' + s.slice(6,8) + 'T00:00:00Z');
  const normalized = s.replace(/\./g, '-').replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : normalized + 'Z');
}

function splitCsvLine(line) {
  if (line.includes(';') && !line.includes(',')) return line.split(';');
  return line.split(',');
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  console.log(JSON.stringify({
    raw_lines: lines.length,
    raw_first_line: lines[0].slice(0, 220),
    raw_last_line: lines[lines.length - 1].slice(0, 220)
  }));
  const header = splitCsvLine(lines[0]).map((x) => x.trim().replace(/^"|"$/g, '').toLowerCase());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const dateKey = ['datetime', 'date', 'time', 'timestamp', 'timestamp_utc'].find((k) => idx[k] !== undefined) || header[0];
  const volumeKey = ['volume', 'tick_volume', 'real_volume'].find((k) => idx[k] !== undefined) || null;
  for (const key of [dateKey, 'open', 'high', 'low', 'close']) if (idx[key] === undefined) throw new Error('CSV missing column: ' + key);

  const rows = [];
  let rejectCount = 0;
  const rejectExamples = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    const time = parseTimestamp(cells[idx[dateKey]]);
    const rawClose = Number(cells[idx.close]);
    if (!Number.isFinite(time) || !(rawClose > 0)) {
      rejectCount += 1;
      if (rejectExamples.length < 3) rejectExamples.push({ line: i + 1, raw: lines[i].slice(0, 220), time, rawClose });
      continue;
    }
    const scale = rawClose > 10 ? 100000 : 1;
    const price = (key) => Number(cells[idx[key]]) / scale;
    const open = price('open');
    const high = price('high');
    const low = price('low');
    const close = price('close');
    if (!(open > 0 && high >= low && high >= open && high >= close && low <= open && low <= close)) {
      rejectCount += 1;
      if (rejectExamples.length < 3) rejectExamples.push({ line: i + 1, raw: lines[i].slice(0, 220), open, high, low, close });
      continue;
    }
    rows.push({
      time: Math.floor(time / 1000),
      open, high, low, close,
      volume: volumeKey === null ? 0 : Number(cells[idx[volumeKey]]) || 0
    });
  }
  rows.sort((a, b) => a.time - b.time);
  const unique = rows.filter((r, i) => i === 0 || r.time !== rows[i - 1].time);
  console.log(JSON.stringify({
    parsed_rows: rows.length,
    unique_rows: unique.length,
    reject_count: rejectCount,
    reject_examples: rejectExamples,
    first_parsed_time: unique[0]?.time ?? null,
    last_parsed_time: unique.at(-1)?.time ?? null
  }));
  return unique;
}

async function fetchBars() {
  const sourceMode = String(process.env.PULLBACK_BACKTEST_SOURCE || 'dukascopy').toLowerCase();
  if (sourceMode === 'dukascopy') {
    const end = new Date();
    const start = new Date(end.getTime() - CONFIG.lookbackDays * 86400000);
    const mod = await import('dukascopy-node');
    const getHistoricalRates = mod.getHistoricalRates || mod.default?.getHistoricalRates;
    if (typeof getHistoricalRates !== 'function') throw new Error('dukascopy-node getHistoricalRates export not found');
    const data = await getHistoricalRates({
      instrument: 'eurusd',
      dates: { from: start, to: end },
      timeframe: 'm15',
      priceType: 'bid',
      volumes: true,
      format: 'array'
    });
    if (!Array.isArray(data) || data.length < 100) throw new Error('Dukascopy returned insufficient EURUSD M15 data: ' + (data?.length || 0));
    return data.map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]) || 0
    })).filter((b) => Number.isFinite(b.time) && b.open > 0 && b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close);
  }
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'Gold-AI-Trader-pullback-backtest/1.0' } });
  if (!res.ok) throw new Error('Download failed ' + res.status + ': ' + SOURCE);
  return parseCsv(await res.text());
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) continue;
    prev = prev === null ? values[i] : alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0; let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(0, d); loss += Math.max(0, -d);
  }
  let avgGain = gain / period; let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
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
  let value = tr.slice(1, period + 1).reduce((s, v) => s + v, 0) / period;
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
  const r14 = rsi(closes, 14);
  const a14 = atr(bars, 14);
  return bars.map((b, i) => ({ ...b, ema20: e20[i], ema50: e50[i], ema200: e200[i], rsi14: r14[i], atr14: a14[i] }));
}

function aggregateH1(m15) {
  const map = new Map();
  for (const b of m15) {
    const hour = Math.floor(b.time / 3600) * 3600;
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

function latestCompletedH1Index(h1, signalClose) {
  let lo = 0; let hi = h1.length - 1; let answer = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (h1[mid].time + 3600 <= signalClose) { answer = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return answer;
}

function buildFeatures(m15, i, h1, h1i) {
  const b = m15[i];
  const spread = CONFIG.spreadPips * 0.0001;
  return {
    bid: b.close - spread / 2,
    ask: b.close + spread / 2,
    point: 0.00001,
    spread,
    barTime: b.time + 900,
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
  };
}

function simulateTrade(bars, i, setup) {
  if (i + 1 >= bars.length) return null;
  const spread = CONFIG.spreadPips * 0.0001;
  const slippage = CONFIG.slippagePips * 0.0001;
  const dir = setup.candidate;
  const entry = dir === 'BUY'
    ? bars[i + 1].open + spread / 2 + slippage
    : bars[i + 1].open - spread / 2 - slippage;
  const risk = Math.abs(setup.entry - setup.stop_loss);
  if (!(risk > 0)) return null;
  const stop = dir === 'BUY' ? entry - risk : entry + risk;
  const target = dir === 'BUY' ? entry + risk * setup.risk_reward : entry - risk * setup.risk_reward;

  const end = Math.min(bars.length - 1, i + CONFIG.maxHoldBars);
  let resultR = dir === 'BUY' ? (bars[end].close - entry) / risk : (entry - bars[end].close) / risk;
  let exitReason = 'TIME';
  let exitIndex = end;

  for (let j = i + 1; j <= end; j += 1) {
    const bar = bars[j];
    const hitStop = dir === 'BUY' ? bar.low <= stop : bar.high >= stop;
    const hitTarget = dir === 'BUY' ? bar.high >= target : bar.low <= target;
    if (hitStop && hitTarget) {
      resultR = -1;
      exitReason = 'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE';
      exitIndex = j;
      break;
    }
    if (hitStop) {
      resultR = -1;
      exitReason = 'STOP';
      exitIndex = j;
      break;
    }
    if (hitTarget) {
      resultR = setup.risk_reward;
      exitReason = 'TARGET';
      exitIndex = j;
      break;
    }
  }

  return {
    signal_time: new Date((bars[i].time + 900) * 1000).toISOString(),
    direction: dir,
    result_r: resultR,
    exit_reason: exitReason,
    exit_time: new Date((bars[exitIndex].time + 900) * 1000).toISOString(),
    hold_bars: exitIndex - i
  };
}

function stats(trades) {
  const wins = trades.filter((t) => t.result_r > 0);
  const losses = trades.filter((t) => t.result_r < 0);
  const net = trades.reduce((s, t) => s + t.result_r, 0);
  const grossWin = wins.reduce((s, t) => s + t.result_r, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.result_r, 0));
  let equity = 0; let peak = 0; let maxDd = 0;
  for (const t of trades) {
    equity += t.result_r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const first = trades[0] ? Date.parse(trades[0].signal_time) : NaN;
  const last = trades.length ? Date.parse(trades[trades.length - 1].signal_time) : NaN;
  const weeks = Number.isFinite(first) && Number.isFinite(last) ? Math.max(1, (last - first) / 1000 / 86400 / 7) : 0;
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

async function main() {
  await fs.mkdir(CONFIG.outputDir, { recursive: true });
  let m15 = addIndicators(await fetchBars());
  const lower = Math.floor(Date.now() / 1000) - CONFIG.lookbackDays * 86400;
  m15 = m15.filter((b) => b.time >= lower);
  const h1 = addIndicators(aggregateH1(m15));
  const trades = [];
  let nextEligible = 0;
  let candidateCount = 0;
  const diagnostics = {
    evaluated: 0,
    h1_up: 0,
    h1_down: 0,
    h1_range: 0,
    setup_wait: 0,
    stop_wait: 0,
    reason_counts: {}
  };

  for (let i = 250; i < m15.length - 2; i += 1) {
    if (i < nextEligible) continue;
    const h1i = latestCompletedH1Index(h1, m15[i].time + 900);
    if (h1i < 200) continue;
    diagnostics.evaluated += 1;
    const f = buildFeatures(m15, i, h1, h1i);
    const setup = buildEurUsdTrendPullbackSetup(f, {
      minRetraceAtr: CONFIG.minRetraceAtr,
      maxRetraceAtr: CONFIG.maxRetraceAtr,
      minBodyAtr: CONFIG.minBodyAtr,
      minCloseLocation: CONFIG.minCloseLocation,
      buyRsiMin: CONFIG.buyRsiMin,
      buyRsiMax: CONFIG.buyRsiMax,
      sellRsiMin: CONFIG.sellRsiMin,
      sellRsiMax: CONFIG.sellRsiMax,
      maxSpreadPips: Math.max(CONFIG.spreadPips, 0.1)
    });
    if (setup.trend === 'UP') diagnostics.h1_up += 1;
    else if (setup.trend === 'DOWN') diagnostics.h1_down += 1;
    else diagnostics.h1_range += 1;
    if (setup.candidate === 'WAIT') {
      diagnostics.setup_wait += 1;
      for (const reason of (setup.reasons || [])) {
        diagnostics.reason_counts[reason] = (diagnostics.reason_counts[reason] || 0) + 1;
      }
      continue;
    }
    candidateCount += 1;
    const trade = simulateTrade(m15, i, setup);
    if (!trade) continue;
    trades.push(trade);
    nextEligible = i + Math.max(1, trade.hold_bars) + CONFIG.cooldownBars;
  }

  if (m15.length < 100000) throw new Error('Historical data coverage is unexpectedly low: only ' + m15.length + ' M15 bars after filtering. Refusing to call this a 5-year backtest.');

  const summary = {
    strategy: 'EURUSD M15 H1 Trend Pullback v1',
    lookback_days: CONFIG.lookbackDays,
    source_mode: String(process.env.PULLBACK_BACKTEST_SOURCE || 'dukascopy').toLowerCase(),
    source: String(process.env.PULLBACK_BACKTEST_SOURCE || 'dukascopy').toLowerCase() === 'dukascopy' ? 'Dukascopy historical EURUSD M15 bid data' : SOURCE,
    bars: m15.length,
    candidate_signals: candidateCount,
    assumptions: {
      spread_pips: CONFIG.spreadPips,
      slippage_pips: CONFIG.slippagePips,
      max_hold_bars: CONFIG.maxHoldBars,
      cooldown_bars: CONFIG.cooldownBars
    },
    parameters: {
      min_retrace_atr: CONFIG.minRetraceAtr,
      max_retrace_atr: CONFIG.maxRetraceAtr,
      min_body_atr: CONFIG.minBodyAtr,
      min_close_location: CONFIG.minCloseLocation,
      buy_rsi: [CONFIG.buyRsiMin, CONFIG.buyRsiMax],
      sell_rsi: [CONFIG.sellRsiMin, CONFIG.sellRsiMax]
    },
    statistics: stats(trades),
    diagnostics
  };

  await fs.writeFile(path.join(CONFIG.outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await fs.writeFile(path.join(CONFIG.outputDir, 'trades.csv'), [
    'signal_time,direction,result_r,exit_reason,exit_time,hold_bars',
    ...trades.map((t) => [t.signal_time, t.direction, t.result_r, t.exit_reason, t.exit_time, t.hold_bars].join(','))
  ].join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
