import fs from 'node:fs/promises';
import path from 'node:path';

const file = process.argv[2] || process.env.GOLD_TRADES_FILE || 'gold-backtest-output/gold_v2_resumed_trades.json';
const trades = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'));
if (!Array.isArray(trades) || !trades.length) throw new Error('No trades found');

const pnl = trades.map(t => Number(t.net_pnl) || 0);
const r = trades.map(t => Number(t.net_r) || 0);
const wins = trades.filter(t => (Number(t.net_pnl) || 0) > 0);
const losses = trades.filter(t => (Number(t.net_pnl) || 0) < 0);
const grossWin = wins.reduce((s,t)=>s+(Number(t.net_pnl)||0),0);
const grossLoss = Math.abs(losses.reduce((s,t)=>s+(Number(t.net_pnl)||0),0));
const net = pnl.reduce((s,x)=>s+x,0);
const expectancy = net / trades.length;
const avgR = r.reduce((s,x)=>s+x,0) / r.length;
const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity;
const winRate = wins.length / trades.length;
const avgWin = wins.length ? grossWin / wins.length : 0;
const avgLoss = losses.length ? grossLoss / losses.length : 0;

let equity = 100000;
let peak = equity;
let maxDd = 0;
let maxDdPct = 0;
let ddStart = null;
let maxDdDurationMs = 0;
let peakTime = null;
let troughTime = null;
for (const t of [...trades].sort((a,b)=>a.exit_time-b.exit_time)) {
  equity += Number(t.net_pnl) || 0;
  if (equity > peak) { peak = equity; peakTime = t.exit_time; }
  const dd = peak - equity;
  const ddPct = peak > 0 ? dd / peak * 100 : 0;
  if (ddPct > maxDdPct) { maxDdPct = ddPct; troughTime = t.exit_time; }
  if (dd > maxDd) maxDd = dd;
  if (dd > 0 && ddStart === null) ddStart = peakTime;
  if (dd === 0 && ddStart !== null) { maxDdDurationMs = Math.max(maxDdDurationMs, (t.exit_time - ddStart) * 1000); ddStart = null; }
}
if (ddStart !== null && trades.length) {
  maxDdDurationMs = Math.max(maxDdDurationMs, (trades.at(-1).exit_time - ddStart) * 1000);
}

function streak(sign) {
  let cur=0,best=0;
  for(const t of trades){
    const x=Number(t.net_pnl)||0;
    if ((sign>0&&x>0)||(sign<0&&x<0)) {cur++;best=Math.max(best,cur);} else cur=0;
  }
  return best;
}
function periodStats(items) {
  const wins=items.filter(t=>(Number(t.net_pnl)||0)>0);
  const losses=items.filter(t=>(Number(t.net_pnl)||0)<0);
  const gw=wins.reduce((s,t)=>s+(Number(t.net_pnl)||0),0);
  const gl=Math.abs(losses.reduce((s,t)=>s+(Number(t.net_pnl)||0),0));
  const net=items.reduce((s,t)=>s+(Number(t.net_pnl)||0),0);
  return {trades:items.length,netPnl:net,winRate:items.length?wins.length/items.length:0,profitFactor:gl?gw/gl:null};
}
function grouped(format) {
  const map=new Map();
  for(const t of trades){
    const key=format(new Date(Number(t.exit_time)*1000));
    if(!map.has(key)) map.set(key,[]);
    map.get(key).push(t);
  }
  return Object.fromEntries([...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,periodStats(v)]));
}

function side(s) {
  const a=trades.filter(t=>t.side===s), w=a.filter(t=>(Number(t.net_pnl)||0)>0);
  const gp=w.reduce((x,t)=>x+(Number(t.net_pnl)||0),0);
  const gl=Math.abs(a.filter(t=>(Number(t.net_pnl)||0)<0).reduce((x,t)=>x+(Number(t.net_pnl)||0),0));
  return {trades:a.length,winRate:a.length?w.length/a.length:0,netPnl:a.reduce((x,t)=>x+(Number(t.net_pnl)||0),0),profitFactor:gl?gp/gl:null};
}
const out={
  trades:trades.length,
  netPnl:net,
  initialEquity:100000,
  finalEquity:100000+net,
  returnPct:net/100000*100,
  profitFactor:Number.isFinite(pf)?pf:null,
  expectancyPerTrade:expectancy,
  expectancyR:avgR,
  winRate,
  avgWin,
  avgLoss,
  payoffRatio:avgLoss?avgWin/avgLoss:null,
  maxDrawdown:maxDd,
  maxDrawdownPct:maxDdPct,
  maxDrawdownDurationDays:maxDdDurationMs/86400000,
  maxConsecutiveWins:streak(1),
  maxConsecutiveLosses:streak(-1),
  long:side('BUY'),
  short:side('SELL'),
  monthly:grouped(d=>d.toISOString().slice(0,7)),
  yearly:grouped(d=>d.toISOString().slice(0,4))
};
console.log(JSON.stringify(out,null,2));
await fs.writeFile(path.join(path.dirname(path.resolve(file)),'gold_v2_baseline_metrics.json'), JSON.stringify(out,null,2));
