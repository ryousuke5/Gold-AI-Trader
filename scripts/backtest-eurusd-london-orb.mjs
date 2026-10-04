import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, shiftBarsToCloseTime, latestCompletedH1Index } from './backtest-eurusd.mjs';
import { buildEurUsdLondonOrbSetup } from '../src/eurusd_london_orb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  startDate: process.env.BACKTEST_START || '',
  endDate: process.env.BACKTEST_END || '',
  lookbackDays: Math.max(30, Number(process.env.BACKTEST_LOOKBACK_DAYS || 1825)),
  initialEquity: Math.max(1000, Number(process.env.BACKTEST_INITIAL_EQUITY || 100000)),
  riskPct: Math.max(0.01, Number(process.env.BACKTEST_RISK_PCT || 0.25)),
  spreadPips: Math.max(0, Number(process.env.BACKTEST_SPREAD_PIPS || 0.8)),
  slippagePips: Math.max(0, Number(process.env.BACKTEST_SLIPPAGE_PIPS || 0.1)),
  minStopAtr: Math.max(0.1, Number(process.env.BACKTEST_MIN_STOP_ATR || 0.50)),
  maxStopAtr: Math.max(0.2, Number(process.env.BACKTEST_MAX_STOP_ATR || 1.50)),
  maxSpreadPips: Math.max(0.1, Number(process.env.BACKTEST_MAX_SPREAD_PIPS || 1.20)),
  maxSpreadToTpPct: Math.max(1, Number(process.env.BACKTEST_MAX_SPREAD_TO_TP_PCT || 12)),
  maxDailyLossPct: Math.max(0.1, Number(process.env.BACKTEST_MAX_DAILY_LOSS_PCT || 2)),
  maxDrawdownPct: Math.max(0.1, Number(process.env.BACKTEST_MAX_DRAWDOWN_PCT || 5)),
  breakoutAtr: Math.max(0.02, Number(process.env.BACKTEST_BREAKOUT_MIN_ATR || 0.07)),
  minBodyAtr: Math.max(0.05, Number(process.env.BACKTEST_BREAKOUT_MIN_BODY_ATR || 0.30)),
  minCloseLocation: Math.min(0.95, Math.max(0.5, Number(process.env.BACKTEST_BREAKOUT_MIN_CLOSE_LOCATION || 0.65))),
  minRangeAtr: Math.max(0.05, Number(process.env.BACKTEST_MIN_RANGE_ATR || 0.15)),
  maxRangeAtr: Math.max(0.1, Number(process.env.BACKTEST_MAX_RANGE_ATR || 1.75)),
  buyRsiMin: Number(process.env.BACKTEST_BREAKOUT_BUY_RSI_MIN || 48),
  buyRsiMax: Number(process.env.BACKTEST_BREAKOUT_BUY_RSI_MAX || 70),
  sellRsiMin: Number(process.env.BACKTEST_BREAKOUT_SELL_RSI_MIN || 30),
  sellRsiMax: Number(process.env.BACKTEST_BREAKOUT_SELL_RSI_MAX || 52),
  minVolumeRatio: Number(process.env.BACKTEST_MIN_VOLUME_RATIO || 1.05),
  requireVolume: String(process.env.BACKTEST_REQUIRE_VOLUME || 'true').toLowerCase() !== 'false'
};

const SOURCES = {
  m15: process.env.BACKTEST_M15_SOURCE || 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDm15.csv',
  h1: process.env.BACKTEST_H1_SOURCE || 'FROM_M15'
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
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gainSum += Math.max(0, change);
    lossSum += Math.max(0, -change);
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atr(bars, period) {
  const out = new Array(bars.length).fill(null);
  const tr = bars.map((b, i) => i === 0
    ? b.high - b.low
    : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))
  );
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
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const r14 = rsi(closes, 14);
  const a14 = atr(bars, 14);
  return bars.map((b, i) => ({ ...b, ema20: e20[i], ema50: e50[i], ema200: e200[i], rsi14: r14[i], atr14: a14[i] }));
}

