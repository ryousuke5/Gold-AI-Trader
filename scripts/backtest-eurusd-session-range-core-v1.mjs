import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildEurUsdSessionRangeCore } from '../src/eurusd_session_range_core_v1.js';

const C = {
  data: process.env.SESSION_CORE_DATA_FILE || 'eurusd-session-core-data/eurusd-m15.json.gz',
  out: process.env.SESSION_CORE_OUTPUT_DIR || 'eurusd-session-core-backtest-output',
  spread: Math.max(0, Number(process.env.SESSION_CORE_SPREAD_PIPS || 0.8)),
  slippage: Math.max(0, Number(process.env.SESSION_CORE_SLIPPAGE_PIPS || 0.1)),
  hold: Math.max(8, Number(process.env.SESSION_CORE_MAX_HOLD_BARS || 96)),
  maxEntryGapAtr: Math.max(0.1, Number(process.env.SESSION_CORE_MAX_ENTRY_GAP_ATR || 0.50)),
  minEffectiveRR: Math.max(0.5, Number(process.env.SESSION_CORE_MIN_EFFECTIVE_RR || 1.30)),
  breakoutStartUtc: Number(process.env.SESSION_CORE_BREAKOUT_START_UTC || 7),
  breakoutEndUtc: Number(process.env.SESSION_CORE_BREAKOUT_END_UTC || 15),
  minRangeAtr: Number(process.env.SESSION_CORE_MIN_RANGE_ATR || 0.30),
  maxRangeAtr: Number(process.env.SESSION_CORE_MAX_RANGE_ATR || 2.50),
  breakoutAtr: Number(process.env.SESSION_CORE_BREAKOUT_ATR || 0.05),
  breakoutBodyAtr: Number(process.env.SESSION_CORE_BREAKOUT_BODY_ATR || 0.20),
  breakoutCloseLocation: Number(process.env.SESSION_CORE_BREAKOUT_CLOSE_LOCATION || 0.60),
  maxRetestBars: Number(process.env.SESSION_CORE_MAX_RETEST_BARS || 4),
  retestToleranceAtr: Number(process.env.SESSION_CORE_RETEST_TOLERANCE_ATR || 0.25),
  confirmationBufferAtr: Number(process.env.SESSION_CORE_CONFIRMATION_BUFFER_ATR || 0.02),
  confirmationBodyAtr: Number(process.env.SESSION_CORE_CONFIRMATION_BODY_ATR || 0.10),
  stopBufferAtr: Number(process.env.SESSION_CORE_STOP_BUFFER_ATR || 0.15),
  minStopAtr: Number(process.env.SESSION_CORE_MIN_STOP_ATR || 0.40),
  maxStopAtr: Number(process.env.SESSION_CORE_MAX_STOP_ATR || 1.80),
  tpR: Number(process.env.SESSION_CORE_TP_R || 1.50),
  policyMask: process.env.SESSION_CORE_POLICY_MASK || '',
  policyMinConfidence: Number(process.env.SESSION_CORE_POLICY_MIN_CONFIDENCE || 0.65)
};

