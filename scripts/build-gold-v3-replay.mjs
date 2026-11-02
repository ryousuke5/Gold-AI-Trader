import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { buildGoldV2Setup } from '../src/gold_strategy_v2.js';
import { buildGoldV3Setup } from '../src/gold_strategy_v3.js';

const INPUT = process.env.GOLD_V3_BACKTEST_DATA_FILE || process.env.GOLD_BACKTEST_DATA_FILE;
const OUT = path.resolve(process.env.GOLD_V3_REPLAY_OUTPUT_DIR || 'gold-v3-replay');
const COSTS = {
  baseline: {
    spreadPrice: Math.max(0, Number(process.env.GOLD_V3_BASE_SPREAD_PRICE ?? 0.55)),
    slippagePrice: Math.max(0, Number(process.env.GOLD_V3_BASE_SLIPPAGE_PRICE ?? 0.05))
  },
  stress: {
    spreadPrice: Math.max(0, Number(process.env.GOLD_V3_STRESS_SPREAD_PRICE ?? 0.75)),
    slippagePrice: Math.max(0, Number(process.env.GOLD_V3_STRESS_SLIPPAGE_PRICE ?? 0.10))
  }
};
const MAX_HOLD_BARS = Math.max(1, Math.floor(Number(process.env.GOLD_V3_MAX_HOLD_BARS || 96)));
const MAX_ENTRY_GAP_ATR = Math.max(0.1, Number(process.env.GOLD_V3_MAX_ENTRY_GAP_ATR || 0.50));
function parseUtcBoundary(name) {
  const value = process.env[name];
  if (!value) return null;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error(name + ' must include an explicit UTC marker (Z) or ISO-8601 offset.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(name + ' must be a valid ISO-8601 date/time.');
  return parsed / 1000;
}
const START_UTC = parseUtcBoundary('GOLD_V3_START_UTC');
const END_UTC = parseUtcBoundary('GOLD_V3_END_UTC');
if (START_UTC !== null && END_UTC !== null && END_UTC <= START_UTC) {
  throw new Error('GOLD_V3_END_UTC must be later than GOLD_V3_START_UTC.');
}
const V3_CONFIG = {
  swingLeftBars: 1,
  swingRightBars: 1,
  minImpulseBars: 3,
  maxImpulseBars: 30,
  minImpulseAtr: 0.8,
  retracementMin: 0.236,
  retracementMax: 0.618,
  pullbackLookbackBars: 3,
  minBodyAtr: 0.20,
  stopLookbackBars: 5,
  stopBufferAtr: 0.10,
  minStopAtr: 0.25,
  maxStopAtr: 1.80,
  maxExtensionAtr: 1.75,
  sessionStartUtc: 7,
  sessionEndUtc: 20
};
const V2_CONFIG = {
  rangeLookback: 12,
  minRangeAtr: 0.80,
  maxRangeAtr: 2.80,
  breakoutAtr: 0.10,
  minBodyAtr: 0.40,
  minCloseLocation: 0.65,
  minVolumeRatio: 1.10,
  sessionStartUtc: 7,
  sessionEndUtc: 20
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function ema(values, period) {
  const output = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let current = null;
  for (let i = 0; i < values.length; i++) {
    const value = Number(values[i]);
    if (!Number.isFinite(value)) continue;
    current = current === null ? value : alpha * value + (1 - alpha) * current;
    output[i] = current;
  }
  return output;
}
function rsi(closes, period) {
  const output = new Array(closes.length).fill(null);
  if (closes.length <= period) return output;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    gain += Math.max(0, delta);
    loss += Math.max(0, -delta);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  output[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, delta)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -delta)) / period;
    output[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return output;
}
function atr(bars, period) {
  const output = new Array(bars.length).fill(null);
  if (bars.length <= period) return output;
  const trueRanges = bars.map((bar, index) => index === 0
    ? bar.high - bar.low
    : Math.max(bar.high - bar.low,
      Math.abs(bar.high - bars[index - 1].close),
      Math.abs(bar.low - bars[index - 1].close)));
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRanges[i];
  let current = sum / period;
  output[period] = current;
  for (let i = period + 1; i < bars.length; i++) {
    current = (current * (period - 1) + trueRanges[i]) / period;
    output[i] = current;
  }
  return output;
}
function addIndicators(bars) {
  const closes = bars.map((bar) => bar.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(bars, 14);
  return bars.map((bar, index) => ({
    ...bar,
    ema20: ema20[index],
    ema50: ema50[index],
    ema200: ema200[index],
    rsi14: rsi14[index],
    atr14: atr14[index]
  }));
}
function aggregateCompleteH1(m5Bars) {
  const buckets = new Map();
  for (const bar of m5Bars) {
    const hour = Math.floor(bar.time / 3600) * 3600;
    const group = buckets.get(hour) || [];
    group.push(bar);
    buckets.set(hour, group);
  }
  const hourly = [];
  for (const [time, group] of buckets) {
    if (group.length !== 12) continue;
    let contiguous = true;
    for (let i = 1; i < group.length; i++) {
      if (group[i].time - group[i - 1].time !== 300) contiguous = false;
    }
    if (!contiguous || group[0].time !== time || group.at(-1).time !== time + 3300) continue;
    hourly.push({
      time,
      open: group[0].open,
      high: Math.max(...group.map((bar) => bar.high)),
      low: Math.min(...group.map((bar) => bar.low)),
      close: group.at(-1).close,
      volume: group.reduce((sum, bar) => sum + bar.volume, 0)
    });
  }
  hourly.sort((a, b) => a.time - b.time);
  return addIndicators(hourly);
}
function findClosedH1Index(hourly, m5CloseTime) {
  let low = 0;
  let high = hourly.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (hourly[middle].time + 3600 <= m5CloseTime) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
function parseBar(item) {
  return {
    time: Number(item.time),
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close: Number(item.close),
    volume: Number(item.volume ?? item.tick_volume ?? 0) || 0
  };
}
async function loadBars() {
  if (!INPUT) throw new Error('Set GOLD_V3_BACKTEST_DATA_FILE to a UTC-epoch-seconds M5 OHLCV JSON or JSON.GZ file.');
  const raw = await fs.readFile(path.resolve(INPUT));
  const decoded = INPUT.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const parsed = JSON.parse(decoded);
  const source = Array.isArray(parsed) ? parsed : (parsed.bars || parsed.data);
  if (!Array.isArray(source)) throw new Error('Input JSON must be an array or contain a bars/data array.');
  const seen = new Set();
  const bars = [];
  let invalid = 0;
  let duplicates = 0;
  for (const item of source) {
    const bar = parseBar(item);
    if (!Number.isInteger(bar.time) || bar.time < 1_000_000_000 || bar.time > 4_000_000_000 ||
        bar.time % 300 !== 0 ||
        ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) ||
        !(bar.open > 0) || !(bar.high >= bar.low && bar.high >= bar.open && bar.high >= bar.close &&
          bar.low <= bar.open && bar.low <= bar.close)) {
      invalid++;
      continue;
    }
    if (seen.has(bar.time)) {
      duplicates++;
      continue;
    }
    seen.add(bar.time);
    bars.push(bar);
  }
  bars.sort((a, b) => a.time - b.time);
  if (bars.length < 1000) throw new Error('Insufficient valid M5 bars: ' + bars.length);
  if (bars.some((bar, index) => index > 0 && bar.time <= bars[index - 1].time)) {
    throw new Error('M5 timestamps are not strictly increasing after deduplication.');
  }
  return { bars, invalid, duplicates, rawBytes: raw.length };
}
function recentBars(bars, index, count = 64) {
  return bars.slice(Math.max(0, index - count + 1), index + 1)
    .map((bar) => ({ ...bar, time: bar.time + 300 }));
}
function buildFeatures(m5Bars, hourly, index) {
  const current = m5Bars[index];
  const h1Index = findClosedH1Index(hourly, current.time + 300);
  const h1 = hourly[h1Index];
  if (!h1) return null;
  const recentM5 = recentBars(m5Bars, index, 64);
  return {
    barTime: current.time + 300,
    m5: {
      ema20: current.ema20,
      ema50: current.ema50,
      rsi14: current.rsi14,
      atr14: current.atr14,
      high20: null,
      low20: null
    },
    h1: {
      close: h1.close,
      ema20: h1.ema20,
      ema50: h1.ema50,
      ema200: h1.ema200,
      rsi14: h1.rsi14,
      atr14: h1.atr14
    },
    recentM5
  };
}
function simulateTrade({ bars, signalIndex, setup, costs }) {
  const signal = bars[signalIndex];
  const next = bars[signalIndex + 1];
  if (!next || next.time - signal.time !== 300) return { traded: false, reason: 'missing_or_noncontiguous_next_bar' };
  const entryGapAtr = Math.abs(next.open - signal.close) / Math.max(1e-9, Number(signal.atr14));
  if (!Number.isFinite(entryGapAtr) || entryGapAtr > MAX_ENTRY_GAP_ATR) {
    return { traded: false, reason: 'next_bar_entry_gap', entry_gap_atr: entryGapAtr };
  }
  const side = setup.candidate;
  const entry = side === 'BUY'
    ? next.open + costs.spreadPrice + costs.slippagePrice
    : next.open - costs.slippagePrice;
  const stop = Number(setup.stop_loss);
  const riskDistance = side === 'BUY' ? entry - stop : stop - entry;
  if (!(entry > 0 && stop > 0 && riskDistance > 0)) {
    return { traded: false, reason: 'invalid_fill_stop_geometry', entry, stop };
  }
  // RR is anchored to the simulated fill, not the previous candle close.
  const target = side === 'BUY'
    ? entry + 2 * riskDistance
    : entry - 2 * riskDistance;
  const scanEnd = Math.min(bars.length, signalIndex + 1 + MAX_HOLD_BARS);
  let exitIndex = scanEnd - 1;
  let exitReason = 'TIME';
  let exitPrice;
  for (let i = signalIndex + 1; i < scanEnd; i++) {
    const bar = bars[i];
    const previous = bars[i - 1];
    if (i > signalIndex + 1 && bar.time - previous.time > 900) {
      exitIndex = i - 1;
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
    // Stop-first is deliberately conservative when both levels occur in one M5 bar.
    if (stopHit) {
      exitIndex = i;
      exitReason = 'STOP';
      exitPrice = side === 'BUY'
        ? stop - costs.slippagePrice
        : stop + costs.spreadPrice + costs.slippagePrice;
      break;
    }
    if (targetHit) {
      exitIndex = i;
      exitReason = 'TARGET';
      exitPrice = side === 'BUY'
        ? target - costs.slippagePrice
        : target + costs.spreadPrice + costs.slippagePrice;
      break;
    }
  }
  if (!Number.isFinite(exitPrice)) {
    const last = bars[exitIndex];
    exitPrice = side === 'BUY'
      ? last.close - costs.slippagePrice
      : last.close + costs.spreadPrice + costs.slippagePrice;
  }
  const netR = side === 'BUY'
    ? (exitPrice - entry) / riskDistance
    : (entry - exitPrice) / riskDistance;
  return {
    traded: true,
    side,
    entry_time: next.time,
    exit_time: bars[exitIndex].time + 300,
    entry,
    stop,
    target_fill_anchored: target,
    risk_price: riskDistance,
    nominal_rr: 2.0,
    entry_gap_atr: entryGapAtr,
    exit_reason: exitReason,
    exit_price: exitPrice,
    net_r: netR,
    exit_index: exitIndex,
    spread_price: costs.spreadPrice,
    slippage_each_side_price: costs.slippagePrice
  };
}

const { bars: rawBars, invalid, duplicates, rawBytes } = await loadBars();
const startIndex = START_UTC === null ? 0 : rawBars.findIndex((bar) => bar.time >= START_UTC);
const endIndex = END_UTC === null ? rawBars.length : rawBars.findIndex((bar) => bar.time >= END_UTC);
const from = Math.max(250, startIndex < 0 ? rawBars.length : startIndex);
const to = endIndex < 0 ? rawBars.length : endIndex;
if (!(to > from + 100)) throw new Error('Selected V3 replay window is too short or outside the input data.');
const m5 = addIndicators(rawBars);
const h1 = aggregateCompleteH1(rawBars);
const sourceFingerprint = sha256(rawBars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].join('|')).join('\n'));
await fs.mkdir(OUT, { recursive: true });
const outputFile = path.join(OUT, 'gold_v3_frequency_replay.jsonl');
const manifestFile = path.join(OUT, 'manifest.json');
const handle = await fs.open(outputFile, 'w');
let v2Candidates = 0;
let v3Candidates = 0;
let baselineTrades = 0;
let stressTrades = 0;
let baselineBusyUntil = -1;
let stressBusyUntil = -1;
let rowsWritten = 0;
let firstEvaluatedAsOf = null;
let lastEvaluatedAsOf = null;
try {
  for (let i = from; i < to - 1; i++) {
    const current = m5[i];
    const asofTime = current.time + 300;
    if (START_UTC !== null && asofTime < START_UTC) continue;
    if (END_UTC !== null && asofTime >= END_UTC) continue;
    if (![current.ema20, current.ema50, current.rsi14, current.atr14].every(Number.isFinite)) continue;
    const features = buildFeatures(m5, h1, i);
    if (!features || ![features.h1.close, features.h1.ema20, features.h1.ema50,
      features.h1.ema200, features.h1.rsi14, features.h1.atr14].every(Number.isFinite)) continue;
    if (firstEvaluatedAsOf === null) firstEvaluatedAsOf = asofTime;
    lastEvaluatedAsOf = asofTime;

    const v2 = buildGoldV2Setup(features, V2_CONFIG);
    if (v2?.candidate === 'BUY' || v2?.candidate === 'SELL') v2Candidates++;

    const setup = buildGoldV3Setup(features, V3_CONFIG);
    if (setup?.candidate !== 'BUY' && setup?.candidate !== 'SELL') continue;
    v3Candidates++;

    const baseline = i > baselineBusyUntil
      ? simulateTrade({ bars: m5, signalIndex: i, setup, costs: COSTS.baseline })
      : { traded: false, reason: 'position_open' };
    const stress = i > stressBusyUntil
      ? simulateTrade({ bars: m5, signalIndex: i, setup, costs: COSTS.stress })
      : { traded: false, reason: 'position_open' };
    if (baseline.traded) {
      baselineBusyUntil = baseline.exit_index;
      baselineTrades++;
    }
    if (stress.traded) {
      stressBusyUntil = stress.exit_index;
      stressTrades++;
    }
    const record = {
      schema_version: 1,
      strategy_version: 'gold-h1-m5-expanded-pullback-reaccel-v3',
      candidate_id: sha256([sourceFingerprint, current.time + 300, setup.candidate,
        setup.entry_reference, setup.stop_loss].join('|')).slice(0, 24),
      asof_time: current.time + 300,
      asof_iso: new Date((current.time + 300) * 1000).toISOString(),
      symbol: 'XAUUSD',
      candidate: setup.candidate,
      setup,
      execution: { baseline, stress }
    };
    await handle.write(JSON.stringify(record) + '\n');
    rowsWritten++;
  }
} finally {
  await handle.close();
}

const manifest = {
  schema_version: 1,
  strategy_version: 'gold-h1-m5-expanded-pullback-reaccel-v3',
  created_at: new Date().toISOString(),
  source_data: {
    path: path.resolve(INPUT),
    label: process.env.GOLD_V3_DATA_SOURCE_LABEL || 'user-supplied-ohlc',
    rows: rawBars.length,
    invalid_rows_skipped: invalid,
    duplicate_timestamps_skipped: duplicates,
    input_bytes: rawBytes,
    content_sha256: sourceFingerprint,
    timestamp_requirement: 'UTC Unix epoch seconds; server-local MT4 timestamps must be DST-normalized before replay'
  },
  period: {
    requested_start_utc: START_UTC === null ? null : new Date(START_UTC * 1000).toISOString(),
    requested_end_utc_exclusive: END_UTC === null ? null : new Date(END_UTC * 1000).toISOString(),
    source_start_utc: new Date(rawBars[0].time * 1000).toISOString(),
    source_end_utc_exclusive: new Date((rawBars.at(-1).time + 300) * 1000).toISOString(),
    first_evaluated_signal_close_utc: firstEvaluatedAsOf === null ? null : new Date(firstEvaluatedAsOf * 1000).toISOString(),
    last_evaluated_signal_close_utc: lastEvaluatedAsOf === null ? null : new Date(lastEvaluatedAsOf * 1000).toISOString()
  },
  h1_aggregation: 'complete twelve-bar M5 hours only; last fully closed H1 candle is used',
  v2_comparison: {
    candidate_count_only: true,
    config: V2_CONFIG,
    candidate_count: v2Candidates,
    note: 'V2 source/config are imported read-only; no V2 parameters or production files are changed.'
  },
  v3: {
    config: V3_CONFIG,
    risk_reward: 2.0,
    one_open_position_per_cost_scenario: true,
    max_hold_bars: MAX_HOLD_BARS,
    max_entry_gap_atr: MAX_ENTRY_GAP_ATR,
    candidate_count: v3Candidates,
    baseline_trade_count: baselineTrades,
    stress_trade_count: stressTrades
  },
  cost_scenarios: COSTS,
  safety_scope: {
    research_only: true,
    production_v2_changed: false,
    render_changed: false,
    supabase_changed: false,
    mt4_ea_changed: false,
    live_orders_enabled: false,
    live_spread_gate_changed: false,
    live_gate_note: 'The current 0.50 live spread gate is not changed or overridden by this replay.'
  },
  output: outputFile,
  rows_written: rowsWritten
};
await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
