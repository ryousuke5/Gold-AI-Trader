import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, shiftBarsToCloseTime, latestCompletedH1Index } from './backtest-eurusd.mjs';
import {
  buildLondonAsiaRangeMap,
  buildEurUsdAsiaRangeBreakoutSetup,
  londonSessionBucket
} from '../src/eurusd_asia_range_breakout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  start: process.env.BACKTEST_START || '2017-03-06',
  end: process.env.BACKTEST_END || '2022-03-05',
  initialEquity: Number(process.env.BACKTEST_INITIAL_EQUITY || 100000),
  riskPct: Number(process.env.BACKTEST_RISK_PCT || 0.25),
  spreadPips: Number(process.env.BACKTEST_SPREAD_PIPS || 0.8),
  slippagePips: Number(process.env.BACKTEST_SLIPPAGE_PIPS || 0.1),
  minStopAtr: Number(process.env.BACKTEST_MIN_STOP_ATR || 0.50),
  maxStopAtr: Number(process.env.BACKTEST_MAX_STOP_ATR || 1.50),
  maxSpreadPips: Number(process.env.BACKTEST_MAX_SPREAD_PIPS || 1.20),
  maxSpreadToTpPct: Number(process.env.BACKTEST_MAX_SPREAD_TO_TP_PCT || 12),
  variant: process.env.BACKTEST_VARIANT || 'balanced',
  breakoutMinAtr: Number(process.env.BACKTEST_BREAKOUT_MIN_ATR || 0.05),
  minBodyAtr: Number(process.env.BACKTEST_MIN_BODY_ATR || 0.25),
  minCloseLocation: Number(process.env.BACKTEST_MIN_CLOSE_LOCATION || 0.60),
  minRangeAtr: Number(process.env.BACKTEST_MIN_RANGE_ATR || 0.30),
  maxRangeAtr: Number(process.env.BACKTEST_MAX_RANGE_ATR || 1.75),
  buyRsiMin: Number(process.env.BACKTEST_BUY_RSI_MIN || 48),
  buyRsiMax: Number(process.env.BACKTEST_BUY_RSI_MAX || 70),
  sellRsiMin: Number(process.env.BACKTEST_SELL_RSI_MIN || 30),
  sellRsiMax: Number(process.env.BACKTEST_SELL_RSI_MAX || 52),
  asiaStartHour: 0,
  asiaEndHour: 6,
  breakoutStartHour: 7,
  breakoutEndHour: 12,
  m15Source: process.env.BACKTEST_M15_SOURCE || 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDm15.csv',
  h1Source: process.env.BACKTEST_H1_SOURCE || 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDh1.csv'
};

function ema(values, period) {
  const out = new Array(values.length).fill(null);
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
  const tr = new Array(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    tr[i] = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(
          bars[i].high - bars[i].low,
          Math.abs(bars[i].high - bars[i - 1].close),
          Math.abs(bars[i].low - bars[i - 1].close)
        );
  }
  let value = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i++) {
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
  const r = rsi(closes, 14);
  const a = atr(bars, 14);
  return bars.map((b, i) => ({
    ...b,
    ema20: e20[i],
    ema50: e50[i],
    ema200: e200[i],
    rsi14: r[i],
    atr14: a[i]
  }));
}

function h1Trend(h) {
  if (h.close > 0 && h.ema20 > h.ema50 && h.ema50 > h.ema200 && h.close >= h.ema20) return 'UP';
  if (h.close > 0 && h.ema20 < h.ema50 && h.ema50 < h.ema200 && h.close <= h.ema20) return 'DOWN';
  return 'RANGE';
}

function floorLot(raw) {
  const stepped = Math.floor((raw + 1e-12) / 0.01) * 0.01;
  return stepped >= 0.01 ? Math.min(100, Number(stepped.toFixed(8))) : 0;
}

function simulateTrade({ setup, nextBar, futureBars, equity }) {
  const spread = CONFIG.spreadPips * 0.0001;
  const slip = CONFIG.slippagePips * 0.0001;
  const half = spread / 2;
  const side = setup.candidate;
  const entry = side === 'BUY' ? nextBar.open + half + slip : nextBar.open - half - slip;
  const stop = setup.stop_loss;
  const target = setup.take_profit;
  const distance = Math.abs(entry - stop);
  if (!(entry > 0 && stop > 0 && target > 0 && distance > 0)) return null;
  const riskCash = equity * CONFIG.riskPct / 100;
  const lots = floorLot(riskCash / (distance * 100000));
  if (!(lots > 0)) return null;

  let exitTime = futureBars.at(-1)?.time;
  let exitMid = futureBars.at(-1)?.close;
  let exitReason = 'END_OF_DATA';

  for (const bar of futureBars) {
    const stopHit = side === 'BUY' ? bar.low - half <= stop : bar.high + half >= stop;
    const targetHit = side === 'BUY' ? bar.high - half >= target : bar.low + half <= target;
    if (stopHit) {
      exitTime = bar.time;
      exitReason = 'STOP';
      exitMid = side === 'BUY' ? stop - half - slip : stop + half + slip;
      break;
    }
    if (targetHit) {
      exitTime = bar.time;
      exitReason = 'TARGET';
      exitMid = side === 'BUY' ? target - half - slip : target + half + slip;
      break;
    }
  }

  const netPnl = side === 'BUY'
    ? (exitMid - entry) * 100000 * lots
    : (entry - exitMid) * 100000 * lots;

  return {
    signal_time: nextBar.time - 900,
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
    net_pips: netPnl / (10 * lots),
    net_pnl: netPnl,
    exit_reason: exitReason,
    holding_minutes: Math.max(0, (exitTime - nextBar.time) / 60)
  };
}