async function loadPolicyMask() {
  if (!C.policyMask) return [];
  const text = await fs.readFile(path.resolve(C.policyMask), 'utf8');
  const lines = text.replace(/^\\uFEFF/, '').trim().split(/\\r?\\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((x) => x.trim().toLowerCase());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  if (idx.timestamp === undefined || idx.bias === undefined || idx.confidence === undefined) {
    throw new Error('Policy mask requires timestamp,bias,confidence columns');
  }
  const out = [];
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    const time = Date.parse(String(c[idx.timestamp] || ''));
    const confidence = Number(c[idx.confidence]);
    if (!Number.isFinite(time) || !Number.isFinite(confidence)) continue;
    out.push({
      time: Math.floor(time / 1000),
      bias: String(c[idx.bias] || '').trim().toUpperCase(),
      confidence,
      environment: String(c[idx.environment] || '').trim().toUpperCase(),
      freshness: String(c[idx.freshness] || '').trim().toUpperCase()
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

function latestPolicyMask(mask, signalCloseTime) {
  if (!mask.length) return null;
  let lo = 0, hi = mask.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (mask[mid].time <= signalCloseTime) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? mask[best] : null;
}

function policyAllows(maskRow, side) {
  if (!maskRow) return { allowed: false, reason: 'policy_mask_missing' };
  if (maskRow.confidence < C.policyMinConfidence) return { allowed: false, reason: 'policy_confidence_low' };
  if (maskRow.freshness && maskRow.freshness !== 'CURRENT') return { allowed: false, reason: 'policy_not_current' };
  if (maskRow.bias === 'BULLISH_EURUSD' && side === 'BUY') return { allowed: true, reason: 'policy_aligned' };
  if (maskRow.bias === 'BEARISH_EURUSD' && side === 'SELL') return { allowed: true, reason: 'policy_aligned' };
  if (maskRow.bias === 'NEUTRAL') return { allowed: false, reason: 'policy_neutral' };
  return { allowed: false, reason: 'policy_conflict' };
}

async function loadBars() {
  const raw = await fs.readFile(path.resolve(C.data));
  const text = C.data.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length < 100000) throw new Error('Insufficient prepared EURUSD M15 data: ' + (rows?.length || 0));
  return rows.map((b) => ({
    time: Number(b.time), open: Number(b.open), high: Number(b.high), low: Number(b.low),
    close: Number(b.close), volume: Number(b.volume) || 0
  })).filter((b) =>
    Number.isFinite(b.time) && b.open > 0 &&
    b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close
  ).sort((a, b) => a.time - b.time);
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
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
  let avgGain = gain / period;
  let avgLoss = loss / period;
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
  let value = 0;
  for (let i = 1; i <= period; i += 1) value += tr[i];
  value /= period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function withIndicators(bars) {
  const closes = bars.map((b) => b.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const rr = rsi(closes, 14), aa = atr(bars, 14);
  return bars.map((b, i) => ({ ...b, ema20: e20[i], ema50: e50[i], ema200: e200[i], rsi14: rr[i], atr14: aa[i] }));
}

function aggregateH1(m15) {
  const map = new Map();
  for (const b of m15) {
    const h = Math.floor(b.time / 3600) * 3600;
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

function latestH1Index(h1, signalCloseTime) {
  let lo = 0, hi = h1.length - 1, best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (h1[mid].time + 3600 <= signalCloseTime) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function summarize(trades) {
  const rs = trades.map((t) => t.net_r);
  const wins = rs.filter((x) => x > 0);
  const losses = rs.filter((x) => x < 0);
  let equity = 0, peak = 0, maxDD = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, peak - equity);
  }
  const grossWin = wins.reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x, 0));
  return {
    trades: rs.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: rs.length ? wins.length / rs.length * 100 : 0,
    net_r: rs.reduce((s, x) => s + x, 0),
    expectancy_r: rs.length ? rs.reduce((s, x) => s + x, 0) / rs.length : 0,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    max_drawdown_r: maxDD
  };
}

function annual(trades) {
  const map = new Map();
  for (const t of trades) {
    const y = t.signal_time.slice(0, 4);
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(t);
  }
  return Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, summarize(v)]));
}

function simulate(bars, index, setup) {
  const next = bars[index + 1];
  if (!next) return null;
  const spread = C.spread * 0.0001;
  const slip = C.slippage * 0.0001;
  const side = setup.candidate;
  const entry = side === 'BUY'
    ? next.open + spread / 2 + slip
    : next.open - spread / 2 - slip;
  const stop = setup.stop_loss;
  const target = setup.take_profit;
  const stopDistance = Math.abs(entry - stop);
  const entryGapAtr = Math.abs(entry - setup.entry_reference) / Math.max(1e-9, bars[index].atr14);
  const effectiveRR = Math.abs(target - entry) / Math.max(1e-9, stopDistance);

  if (!(stopDistance > 0) || entryGapAtr > C.maxEntryGapAtr || effectiveRR < C.minEffectiveRR) return null;

  const end = Math.min(bars.length - 1, index + C.hold);
  let exitIndex = end;
  let exitReason = 'TIME';
  let exitPrice = side === 'BUY' ? bars[end].close : bars[end].close;

  for (let j = index + 1; j <= end; j += 1) {
    const b = bars[j];
    const stopHit = side === 'BUY' ? b.low - spread / 2 <= stop : b.high + spread / 2 >= stop;
    const targetHit = side === 'BUY' ? b.high - spread / 2 >= target : b.low + spread / 2 <= target;
    if (stopHit) {
      exitIndex = j;
      exitReason = 'STOP';
      exitPrice = side === 'BUY' ? stop - slip : stop + slip;
      break;
    }
    if (targetHit) {
      exitIndex = j;
      exitReason = 'TARGET';
      exitPrice = side === 'BUY' ? target - slip : target + slip;
      break;
    }
  }

  const netR = side === 'BUY'
    ? (exitPrice - entry) / stopDistance
    : (entry - exitPrice) / stopDistance;

  return {
    signal_time: new Date((bars[index].time + 900) * 1000).toISOString(),
    entry_time: new Date(next.time * 1000).toISOString(),
    exit_time: new Date(bars[exitIndex].time * 1000).toISOString(),
    side,
    net_r: netR,
    exit_reason: exitReason,
    entry_gap_atr: entryGapAtr,
    effective_rr: effectiveRR,
    breakout_time: setup.diagnostics?.breakout_time ?? null,
    range_atr: setup.diagnostics?.range_atr ?? null,
    stop_atr: setup.diagnostics?.stop_atr ?? null
  };
}

async function main() {
  await fs.mkdir(C.out, { recursive: true });
  const raw = await loadBars();
  const policyMask = await loadPolicyMask();
  const m15 = withIndicators(raw);
  const h1 = withIndicators(aggregateH1(m15));
  const trades = [];
  const policyTrades = [];
  const diagnostics = { evaluated: 0, candidates: 0, executed: 0, rejected_execution: 0, wait_reasons: {}, policy_candidates: 0, policy_executed: 0, policy_rejected: 0, policy_reject_reasons: {} };
  let nextAvailable = 0;
  let policyNextAvailable = 0;

  for (let i = 250; i < m15.length - 1; i += 1) {
    if (i < nextAvailable && (!policyMask.length || i < policyNextAvailable)) continue;
    const signal = m15[i];
    if (![signal.ema20, signal.ema50, signal.atr14].every(Number.isFinite)) continue;
    const h1Index = latestH1Index(h1, signal.time + 900);
    const h = h1[h1Index];
    if (!h || ![h.close, h.ema20, h.ema50, h.ema200].every(Number.isFinite)) continue;

    diagnostics.evaluated += 1;
    const feature = {
      bid: signal.close - (C.spread * 0.0001) / 2,
      ask: signal.close + (C.spread * 0.0001) / 2,
      spread: C.spread * 0.0001,
      barTime: signal.time + 900,
      m15: { atr14: signal.atr14 },
      h1: { close: h.close, ema20: h.ema20, ema50: h.ema50, ema200: h.ema200 },
      recentM15: m15.slice(Math.max(0, i - 79), i + 1).map((b) => ({ ...b, time: b.time + 900 })),
    };

    const setup = buildEurUsdSessionRangeCore(feature, {
      breakoutStartUtc: C.breakoutStartUtc,
      breakoutEndUtc: C.breakoutEndUtc,
      minRangeAtr: C.minRangeAtr,
      maxRangeAtr: C.maxRangeAtr,
      breakoutAtr: C.breakoutAtr,
      breakoutBodyAtr: C.breakoutBodyAtr,
      breakoutCloseLocation: C.breakoutCloseLocation,
      maxRetestBars: C.maxRetestBars,
      retestToleranceAtr: C.retestToleranceAtr,
      confirmationBufferAtr: C.confirmationBufferAtr,
      confirmationBodyAtr: C.confirmationBodyAtr,
      stopBufferAtr: C.stopBufferAtr,
      minStopAtr: C.minStopAtr,
      maxStopAtr: C.maxStopAtr,
      takeProfitR: C.tpR,
      maxSpreadPips: Math.max(C.spread, 1.2),
      maxSpreadAtrPct: 20
    });

    if (setup.candidate === 'WAIT') {
      for (const reason of setup.reasons || []) {
        diagnostics.wait_reasons[reason] = (diagnostics.wait_reasons[reason] || 0) + 1;
      }
      continue;
    }

    diagnostics.candidates += 1;

    if (i >= nextAvailable) {
      const trade = simulate(m15, i, setup);
      if (!trade) {
        diagnostics.rejected_execution += 1;
      } else {
        diagnostics.executed += 1;
        trades.push(trade);
        const exitIndex = m15.findIndex((b) => b.time === Date.parse(trade.exit_time) / 1000);
        nextAvailable = exitIndex >= 0 ? Math.min(m15.length, exitIndex + 1) : i + 2;
      }
    }

    if (policyMask.length && i >= policyNextAvailable) {
      diagnostics.policy_candidates += 1;
      const policy = policyAllows(latestPolicyMask(policyMask, signal.time + 900), setup.candidate);
      if (!policy.allowed) {
        diagnostics.policy_rejected += 1;
        diagnostics.policy_reject_reasons[policy.reason] = (diagnostics.policy_reject_reasons[policy.reason] || 0) + 1;
      } else {
        const policyTrade = simulate(m15, i, setup);
        if (!policyTrade) {
          diagnostics.policy_rejected += 1;
          diagnostics.policy_reject_reasons.execution_simulation_failed =
            (diagnostics.policy_reject_reasons.execution_simulation_failed || 0) + 1;
        } else {
          policyTrades.push(policyTrade);
          diagnostics.policy_executed += 1;
          const policyExitIndex = m15.findIndex(
            (b) => b.time === Date.parse(policyTrade.exit_time) / 1000
          );
          policyNextAvailable = policyExitIndex >= 0
            ? Math.min(m15.length, policyExitIndex + 1)
            : i + 2;
        }
      }
    }
  }

  const endTime = m15.at(-1).time;
  const oosCutoff = endTime - 730 * 86400;
  const oos = trades.filter((t) => Date.parse(t.signal_time) / 1000 >= oosCutoff);
  const policyOos = policyTrades.filter((t) => Date.parse(t.signal_time) / 1000 >= oosCutoff);
  const report = {
    schema_version: 1,
    strategy: 'EURUSD UTC session range breakout-retest V1',
    data: {
      bars: m15.length,
      first_utc: new Date(m15[0].time * 1000).toISOString(),
      last_utc: new Date(m15.at(-1).time * 1000).toISOString(),
      source: C.data
    },
    execution: {
      spread_pips: C.spread,
      slippage_pips: C.slippage,
      max_hold_bars: C.hold,
      max_entry_gap_atr: C.maxEntryGapAtr,
      min_effective_rr: C.minEffectiveRR
    },
    parameters: {
      breakout_session_utc: [C.breakoutStartUtc, C.breakoutEndUtc],
      min_range_atr: C.minRangeAtr,
      max_range_atr: C.maxRangeAtr,
      breakout_atr: C.breakoutAtr,
      breakout_body_atr: C.breakoutBodyAtr,
      breakout_close_location: C.breakoutCloseLocation,
      max_retest_bars: C.maxRetestBars,
      retest_tolerance_atr: C.retestToleranceAtr,
      confirmation_buffer_atr: C.confirmationBufferAtr,
      confirmation_body_atr: C.confirmationBodyAtr,
      stop_buffer_atr: C.stopBufferAtr,
      min_stop_atr: C.minStopAtr,
      max_stop_atr: C.maxStopAtr,
      take_profit_r: C.tpR
    },
    overall: summarize(trades),
    recent_730_days: summarize(oos),
    policy_filtered_overall: policyMask.length ? summarize(policyTrades) : null,
    policy_filtered_recent_730_days: policyMask.length ? summarize(policyOos) : null,
    policy_mask: policyMask.length ? { file: C.policyMask, rows: policyMask.length, min_confidence: C.policyMinConfidence } : null,
    annual: annual(trades),
    policy_filtered_annual: policyMask.length ? annual(policyTrades) : null,
    diagnostics
  };

  await fs.writeFile(path.join(C.out, 'summary.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(C.out, 'trades.csv'), [
    'signal_time,entry_time,exit_time,side,net_r,exit_reason,entry_gap_atr,effective_rr,breakout_time,range_atr,stop_atr',
    ...trades.map((t) => [t.signal_time, t.entry_time, t.exit_time, t.side, t.net_r, t.exit_reason, t.entry_gap_atr, t.effective_rr, t.breakout_time, t.range_atr, t.stop_atr].join(','))
  ].join('\n') + '\n');

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
