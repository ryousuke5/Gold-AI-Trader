import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEurUsdSetup } from '../src/eurusd_features.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  startDate: process.env.BACKTEST_START || '',
  endDate: process.env.BACKTEST_END || '',
  lookbackDays: Math.max(30, Number(process.env.BACKTEST_LOOKBACK_DAYS || 730)),
  initialEquity: Math.max(1000, Number(process.env.BACKTEST_INITIAL_EQUITY || 100000)),
  riskPct: Math.max(0.01, Number(process.env.BACKTEST_RISK_PCT || 0.25)),
  spreadPips: Math.max(0, Number(process.env.BACKTEST_SPREAD_PIPS || 0.8)),
  slippagePips: Math.max(0, Number(process.env.BACKTEST_SLIPPAGE_PIPS || 0.1)),
  minStopAtr: Math.max(0.1, Number(process.env.BACKTEST_MIN_STOP_ATR || 0.50)),
  maxStopAtr: Math.max(0.2, Number(process.env.BACKTEST_MAX_STOP_ATR || 1.50)),
  minRR: Math.max(1.0, Number(process.env.BACKTEST_MIN_RR || 1.80)),
  maxSpreadPips: Math.max(0.1, Number(process.env.BACKTEST_MAX_SPREAD_PIPS || 1.20)),
  maxSpreadToTpPct: Math.max(1, Number(process.env.BACKTEST_MAX_SPREAD_TO_TP_PCT || 12)),
  frequencyMode: String(process.env.BACKTEST_FREQUENCY_MODE || 'high-quality'),
  targetTradesPerWeek: Math.max(0, Number(process.env.BACKTEST_TARGET_TRADES_PER_WEEK || 1)),
  rangeLookback: Math.max(4, Number(process.env.BACKTEST_RANGE_LOOKBACK || 6)),
  minRangeAtr: Math.max(0.1, Number(process.env.BACKTEST_MIN_RANGE_ATR || 0.75)),
  maxRangeAtr: Math.max(0.2, Number(process.env.BACKTEST_MAX_RANGE_ATR || 2.00)),
  breakoutMinAtr: Math.max(0.02, Number(process.env.BACKTEST_BREAKOUT_MIN_ATR || 0.10)),
  breakoutMinBodyAtr: Math.max(0.05, Number(process.env.BACKTEST_BREAKOUT_MIN_BODY_ATR || 0.35)),
  breakoutMinCloseLocation: Math.min(0.99, Math.max(0.5, Number(process.env.BACKTEST_BREAKOUT_MIN_CLOSE_LOCATION || 0.70))),
  breakoutBuyRsiMin: Math.max(1, Number(process.env.BACKTEST_BREAKOUT_BUY_RSI_MIN || 50)),
  breakoutBuyRsiMax: Math.min(99, Number(process.env.BACKTEST_BREAKOUT_BUY_RSI_MAX || 68)),
  breakoutSellRsiMin: Math.max(1, Number(process.env.BACKTEST_BREAKOUT_SELL_RSI_MIN || 32)),
  breakoutSellRsiMax: Math.min(99, Number(process.env.BACKTEST_BREAKOUT_SELL_RSI_MAX || 50)),
  fundamentalSource: process.env.BACKTEST_FUNDAMENTAL_SOURCE || '',
  minAiEnvironmentConfidence: Math.min(1, Math.max(0.5, Number(process.env.BACKTEST_MIN_AI_ENVIRONMENT_CONFIDENCE || process.env.BACKTEST_MIN_FUNDAMENTAL_CONFIDENCE || 0.65))),
  maxFundamentalAgeHours: Math.max(1, Number(process.env.BACKTEST_MAX_FUNDAMENTAL_AGE_HOURS || 48)),
  minLot: 0.01,
  maxLot: 100,
  lotStep: 0.01
};

const SOURCES = {
  m15: process.env.BACKTEST_M15_SOURCE || 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDm15.csv',
  h1: process.env.BACKTEST_H1_SOURCE || 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDh1.csv'
};