function summarize(trades, initialEquity) {
  let equity = initialEquity;
  let peak = equity;
  let maxDd = 0;
  let maxDdPct = 0;
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let holding = 0;
  for (const t of trades) {
    equity += t.net_pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    maxDd = Math.max(maxDd, dd);
    maxDdPct = Math.max(maxDdPct, peak > 0 ? dd / peak * 100 : 0);
    if (t.net_pnl > 0) {
      wins++;
      grossProfit += t.net_pnl;
    } else if (t.net_pnl < 0) {
      losses++;
      grossLoss += -t.net_pnl;
    }
    holding += t.holding_minutes;
  }
  const n = trades.length;
  return {
    trades: n,
    wins,
    losses,
    win_rate_pct: n ? wins / n * 100 : 0,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    expectancy_per_trade: n ? (equity - initialEquity) / n : 0,
    expectancy_pips_per_trade: n ? trades.reduce((s, t) => s + t.net_pips, 0) / n : 0,
    net_profit: equity - initialEquity,
    return_pct: (equity / initialEquity - 1) * 100,
    max_drawdown: maxDd,
    max_drawdown_pct: maxDdPct,
    avg_holding_minutes: n ? holding / n : 0
  };
}

function riskAllows(state, equity, timestamp) {
  const day = new Date(timestamp * 1000).toISOString().slice(0, 10);
  if (state.day !== day) {
    state.day = day;
    state.dayStart = equity;
  }
  state.peak = Math.max(state.peak, equity);
  const daily = state.dayStart > 0 ? (equity - state.dayStart) / state.dayStart * 100 : 0;
  const dd = state.peak > 0 ? (state.peak - equity) / state.peak * 100 : 0;
  return daily > -2 && dd < 5;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Gold-AI-Trader-research/1.0' } });
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  return res.text();
}

async function loadData() {
  const [m15Text, h1Text] = await Promise.all([
    fetchText(CONFIG.m15Source),
    fetchText(CONFIG.h1Source)
  ]);
  const m15 = addIndicators(shiftBarsToCloseTime(parseCsv(m15Text), 900));
  const h1 = addIndicators(shiftBarsToCloseTime(parseCsv(h1Text), 3600));
  if (m15.length < 500 || h1.length < 100) throw new Error('Insufficient EURUSD history');
  return { m15, h1 };
}