function aggregateM15ToH1(m15) {
  const buckets = new Map();
  for (const bar of m15) {
    const hour = Math.floor(bar.time / 3600) * 3600;
    const cur = buckets.get(hour);
    if (!cur) buckets.set(hour, { time: hour, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
    else {
      cur.high = Math.max(cur.high, bar.high);
      cur.low = Math.min(cur.low, bar.low);
      cur.close = bar.close;
      cur.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function sliceRecent(bars, index, count = 160) {
  return bars.slice(Math.max(0, index - count + 1), index + 1).map((b) => ({
    time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume
  }));
}

function floorLot(raw) {
  const step = 0.01;
  const value = Math.floor((raw + 1e-12) / step) * step;
  return value >= 0.01 ? Math.min(100, Number(value.toFixed(8))) : 0;
}

function dailyRiskAllowed(state, equity, timestamp) {
  const key = new Date(timestamp * 1000).toISOString().slice(0, 10);
  if (state.dayKey !== key) {
    state.dayKey = key;
    state.dayStartEquity = equity;
  }
  state.peakEquity = Math.max(state.peakEquity, equity);
  const daily = state.dayStartEquity > 0 ? (equity - state.dayStartEquity) / state.dayStartEquity * 100 : 0;
  const dd = state.peakEquity > 0 ? (state.peakEquity - equity) / state.peakEquity * 100 : 0;
  return { allowed: daily > -CONFIG.maxDailyLossPct && dd < CONFIG.maxDrawdownPct, daily, dd };
}

function simulateTrade(signalBar, nextBar, futureBars, setup, equity) {
  const pip = 0.0001;
  const spread = CONFIG.spreadPips * pip;
  const slip = CONFIG.slippagePips * pip;
  const half = spread / 2;
  const entry = setup.candidate === 'BUY'
    ? nextBar.open + half + slip
    : nextBar.open - half - slip;
  const stop = setup.stop_loss;
  const target = setup.take_profit;
  const stopDistance = Math.abs(entry - stop);
  const riskCash = equity * CONFIG.riskPct / 100;
  const riskPerLot = stopDistance * 100000;
  const lots = floorLot(riskCash / riskPerLot);
  if (!(lots > 0)) return null;

  let exitTime = futureBars[futureBars.length - 1].time;
  let exitMid = futureBars[futureBars.length - 1].close;
  let exitReason = 'END_OF_DATA';

  for (const bar of futureBars) {
    const stopHit = setup.candidate === 'BUY' ? bar.low - half <= stop : bar.high + half >= stop;
    const targetHit = setup.candidate === 'BUY' ? bar.high - half >= target : bar.low + half <= target;
    if (stopHit) {
      exitTime = bar.time;
      exitMid = setup.candidate === 'BUY' ? stop - half - slip : stop + half + slip;
      exitReason = 'STOP';
      break;
    }
    if (targetHit) {
      exitTime = bar.time;
      exitMid = setup.candidate === 'BUY' ? target - half - slip : target + half + slip;
      exitReason = 'TARGET';
      break;
    }
  }

  const exitPrice = exitMid;
  const pnl = setup.candidate === 'BUY'
    ? (exitPrice - entry) * 100000 * lots
    : (entry - exitPrice) * 100000 * lots;

  return {
    signal_time: signalBar.time,
    entry_time: nextBar.time - 900,
    exit_time: exitTime,
    side: setup.candidate,
    setup_type: setup.setup_type,
    h1_trend: setup.trend,
    entry,
    stop_loss: stop,
    take_profit: target,
    lots,
    risk_cash: riskCash,
    net_pnl: pnl,
    net_pips: pnl / (10 * lots),
    exit_reason: exitReason,
    holding_minutes: (exitTime - (nextBar.time - 900)) / 60
  };
}

function summarize(trades) {
  let equity = CONFIG.initialEquity;
  let peak = equity;
  let maxDd = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let holding = 0;
  for (const t of trades) {
    equity += t.net_pnl;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
    if (t.net_pnl > 0) { wins++; grossProfit += t.net_pnl; }
    else if (t.net_pnl < 0) { losses++; grossLoss += -t.net_pnl; }
    holding += t.holding_minutes;
  }
  return {
    initial_equity: CONFIG.initialEquity,
    final_equity: equity,
    net_profit: equity - CONFIG.initialEquity,
    return_pct: (equity / CONFIG.initialEquity - 1) * 100,
    trades: trades.length,
    wins,
    losses,
    win_rate_pct: trades.length ? wins / trades.length * 100 : 0,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    expectancy_per_trade: trades.length ? (equity - CONFIG.initialEquity) / trades.length : 0,
    max_drawdown: maxDd,
    max_drawdown_pct: peak > 0 ? maxDd / peak * 100 : 0,
    avg_holding_minutes: trades.length ? holding / trades.length : 0,
    trades_per_week: 0
  };
}

export async function runSessionBacktest() {
  const rawM15 = shiftBarsToCloseTime(parseCsv(await (await fetch(SOURCES.m15)).text()), 900);
  const rawH1 = rawM15.length ? shiftBarsToCloseTime(aggregateM15ToH1(parseCsv(await (await fetch(SOURCES.m15)).text())), 3600) : [];
  const latest = rawM15[rawM15.length - 1].time;
  const endTime = CONFIG.endDate ? Date.parse(CONFIG.endDate + 'T23:59:59Z') / 1000 : latest;
  const startTime = CONFIG.startDate ? Date.parse(CONFIG.startDate + 'T00:00:00Z') / 1000 : latest - CONFIG.lookbackDays * 86400;
  const warmup = startTime - 60 * 86400;
  const m15 = rawM15.filter((b) => b.time >= warmup && b.time <= endTime);
  const h1 = rawH1.filter((b) => b.time >= warmup - 30 * 86400 && b.time <= endTime);
  const m15Ind = addIndicators(m15);
  const h1Ind = addIndicators(h1);

  const riskState = { dayKey: null, dayStartEquity: CONFIG.initialEquity, peakEquity: CONFIG.initialEquity };
  let equity = CONFIG.initialEquity;
  let trades = [];
  let nextAvailableIndex = 0;

  for (let i = 210; i < m15Ind.length - 1; i++) {
    const signalBar = m15Ind[i];
    if (signalBar.time < startTime || signalBar.time > endTime || i < nextAvailableIndex) continue;
    if (![signalBar.ema20, signalBar.ema50, signalBar.rsi14, signalBar.atr14].every(Number.isFinite)) continue;

    const h1Index = latestCompletedH1Index(h1Ind, signalBar.time);
    const h1Bar = h1Index >= 0 ? h1Ind[h1Index] : null;
    if (!h1Bar || ![h1Bar.close, h1Bar.ema20, h1Bar.ema50, h1Bar.ema200].every(Number.isFinite)) continue;

    const mid = signalBar.close;
    const spreadPrice = CONFIG.spreadPips * 0.0001;
    const features = {
      bid: mid - spreadPrice / 2,
      ask: mid + spreadPrice / 2,
      point: 0.00001,
      spread: spreadPrice,
      spreadPoints: spreadPrice / 0.00001,
      barTime: signalBar.time,
      m15: { ema20: signalBar.ema20, ema50: signalBar.ema50, rsi14: signalBar.rsi14, atr14: signalBar.atr14 },
      h1: { close: h1Bar.close, ema20: h1Bar.ema20, ema50: h1Bar.ema50, ema200: h1Bar.ema200, rsi14: h1Bar.rsi14, atr14: h1Bar.atr14 },
      recentM15: sliceRecent(m15Ind, i, 160)
    };

    const setup = buildEurUsdLondonOrbSetup(features, {
      breakoutAtr: CONFIG.breakoutAtr,
      minBodyAtr: CONFIG.minBodyAtr,
      minCloseLocation: CONFIG.minCloseLocation,
      minRangeAtr: CONFIG.minRangeAtr,
      maxRangeAtr: CONFIG.maxRangeAtr,
      buyRsiMin: CONFIG.buyRsiMin,
      buyRsiMax: CONFIG.buyRsiMax,
      sellRsiMin: CONFIG.sellRsiMin,
      sellRsiMax: CONFIG.sellRsiMax,
      minVolumeRatio: CONFIG.minVolumeRatio,
      requireVolume: CONFIG.requireVolume,
      maxSpreadPips: CONFIG.maxSpreadPips,
      maxSpreadAtrPct: 15,
      minStopAtr: CONFIG.minStopAtr,
      maxStopAtr: CONFIG.maxStopAtr,
      takeProfitR: 2,
      maxSpreadToTpPct: CONFIG.maxSpreadToTpPct
    });
    if (setup.candidate === 'WAIT') continue;

    const gate = dailyRiskAllowed(riskState, equity, signalBar.time);
    if (!gate.allowed) continue;

    const trade = simulateTrade(signalBar, m15Ind[i + 1], m15Ind.slice(i + 1), setup, equity);
    if (!trade) continue;
    trades.push(trade);
    equity += trade.net_pnl;
    nextAvailableIndex = m15Ind.findIndex((b) => b.time > trade.exit_time);
    if (nextAvailableIndex < 0) nextAvailableIndex = m15Ind.length;
  }

  const report = summarize(trades);
  const weeks = Math.max(1, (endTime - startTime) / (7 * 86400));
  report.trades_per_week = trades.length / weeks;
  report.strategy = 'EURUSD London Opening Range Breakout (07:00-08:00 London) + H1 trend';
  report.symbol = 'EURUSD';
  report.session = { timezone: 'Europe/London', range: '07:00-08:00', breakout: '08:15-12:00' };
  report.data_source = SOURCES;
  report.test_period = { start: new Date(startTime * 1000).toISOString(), end: new Date(endTime * 1000).toISOString() };
  report.execution = 'next M15 bar open';
  report.same_bar_conflict = 'stop first';
  report.ai = 'excluded from historical performance; runtime AI remains environment-only';
  report.risk = { risk_per_trade_pct: CONFIG.riskPct, max_daily_loss_pct: CONFIG.maxDailyLossPct, max_drawdown_pct: CONFIG.maxDrawdownPct };

  const outDir = process.env.BACKTEST_OUTPUT_DIR || path.resolve(__dirname, '../backtest-output-london-orb');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'london_orb_report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(outDir, 'london_orb_trades.json'), JSON.stringify(trades, null, 2));

  console.log('=== EURUSD LONDON ORB BACKTEST ===');
  console.log('Test:', report.test_period.start, '->', report.test_period.end);
  console.log('Trades:', report.trades);
  console.log('Win rate:', report.win_rate_pct.toFixed(2) + '%');
  console.log('Profit factor:', Number(report.profit_factor).toFixed(2));
  console.log('Expectancy:', '$' + report.expectancy_per_trade.toFixed(2));
  console.log('Net profit:', '$' + report.net_profit.toFixed(2));
  console.log('Return:', report.return_pct.toFixed(2) + '%');
  console.log('Max DD:', '$' + report.max_drawdown.toFixed(2), '/', report.max_drawdown_pct.toFixed(2) + '%');
  console.log('Trades/week:', report.trades_per_week.toFixed(3));
  console.log('Avg holding:', report.avg_holding_minutes.toFixed(2) + ' min');

  return { report, trades };
}

if (import.meta.url === `file://${process.argv[1]}`) await runSessionBacktest();