function parseTimestamp(raw) {
  const s = String(raw || '').trim().replace(/^"|"$/g, '');
  if (!s) return NaN;
  if (/^\d{8}(?:\s|T)?\d{6}$/.test(s)) {
    const digits = s.replace(/\D/g, '');
    const iso = `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}T${digits.slice(8,10)}:${digits.slice(10,12)}:${digits.slice(12,14)}Z`;
    return Date.parse(iso);
  }
  if (/^\d{8}$/.test(s)) {
    const iso = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`;
    return Date.parse(iso);
  }
  const normalized = s.replace(/\./g, '-').replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : normalized + 'Z';
  return Date.parse(withZone);
}

function splitCsvLine(line) {
  if (line.includes(';') && !line.includes(',')) return line.split(';');
  return line.split(',');
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((x) => x.trim().replace(/^"|"$/g, '').toLowerCase());
  let idx = Object.fromEntries(header.map((h, i) => [h, i]));
  let dateKey = ['datetime', 'date', 'time', 'timestamp', 'timestamp_utc'].find((key) => idx[key] !== undefined) || header[0];
  let startLine = 1;

  const headerLooksLikeData =
    header.length >= 5 &&
    Number.isFinite(parseTimestamp(header[0])) &&
    header.slice(1, 5).every((value) => Number.isFinite(Number(value)));

  if (headerLooksLikeData) {
    idx = { datetime: 0, open: 1, high: 2, low: 3, close: 4, volume: 5 };
    dateKey = 'datetime';
    startLine = 0;
  }

  const required = [dateKey, 'open', 'high', 'low', 'close'];
  for (const key of required) if (idx[key] === undefined) {
    console.log('CSV header:', JSON.stringify(header));
    throw new Error(`CSV missing column: ${key}`);
  }

  const rows = [];
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = splitCsvLine(line);
    const rawClose = Number(cells[idx.close]);
    if (!Number.isFinite(rawClose) || rawClose <= 0) continue;
    const priceScale = rawClose > 10 ? 100000 : 1;
    const parsePrice = (k) => Number(cells[idx[k]]) / priceScale;
    const rawTime = String(cells[idx[dateKey]]).trim();
    const time = parseTimestamp(rawTime);
    if (!Number.isFinite(time)) continue;
    const open = parsePrice('open');
    const high = parsePrice('high');
    const low = parsePrice('low');
    const close = parsePrice('close');
    if (!(open > 0 && high >= low && high >= open && high >= close && low <= open && low <= close)) continue;
    rows.push({
      time: Math.floor(time / 1000),
      open,
      high,
      low,
      close,
      volume: idx.volume !== undefined ? Number(cells[idx.volume]) || 0 : 0
    });
  }
  rows.sort((a, b) => a.time - b.time);
  const out = [];
  let prev = -Infinity;
  for (const row of rows) {
    if (row.time === prev) continue;
    out.push(row);
    prev = row.time;
  }
  return out;
}

async function fetchText(url) {
  if (typeof url === 'string' && !/^https?:\/\//i.test(url)) {
    return await fs.readFile(url, 'utf8');
  }
  const res = await fetch(url, { headers: { 'user-agent': 'Gold-AI-Trader-backtest/1.0' } });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  return await res.text();
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length === 0 || period <= 0) return out;
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gainSum += Math.max(0, change);
    lossSum += Math.max(0, -change);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

function atr(bars, period) {
  const out = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr = new Array(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) tr[i] = bars[i].high - bars[i].low;
    else tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let value = sum / period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i++) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function addIndicators(bars) {
  const closes = bars.map((b) => b.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(bars, 14);
  return bars.map((bar, i) => ({
    ...bar,
    ema20: ema20[i],
    ema50: ema50[i],
    ema200: ema200[i],
    rsi14: rsi14[i],
    atr14: atr14[i]
  }));
}

function aggregateM15ToH1(m15) {
  const buckets = new Map();
  for (const bar of m15) {
    const hour = Math.floor(bar.time / 3600) * 3600;
    const current = buckets.get(hour);
    if (!current) {
      buckets.set(hour, {
        time: hour,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      });
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function latestCompletedH1Index(h1WithIndicators, signalTime) {
  const target = signalTime - 3600;
  let lo = 0;
  let hi = h1WithIndicators.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (h1WithIndicators[mid].time <= target) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function sliceRecentBars(bars, index, count = 80) {
  return bars.slice(Math.max(0, index - count + 1), index + 1).map((b) => ({
    time: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume
  }));
}

export function parseFundamentalCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((x) => x.trim().replace(/^"|"$/g, '').toLowerCase());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const timeKey = ['timestamp', 'datetime', 'date', 'time'].find((key) => idx[key] !== undefined);
  const required = [timeKey, 'environment', 'confidence', 'freshness', 'event_risk_next_24h'];
  if (!timeKey || required.some((key) => idx[key] === undefined)) {
    throw new Error('AI environment CSV requires timestamp,environment,confidence,freshness,event_risk_next_24h columns');
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const t = parseTimestamp(cells[idx[timeKey]]);
    const confidence = Number(cells[idx.confidence]);
    if (!Number.isFinite(t) || !Number.isFinite(confidence)) continue;
    rows.push({
      time: Math.floor(t / 1000),
      environment: String(cells[idx.environment] || '').trim().toUpperCase(),
      confidence,
      freshness: String(cells[idx.freshness] || '').trim().toUpperCase(),
      event_risk_next_24h: String(cells[idx.event_risk_next_24h] || '').trim().toUpperCase()
    });
  }
  rows.sort((a, b) => a.time - b.time);
  return rows;
}

export function latestFundamentalAssessment(mask, signalTime, maxAgeHours = 48) {
  if (!mask?.length) return null;
  const cutoff = signalTime - Math.max(1, Number(maxAgeHours)) * 3600;
  let lo = 0;
  let hi = mask.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mask[mid].time <= signalTime) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0 || mask[best].time < cutoff) return null;
  return mask[best];
}

export function fundamentalGate(setup, assessment, config) {
  if (setup.candidate === 'WAIT') return { allowed: false, reason: 'technical_wait' };
  if (!assessment) return { allowed: false, reason: 'ai_environment_missing_or_stale' };
  if (assessment.confidence < config.minAiEnvironmentConfidence) {
    return { allowed: false, reason: 'ai_environment_confidence_below_threshold' };
  }
  if (!['CURRENT', 'MIXED'].includes(assessment.freshness)) {
    return { allowed: false, reason: 'ai_environment_not_current' };
  }
  if (assessment.event_risk_next_24h === 'HIGH') {
    return { allowed: false, reason: 'high_impact_event_next_24h' };
  }
  if (assessment.event_risk_next_24h === 'UNKNOWN') {
    return { allowed: false, reason: 'event_risk_unknown' };
  }
  if (assessment.environment !== 'FAVORABLE') {
    return { allowed: false, reason: 'ai_environment_not_favorable' };
  }
  return { allowed: true, reason: 'ai_environment_confirmed' };
}

function floorLot(raw, minLot = 0.01, maxLot = 100, lotStep = 0.01) {
  if (!(raw > 0)) return 0;
  const stepped = Math.floor((raw + 1e-12) / lotStep) * lotStep;
  if (stepped < minLot - 1e-12) return 0;
  return Math.min(maxLot, Number(stepped.toFixed(8)));
}

function pipSize() {
  return 0.0001;
}

function simulateTrade({ signalBar, nextBar, futureBars, setup, equity, spreadPips, slippagePips, riskPct }) {
  const spread = spreadPips * pipSize();
  const slippage = slippagePips * pipSize();
  const halfSpread = spread / 2;

  const side = setup.candidate;
  const entry = side === 'BUY'
    ? nextBar.open + halfSpread + slippage
    : nextBar.open - halfSpread - slippage;

  const stop = setup.stop_loss;
  const target = setup.take_profit;
  if (!(entry > 0 && stop > 0 && target > 0)) return null;

  const stopDistance = Math.abs(entry - stop);
  if (!(stopDistance > 0)) return null;

  const riskCash = equity * (riskPct / 100);
  const riskPerLot = stopDistance * 100000;
  const lots = floorLot(riskCash / riskPerLot, CONFIG.minLot, CONFIG.maxLot, CONFIG.lotStep);
  if (!(lots > 0)) return null;

  let exitTime = futureBars[futureBars.length - 1].time;
  let exitMid = futureBars[futureBars.length - 1].close;
  let exitReason = 'END_OF_DATA';

  for (const bar of futureBars) {
    const stopHit = side === 'BUY'
      ? bar.low - halfSpread <= stop
      : bar.high + halfSpread >= stop;
    const targetHit = side === 'BUY'
      ? bar.high - halfSpread >= target
      : bar.low + halfSpread <= target;

    if (stopHit) {
      exitTime = bar.time;
      exitReason = 'STOP';
      exitMid = side === 'BUY' ? stop - halfSpread - slippage : stop + halfSpread + slippage;
      break;
    }
    if (targetHit) {
      exitTime = bar.time;
      exitReason = 'TARGET';
      exitMid = side === 'BUY' ? target - halfSpread - slippage : target + halfSpread + slippage;
      break;
    }
  }

  const exitPrice = exitMid;
  const grossEntry = nextBar.open;
  const grossExit = exitTime === futureBars[futureBars.length - 1]?.time
    ? futureBars[futureBars.length - 1].close
    : futureBars.find((b) => b.time === exitTime)?.close ?? exitMid;
  const grossPips = side === 'BUY'
    ? (grossExit - grossEntry) / pipSize()
    : (grossEntry - grossExit) / pipSize();

  const netPnl = side === 'BUY'
    ? (exitPrice - entry) * 100000 * lots
    : (entry - exitPrice) * 100000 * lots;

  const grossPnl = grossPips * 10 * lots;
  const transactionCost = grossPnl - netPnl;
  const netPips = netPnl / (10 * lots);
  const grossWouldWin = grossPnl > 0;
  const netLost = netPnl < 0;

  return {
    signal_time: signalBar.time,
    entry_time: nextBar.time,
    exit_time: exitTime,
    side,
    setup_type: setup.setup_type,
    h1_trend: setup.trend,
    entry,
    stop_loss: stop,
    take_profit: target,
    lots,
    risk_cash: riskCash,
    gross_pips: grossPips,
    net_pips: netPips,
    gross_pnl: grossPnl,
    net_pnl: netPnl,
    transaction_cost: transactionCost,
    spread_cost_pips: spreadPips,
    slippage_cost_pips: slippagePips * 2,
    exit_reason: exitReason,
    holding_minutes: Math.max(0, (exitTime - nextBar.time) / 60),
    spread_caused_loss: grossWouldWin && netLost
  };
}

function summarizeTrades(trades, initialEquity) {
  let equity = initialEquity;
  let peak = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let totalCost = 0;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let spreadLosses = 0;
  let totalHolding = 0;
  const equityCurve = [];

  for (const t of trades) {
    equity += t.net_pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    maxDrawdown = Math.max(maxDrawdown, dd);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? dd / peak * 100 : 0);
    grossProfit += Math.max(0, t.net_pnl);
    grossLoss += Math.max(0, -t.net_pnl);
    totalCost += Math.max(0, t.transaction_cost);
    if (t.net_pnl > 0) wins++;
    else if (t.net_pnl < 0) losses++;
    else breakevens++;
    if (t.spread_caused_loss) spreadLosses++;
    totalHolding += t.holding_minutes;
    equityCurve.push({ time: t.exit_time, equity });
  }

  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.net_pnl, 0) / trades.length : 0;
  const expectancyPips = trades.length ? trades.reduce((s, t) => s + t.net_pips, 0) / trades.length : 0;
  const totalPips = trades.reduce((s, t) => s + t.net_pips, 0);
  const winRate = trades.length ? wins / trades.length * 100 : 0;
  const spreadLossRate = trades.length ? spreadLosses / trades.length * 100 : 0;
  const avgHolding = trades.length ? totalHolding / trades.length : 0;

  return {
    initial_equity: initialEquity,
    final_equity: equity,
    net_profit: equity - initialEquity,
    return_pct: (equity / initialEquity - 1) * 100,
    trades: trades.length,
    wins,
    losses,
    breakevens,
    win_rate_pct: winRate,
    profit_factor: profitFactor,
    expectancy_per_trade: expectancy,
    expectancy_pips_per_trade: expectancyPips,
    total_net_pips: totalPips,
    gross_profit: grossProfit,
    gross_loss: grossLoss,
    transaction_cost_total: totalCost,
    max_drawdown: maxDrawdown,
    max_drawdown_pct: maxDrawdownPct,
    avg_holding_minutes: avgHolding,
    spread_caused_loss_trades: spreadLosses,
    spread_caused_loss_rate_pct: spreadLossRate
  };
}

function monthlyBreakdown(trades) {
  const map = new Map();
  for (const t of trades) {
    const key = new Date(t.exit_time * 1000).toISOString().slice(0, 7);
    const row = map.get(key) || { month: key, trades: 0, pnl: 0, wins: 0, losses: 0 };
    row.trades++;
    row.pnl += t.net_pnl;
    if (t.net_pnl > 0) row.wins++; else if (t.net_pnl < 0) row.losses++;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function dataQuality(bars, timeframeSeconds) {
  let invalid = 0;
  let gaps = 0;
  let weekendGaps = 0;
  let volumePositive = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.volume > 0) volumePositive++;
    if (!(b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close && b.close > 0)) invalid++;
    if (i > 0) {
      const delta = bars[i].time - bars[i - 1].time;
      if (delta > timeframeSeconds * 1.5) {
        gaps++;
        const d = new Date(bars[i - 1].time * 1000);
        if (d.getUTCDay() === 5 || d.getUTCDay() === 6) weekendGaps++;
      }
    }
  }
  return {
    rows: bars.length,
    invalid_ohlc: invalid,
    gaps_gt_1_5_period: gaps,
    weekend_gaps: weekendGaps,
    volume_positive_rows: volumePositive,
    volume_coverage_pct: bars.length ? volumePositive / bars.length * 100 : 0
  };
}

function parseArgs() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i];
    if (!token.startsWith('--')) continue;
    const [key, value] = token.slice(2).split('=');
    args.set(key, value ?? 'true');
  }
  return args;
}

function formatNumber(v, digits = 2) {
  if (v === Infinity) return 'Infinity';
  return Number(v).toFixed(digits);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

export function tradesToCsv(trades) {
  if (!trades.length) return 'signal_time,entry_time,exit_time,side,setup_type,h1_trend,entry,stop_loss,take_profit,lots,risk_cash,gross_pips,net_pips,gross_pnl,net_pnl,transaction_cost,spread_cost_pips,slippage_cost_pips,exit_reason,holding_minutes,spread_caused_loss\n';
  const headers = Object.keys(trades[0]);
  const rows = [headers.join(',')];
  for (const t of trades) rows.push(headers.map((h) => csvEscape(t[h])).join(','));
  return rows.join('\n') + '\n';
}

export async function runBacktest({ m15Source = SOURCES.m15, h1Source = SOURCES.h1, config = CONFIG } = {}) {
  const m15Text = await fetchText(m15Source);
  const rawM15 = parseCsv(m15Text);
  const rawH1 = h1Source === 'FROM_M15' ? aggregateM15ToH1(rawM15) : parseCsv(await fetchText(h1Source));
  if (rawM15.length < 500 || rawH1.length < 100) {
    throw new Error(`Insufficient downloaded data: M15=${rawM15.length}, H1=${rawH1.length}. Verify CSV schema/datetime format.`);
  }

  const latestTime = rawM15[rawM15.length - 1].time;
  const defaultStart = latestTime - config.lookbackDays * 86400;
  const startTime = config.startDate ? Date.parse(config.startDate + 'T00:00:00Z') / 1000 : defaultStart;
  const endTime = config.endDate ? Date.parse(config.endDate + 'T23:59:59Z') / 1000 : latestTime;
  const warmupTime = startTime - 60 * 86400;

  const m15 = rawM15.filter((b) => b.time >= warmupTime && b.time <= endTime);
  const h1 = rawH1.filter((b) => b.time >= warmupTime - 30 * 86400 && b.time <= endTime);

  const m15Ind = addIndicators(m15);
  const h1Ind = addIndicators(h1);
  let trades = [];
  let fundamentalTrades = [];
  let equity = config.initialEquity;
  let fundamentalEquity = config.initialEquity;
  let nextAvailableIndex = 0;
  let fundamentalNextAvailableIndex = 0;
  let technicalCandidates = 0;
  let fundamentalRejected = 0;
  const fundamentalRejectReasons = {};
  const fundamentalMask = config.fundamentalSource ? parseFundamentalCsv(await fetchText(config.fundamentalSource)) : null;
  const spreadPrice = config.spreadPips * pipSize();

  const firstIndex = Math.max(210, 80);
  for (let i = firstIndex; i < m15Ind.length - 1; i++) {
    const signalBar = m15Ind[i];
    if (i % 10000 === 0) console.log(`Progress: ${i}/${m15Ind.length}`);
    if (signalBar.time < startTime || signalBar.time > endTime) continue;

    const techEligible = i >= nextAvailableIndex;
    const fundamentalEligible = Boolean(fundamentalMask?.length) && i >= fundamentalNextAvailableIndex;
    if (!techEligible && !fundamentalEligible) continue;
    if (![signalBar.ema20, signalBar.ema50, signalBar.rsi14, signalBar.atr14].every(Number.isFinite)) continue;

    const h1Index = latestCompletedH1Index(h1Ind, signalBar.time);
    const h1Bar = h1Index >= 0 ? h1Ind[h1Index] : null;
    if (!h1Bar || ![h1Bar.close, h1Bar.ema20, h1Bar.ema50, h1Bar.ema200, h1Bar.rsi14, h1Bar.atr14].every(Number.isFinite)) continue;

    const mid = signalBar.close;
    const features = {
      bid: mid - spreadPrice / 2,
      ask: mid + spreadPrice / 2,
      point: 0.00001,
      spread: spreadPrice,
      spreadPoints: spreadPrice / 0.00001,
      barTime: signalBar.time,
      m15: {
        ema20: signalBar.ema20,
        ema50: signalBar.ema50,
        rsi14: signalBar.rsi14,
        atr14: signalBar.atr14
      },
      h1: {
        close: h1Bar.close,
        ema20: h1Bar.ema20,
        ema50: h1Bar.ema50,
        ema200: h1Bar.ema200,
        rsi14: h1Bar.rsi14,
        atr14: h1Bar.atr14
      },
      recentM15: sliceRecentBars(m15Ind, i, 80),
      recentH1: sliceRecentBars(h1Ind, h1Index, 80)
    };

    const setup = buildEurUsdSetup(features, {
      maxSpreadPips: config.maxSpreadPips,
      maxSpreadAtrPct: 15,
      minStopAtr: config.minStopAtr,
      maxStopAtr: config.maxStopAtr,
      takeProfitR: 2,
      maxSpreadToTpPct: config.maxSpreadToTpPct,
      rangeLookback: config.rangeLookback,
      minRangeAtr: config.minRangeAtr,
      maxRangeAtr: config.maxRangeAtr,
      breakoutAtr: config.breakoutMinAtr,
      minBodyAtr: config.breakoutMinBodyAtr,
      minCloseLocation: config.breakoutMinCloseLocation,
      buyRsiMin: config.breakoutBuyRsiMin,
      buyRsiMax: config.breakoutBuyRsiMax,
      sellRsiMin: config.breakoutSellRsiMin,
      sellRsiMax: config.breakoutSellRsiMax,
      frequencyMode: config.frequencyMode,
      targetTradesPerWeek: config.targetTradesPerWeek
    });
    if (setup.candidate === 'WAIT') continue;

    technicalCandidates++;

    if (techEligible) {
      const nextBar = m15Ind[i + 1];
      const futureBars = m15Ind.slice(i + 1);
      const trade = simulateTrade({
        signalBar,
        nextBar,
        futureBars,
        setup,
        equity,
        spreadPips: config.spreadPips,
        slippagePips: config.slippagePips,
        riskPct: config.riskPct
      });
      if (trade) {
        trades.push(trade);
        equity += trade.net_pnl;
        nextAvailableIndex = m15Ind.findIndex((b) => b.time > trade.exit_time);
        if (nextAvailableIndex < 0) nextAvailableIndex = m15Ind.length;
      }
    }

    if (fundamentalEligible) {
      const assessment = latestFundamentalAssessment(
        fundamentalMask,
        signalBar.time,
        config.maxFundamentalAgeHours
      );
      const gate = fundamentalGate(setup, assessment, config);
      if (!gate.allowed) {
        fundamentalRejected++;
        fundamentalRejectReasons[gate.reason] = (fundamentalRejectReasons[gate.reason] || 0) + 1;
      } else {
        const nextBar = m15Ind[i + 1];
        const futureBars = m15Ind.slice(i + 1);
        const trade = simulateTrade({
          signalBar,
          nextBar,
          futureBars,
          setup,
          equity: fundamentalEquity,
          spreadPips: config.spreadPips,
          slippagePips: config.slippagePips,
          riskPct: config.riskPct
        });
        if (trade) {
          fundamentalTrades.push(trade);
          fundamentalEquity += trade.net_pnl;
          fundamentalNextAvailableIndex = m15Ind.findIndex((b) => b.time > trade.exit_time);
          if (fundamentalNextAvailableIndex < 0) fundamentalNextAvailableIndex = m15Ind.length;
        }
      }
    }
  }

  const summary = summarizeTrades(trades, config.initialEquity);
  const fundamentalSummary = fundamentalMask ? summarizeTrades(fundamentalTrades, config.initialEquity) : null;
  const report = {
    strategy: 'EURUSD M15 high-quality range breakout + H1 trend (technical core)',
    fundamental_backtest_status: fundamentalMask ? 'RUN' : 'NOT_RUN',
    fundamental_backtest_note: fundamentalMask
      ? 'A timestamped historical fundamental mask was applied causally at or before each signal. Verify that the mask was created without lookahead.'
      : 'Historical AI/web-search outputs are not available in the price dataset, so this report measures the technical core separately. It must not be interpreted as full technical+AI historical performance.',
    data_source: { m15: m15Source, h1: h1Source },
    source_period: {
      m15_first: new Date(rawM15[0].time * 1000).toISOString(),
      m15_last: new Date(rawM15[rawM15.length - 1].time * 1000).toISOString(),
      h1_first: new Date(rawH1[0].time * 1000).toISOString(),
      h1_last: new Date(rawH1[rawH1.length - 1].time * 1000).toISOString()
    },
    test_period: {
      start: new Date(startTime * 1000).toISOString(),
      end: new Date(endTime * 1000).toISOString()
    },
    frequency_target: {
      mode: config.frequencyMode,
      target_trades_per_week: config.targetTradesPerWeek,
      target_is_monitoring_only: true
    },
    assumptions: {
      initial_equity: config.initialEquity,
      risk_per_trade_pct: config.riskPct,
      spread_pips: config.spreadPips,
      slippage_pips_each_side: config.slippagePips,
      execution: 'next M15 bar open',
      same_bar_conflict: 'stop first',
      tp_multiple_r: 2,
      ai_environment_filter: fundamentalMask
        ? {
            source: config.fundamentalSource,
            min_confidence: config.minAiEnvironmentConfidence,
            max_age_hours: config.maxFundamentalAgeHours,
            allowed_environment: 'FAVORABLE',
            high_event_blocked: true
          }
        : 'excluded from historical performance due lack of point-in-time AI environment labels'
    },
    data_quality: {
      m15: dataQuality(m15, 900),
      h1: dataQuality(h1, 3600)
    },
    summary,
    monthly: monthlyBreakdown(trades),
    fundamental_filtered_summary: fundamentalSummary,
    fundamental_filter_stats: fundamentalMask ? {
      historical_mask_rows: fundamentalMask.length,
      technical_candidates: technicalCandidates,
      rejected_candidates: fundamentalRejected,
      rejection_reasons: fundamentalRejectReasons
    } : null
  };

  const outDir = process.env.BACKTEST_OUTPUT_DIR || path.resolve(__dirname, '../backtest-output');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'eurusd_backtest_report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(outDir, 'eurusd_trades.csv'), tradesToCsv(trades));

  console.log('=== EURUSD BACKTEST ===');
  console.log('Strategy:', report.strategy);
  console.log('Data:', report.source_period.m15_first, '->', report.source_period.m15_last);
  console.log('Test:', report.test_period.start, '->', report.test_period.end);
  console.log('Fundamental historical backtest:', report.fundamental_backtest_status);
  if (fundamentalSummary) {
    console.log('Fundamental-filtered trades:', fundamentalSummary.trades);
    console.log('Fundamental-filtered PF:', formatNumber(fundamentalSummary.profit_factor));
    console.log('Fundamental-filtered expectancy:', '$' + formatNumber(fundamentalSummary.expectancy_per_trade), '/', formatNumber(fundamentalSummary.expectancy_pips_per_trade) + ' pips');
    console.log('Fundamental-filtered net profit:', '$' + formatNumber(fundamentalSummary.net_profit));
    console.log('Fundamental-filtered Max DD:', '$' + formatNumber(fundamentalSummary.max_drawdown), '/', formatNumber(fundamentalSummary.max_drawdown_pct) + '%');
  }
  console.log('Trades:', summary.trades);
  console.log('Win rate:', formatNumber(summary.win_rate_pct) + '%');
  console.log('Profit factor:', formatNumber(summary.profit_factor));
  console.log('Expectancy:', '$' + formatNumber(summary.expectancy_per_trade), '/', formatNumber(summary.expectancy_pips_per_trade) + ' pips');
  console.log('Net profit:', '$' + formatNumber(summary.net_profit));
  console.log('Return:', formatNumber(summary.return_pct) + '%');
  console.log('Max DD:', '$' + formatNumber(summary.max_drawdown), '/', formatNumber(summary.max_drawdown_pct) + '%');
  console.log('Avg holding:', formatNumber(summary.avg_holding_minutes) + ' min');
  console.log('Transaction costs:', '$' + formatNumber(summary.transaction_cost_total));
  console.log('Spread-caused loss trades:', summary.spread_caused_loss_trades, '/', summary.trades, '(' + formatNumber(summary.spread_caused_loss_rate_pct) + '%)');
  console.log('Artifacts:', outDir);
  return { report, trades };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  if (args.get('lookback-days')) CONFIG.lookbackDays = Math.max(30, Number(args.get('lookback-days')));
  if (args.get('spread-pips')) CONFIG.spreadPips = Math.max(0, Number(args.get('spread-pips')));
  if (args.get('slippage-pips')) CONFIG.slippagePips = Math.max(0, Number(args.get('slippage-pips')));
  if (args.get('start')) CONFIG.startDate = args.get('start');
  if (args.get('end')) CONFIG.endDate = args.get('end');
  if (args.get('initial-equity')) CONFIG.initialEquity = Math.max(1000, Number(args.get('initial-equity')));
  await runBacktest({ config: CONFIG });
}