function runPeriod(data, start, end) {
  const startTime = Date.parse(start + 'T00:00:00Z') / 1000;
  const endTime = Date.parse(end + 'T23:59:59Z') / 1000;
  const asiaRangeMap = buildLondonAsiaRangeMap(data.m15, {
    startHour: CONFIG.asiaStartHour,
    endHour: CONFIG.asiaEndHour
  });
  let equity = CONFIG.initialEquity;
  const state = { day: null, dayStart: CONFIG.initialEquity, peak: CONFIG.initialEquity };
  let nextAvailableIndex = 0;
  const trades = [];
  let candidates = 0;
  const diagnostics = {
    session_bars: 0,
    asia_range_found: 0,
    h1_up: 0,
    h1_down: 0,
    trend_aligned: 0,
    range_width_ok: 0,
    breakout_raw: 0
  };

  for (let i = 210; i < data.m15.length - 1; i++) {
    const signalBar = data.m15[i];
    if (signalBar.time < startTime || signalBar.time > endTime || i < nextAvailableIndex) continue;
    if (![signalBar.ema20, signalBar.ema50, signalBar.rsi14, signalBar.atr14].every(Number.isFinite)) continue;

    const h1Index = latestCompletedH1Index(data.h1, signalBar.time);
    const h1Bar = h1Index >= 0 ? { ...data.h1[h1Index], trend: h1Trend(data.h1[h1Index]) } : null;
    if (!h1Bar || ![h1Bar.close, h1Bar.ema20, h1Bar.ema50, h1Bar.ema200].every(Number.isFinite)) continue;

    const dateKey = londonSessionBucket(signalBar.time);
    const asiaRange = asiaRangeMap.get(dateKey);
    if (!asiaRange) continue;

    diagnostics.session_bars++;
    if (asiaRange) diagnostics.asia_range_found++;
    if (h1Bar.trend === 'UP') diagnostics.h1_up++;
    if (h1Bar.trend === 'DOWN') diagnostics.h1_down++;
    if ((h1Bar.trend === 'UP' && signalBar.ema20 > signalBar.ema50) || (h1Bar.trend === 'DOWN' && signalBar.ema20 < signalBar.ema50)) diagnostics.trend_aligned++;
    if (asiaRange && signalBar.atr14 > 0) {
      const rw = (asiaRange.high - asiaRange.low) / signalBar.atr14;
      if (rw >= CONFIG.minRangeAtr && rw <= CONFIG.maxRangeAtr) diagnostics.range_width_ok++;
      if ((h1Bar.trend === 'UP' && signalBar.close > asiaRange.high + signalBar.atr14 * CONFIG.breakoutMinAtr) ||
          (h1Bar.trend === 'DOWN' && signalBar.close < asiaRange.low - signalBar.atr14 * CONFIG.breakoutMinAtr)) diagnostics.breakout_raw++;
    }

    const setup = buildEurUsdAsiaRangeBreakoutSetup({
      signalBar,
      previousBar: data.m15[i - 1],
      h1Bar,
      asiaRange,
      config: {
        breakoutStartHour: CONFIG.breakoutStartHour,
        breakoutEndHour: CONFIG.breakoutEndHour,
        breakoutMinAtr: CONFIG.breakoutMinAtr,
        minBodyAtr: CONFIG.minBodyAtr,
        minCloseLocation: CONFIG.minCloseLocation,
        minRangeAtr: CONFIG.minRangeAtr,
        maxRangeAtr: CONFIG.maxRangeAtr,
        buyRsiMin: CONFIG.buyRsiMin,
        buyRsiMax: CONFIG.buyRsiMax,
        sellRsiMin: CONFIG.sellRsiMin,
        sellRsiMax: CONFIG.sellRsiMax,
        minStopAtr: CONFIG.minStopAtr,
        maxStopAtr: CONFIG.maxStopAtr,
        takeProfitR: 2,
        spreadPips: CONFIG.spreadPips,
        maxSpreadPips: CONFIG.maxSpreadPips,
        maxSpreadToTpPct: CONFIG.maxSpreadToTpPct
      }
    });
    if (setup.candidate === 'WAIT') continue;
    candidates++;
    if (!riskAllows(state, equity, signalBar.time)) continue;

    const futureBars = data.m15.slice(i + 1).filter((bar) => bar.time <= endTime);
    if (!futureBars.length) continue;
    const trade = simulateTrade({
      setup,
      nextBar: data.m15[i + 1],
      futureBars,
      equity
    });
    if (!trade) continue;

    trades.push(trade);
    equity += trade.net_pnl;
    nextAvailableIndex = data.m15.findIndex((bar) => bar.time > trade.exit_time);
    if (nextAvailableIndex < 0) nextAvailableIndex = data.m15.length;
  }

  return { summary: summarize(trades, CONFIG.initialEquity), candidates, trades, diagnostics };
}

function weeklyFrequency(trades, start, end) {
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  return trades.length / Math.max(1, days / 7);
}

async function main() {
  const data = await loadData();
  const earlyEnd = '2019-09-05';
  const lateStart = '2019-09-06';
  const full = runPeriod(data, CONFIG.start, CONFIG.end);
  const early = runPeriod(data, CONFIG.start, earlyEnd);
  const late = runPeriod(data, lateStart, CONFIG.end);

  const report = {
    strategy: 'EURUSD Asia 00:00-06:00 London range breakout during London 07:00-12:00 + H1 trend + M15 confirmation',
    variant: CONFIG.variant,
    design: {
      asia_range_london_local: '00:00-06:00',
      london_breakout_local: '07:00-12:00',
      h1_trend: 'EMA20 > EMA50 > EMA200 with close above EMA20, or mirror for DOWN',
      entry: 'next M15 bar open after completed breakout candle',
      stop: 'opposite Asia range edge +/- 0.15 M15 ATR',
      take_profit: '2R',
      ai_role: 'not included in technical research backtest; production AI remains downstream environment filter',
      fixed_risk_pct: CONFIG.riskPct
    },
    source: {
      m15: CONFIG.m15Source,
      h1: CONFIG.h1Source
    },
    periods: {
      full: { start: CONFIG.start, end: CONFIG.end, ...full.summary, trades_per_week: weeklyFrequency(full.trades, CONFIG.start, CONFIG.end), technical_candidates: full.candidates },
      early: { start: CONFIG.start, end: earlyEnd, ...early.summary, trades_per_week: weeklyFrequency(early.trades, CONFIG.start, earlyEnd), technical_candidates: early.candidates },
      late: { start: lateStart, end: CONFIG.end, ...late.summary, trades_per_week: weeklyFrequency(late.trades, lateStart, CONFIG.end), technical_candidates: late.candidates }
    },
    trades: full.trades
  };

  const outDir = process.env.BACKTEST_OUTPUT_DIR || path.resolve(__dirname, '../asia-range-backtest-output');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(outDir, 'trades.json'), JSON.stringify(full.trades, null, 2));
  console.log(JSON.stringify(report.periods, null, 2));
}

await main();
