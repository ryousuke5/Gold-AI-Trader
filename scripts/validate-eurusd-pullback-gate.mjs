import fs from 'node:fs/promises';
import process from 'node:process';

const file = process.argv[2] || 'pullback-backtest-output/summary.json';
const guidanceTradesPerWeek = Number(process.env.PULLBACK_GATE_GUIDANCE_TRADES_PER_WEEK || 1);
const minPf = Number(process.env.PULLBACK_GATE_MIN_PF || 1.25);
const minExpectancyR = Number(process.env.PULLBACK_GATE_MIN_EXPECTANCY_R || 0.10);
const maxDrawdownR = Number(process.env.PULLBACK_GATE_MAX_DD_R || 12);
const minRecentYearTrades = Number(process.env.PULLBACK_GATE_MIN_RECENT_YEAR_TRADES || 40);
const minRecentYearPf = Number(process.env.PULLBACK_GATE_MIN_RECENT_YEAR_PF || 1.10);
const minRecentYearExpectancyR = Number(process.env.PULLBACK_GATE_MIN_RECENT_YEAR_EXPECTANCY_R || 0.05);
const maxRecentYearDrawdownR = Number(process.env.PULLBACK_GATE_MAX_RECENT_YEAR_DD_R || 6);

function finite(n) { return Number.isFinite(Number(n)); }

function stats(trades) {
  const wins = trades.filter(t => Number(t.result_r) > 0);
  const losses = trades.filter(t => Number(t.result_r) < 0);
  const net = trades.reduce((s,t)=>s+Number(t.result_r),0);
  const grossWin = wins.reduce((s,t)=>s+Number(t.result_r),0);
  const grossLoss = Math.abs(losses.reduce((s,t)=>s+Number(t.result_r),0));
  let equity=0, peak=0, maxDd=0;
  for(const t of trades){
    equity += Number(t.result_r);
    peak = Math.max(peak,equity);
    maxDd = Math.max(maxDd,peak-equity);
  }
  const first=trades[0] ? Date.parse(trades[0].signal_time) : NaN;
  const last=trades.length ? Date.parse(trades.at(-1).signal_time) : NaN;
  const weeks = finite(first) && finite(last) ? Math.max(1,(last-first)/1000/86400/7) : 0;
  return {
    trades: trades.length,
    win_rate_pct: trades.length ? wins.length/trades.length*100 : 0,
    net_r: net,
    profit_factor: grossLoss>0 ? grossWin/grossLoss : null,
    expectancy_r: trades.length ? net/trades.length : 0,
    max_drawdown_r: maxDd,
    trades_per_week: weeks ? trades.length/weeks : 0
  };
}

const summary = JSON.parse(await fs.readFile(file,'utf8'));
const tradesPath = file.replace(/summary\.json$/,'trades.csv');
const csv = await fs.readFile(tradesPath,'utf8');
const lines = csv.trim().split(/\r?\n/).slice(1).filter(Boolean);
const trades = lines.map(line => {
  const [signal_time,direction,result_r,exit_reason,exit_time,hold_bars] = line.split(',');
  return {signal_time,direction,result_r:Number(result_r),exit_reason,exit_time,hold_bars:Number(hold_bars)};
}).sort((a,b)=>Date.parse(a.signal_time)-Date.parse(b.signal_time));

const cutoff = Date.now() - 365*86400*1000;
const recentYearTrades = trades.filter(t => Date.parse(t.signal_time) >= cutoff);
const overall = stats(trades);
const oos = stats(recentYearTrades);

const checks = {
  minimum_sample_size: overall.trades >= 100,
  minimum_profit_factor: finite(overall.profit_factor) && overall.profit_factor >= minPf,
  minimum_expectancy: overall.expectancy_r >= minExpectancyR,
  maximum_drawdown: overall.max_drawdown_r <= maxDrawdownR,
  minimum_recent_year_trades: oos.trades >= minRecentYearTrades,
  minimum_recent_year_profit_factor: finite(oos.profit_factor) && oos.profit_factor >= minRecentYearPf,
  minimum_recent_year_expectancy: oos.expectancy_r >= minRecentYearExpectancyR,
  maximum_recent_year_drawdown: oos.max_drawdown_r <= maxRecentYearDrawdownR
};

const result = {
  gate: 'EURUSD_STRATEGY_B_LIVE_APPROVAL',
  approved: Object.values(checks).every(Boolean),
  checks,
  thresholds: {
    guidance_trades_per_week: guidanceTradesPerWeek,
    min_pf: minPf,
    min_expectancy_r: minExpectancyR,
    max_drawdown_r: maxDrawdownR,
    min_recent_year_trades: minRecentYearTrades,
    min_recent_year_pf: minRecentYearPf,
    min_recent_year_expectancy_r: minRecentYearExpectancyR,
    max_recent_year_drawdown_r: maxRecentYearDrawdownR
  },
  overall,
  frequency_guidance: {
    reference_trades_per_week: guidanceTradesPerWeek,
    meets_reference: overall.trades_per_week >= guidanceTradesPerWeek,
    note: 'Trade frequency is a guideline only and does not determine live approval.'
  },
  recent_365_days_validation: oos,
  evaluated_at: new Date().toISOString(),
  source_summary: {
    source_mode: summary.source_mode,
    bars: summary.bars,
    lookback_days: summary.lookback_days,
    parameters: summary.parameters
  }
};

const out=file.replace(/summary\.json$/,'gate.json');
await fs.writeFile(out, JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(!result.approved) process.exitCode=2;
