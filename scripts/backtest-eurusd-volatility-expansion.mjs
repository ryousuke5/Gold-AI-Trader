import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, shiftBarsToCloseTime, latestCompletedH1Index } from './backtest-eurusd.mjs';
import { buildEurUsdVolatilityExpansionSetup } from '../src/eurusd_volatility_expansion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = {
  startDate: process.env.BACKTEST_START || '',
  endDate: process.env.BACKTEST_END || '',
  lookbackDays: Math.max(30, Number(process.env.BACKTEST_LOOKBACK_DAYS || 1825)),
  initialEquity: 100000,
  riskPct: 0.25,
  spreadPips: Number(process.env.BACKTEST_SPREAD_PIPS || 0.8),
  slippagePips: Number(process.env.BACKTEST_SLIPPAGE_PIPS || 0.1),
  minStopAtr: Number(process.env.BACKTEST_MIN_STOP_ATR || 0.5),
  maxStopAtr: Number(process.env.BACKTEST_MAX_STOP_ATR || 1.5),
  maxSpreadPips: Number(process.env.BACKTEST_MAX_SPREAD_PIPS || 1.2),
  maxSpreadToTpPct: Number(process.env.BACKTEST_MAX_SPREAD_TO_TP_PCT || 12),
  maxDailyLossPct: 2,
  maxDrawdownPct: 5,
  lookback: 20,
  breakoutAtr: Number(process.env.BACKTEST_BREAKOUT_MIN_ATR || 0.05),
  minBodyAtr: Number(process.env.BACKTEST_BREAKOUT_MIN_BODY_ATR || 0.30),
  minCloseLocation: Number(process.env.BACKTEST_BREAKOUT_MIN_CLOSE_LOCATION || 0.65),
  maxSqueezeWidthAtr: Number(process.env.BACKTEST_MAX_SQUEEZE_WIDTH_ATR || 2),
  minAtrExpansion: Number(process.env.BACKTEST_MIN_ATR_EXPANSION || 1.08),
  buyRsiMin: Number(process.env.BACKTEST_BREAKOUT_BUY_RSI_MIN || 48),
  buyRsiMax: Number(process.env.BACKTEST_BREAKOUT_BUY_RSI_MAX || 70),
  sellRsiMin: Number(process.env.BACKTEST_BREAKOUT_SELL_RSI_MIN || 30),
  sellRsiMax: Number(process.env.BACKTEST_BREAKOUT_SELL_RSI_MAX || 52),
  minVolumeRatio: Number(process.env.BACKTEST_MIN_VOLUME_RATIO || 1.05),
  requireVolume: true
};
const M15_SOURCE = process.env.BACKTEST_M15_SOURCE || 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/EURUSD/EURUSDm15.csv';

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i=0;i<values.length;i++) { const v=values[i]; if (!Number.isFinite(v)) continue; prev = prev===null ? v : alpha*v + (1-alpha)*prev; out[i]=prev; }
  return out;
}
function rsi(closes, period) {
  const out=new Array(closes.length).fill(null); if(closes.length<=period)return out;
  let g=0,l=0; for(let i=1;i<=period;i++){const c=closes[i]-closes[i-1];g+=Math.max(0,c);l+=Math.max(0,-c);}
  let ag=g/period, al=l/period; out[period]=al===0?100:100-100/(1+ag/al);
  for(let i=period+1;i<closes.length;i++){const c=closes[i]-closes[i-1];ag=(ag*(period-1)+Math.max(0,c))/period;al=(al*(period-1)+Math.max(0,-c))/period;out[i]=al===0?100:100-100/(1+ag/al);}
  return out;
}
function atr(bars, period) {
  const out=new Array(bars.length).fill(null); const tr=bars.map((b,i)=>i?Math.max(b.high-b.low,Math.abs(b.high-bars[i-1].close),Math.abs(b.low-bars[i-1].close)):b.high-b.low);
  if(bars.length<=period)return out; let v=0; for(let i=1;i<=period;i++)v+=tr[i]; v/=period; out[period]=v;
  for(let i=period+1;i<bars.length;i++){v=(v*(period-1)+tr[i])/period;out[i]=v;} return out;
}
function aggregateM15ToH1(m15){const map=new Map();for(const b of m15){const h=Math.floor(b.time/3600)*3600;const x=map.get(h);if(!x)map.set(h,{time:h,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume});else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=b.volume;}}return [...map.values()].sort((a,b)=>a.time-b.time);}
function recent(bars,i,count=160){return bars.slice(Math.max(0,i-count+1),i+1).map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));}
function floorLot(v){const x=Math.floor((v+1e-12)/0.01)*0.01;return x>=0.01?Math.min(100,Number(x.toFixed(8))):0;}
function riskGate(state,equity,t){const day=new Date(t*1000).toISOString().slice(0,10);if(state.day!==day){state.day=day;state.dayStart=equity;}state.peak=Math.max(state.peak,equity);const daily=(equity-state.dayStart)/state.dayStart*100;const dd=(state.peak-equity)/state.peak*100;return daily>-2&&dd<5;}
function simulate(signal,next,future,setup,equity){
 const pip=0.0001,spread=CONFIG.spreadPips*pip,slip=CONFIG.slippagePips*pip,half=spread/2;
 const entry=setup.candidate==='BUY'?next.open+half+slip:next.open-half-slip;
 const stop=setup.stop_loss,target=setup.take_profit,dist=Math.abs(entry-stop),riskCash=equity*CONFIG.riskPct/100,lots=floorLot(riskCash/(dist*100000));if(!(lots>0))return null;
 let exitTime=future.at(-1).time,exit= future.at(-1).close,reason='END_OF_DATA';
 for(const b of future){const stopHit=setup.candidate==='BUY'?b.low-half<=stop:b.high+half>=stop;const targetHit=setup.candidate==='BUY'?b.high-half>=target:b.low+half<=target;if(stopHit){exitTime=b.time;exit=setup.candidate==='BUY'?stop-half-slip:stop+half+slip;reason='STOP';break;}if(targetHit){exitTime=b.time;exit=setup.candidate==='BUY'?target-half-slip:target+half+slip;reason='TARGET';break;}}
 const pnl=setup.candidate==='BUY'?(exit-entry)*100000*lots:(entry-exit)*100000*lots;
 return {signal_time:signal.time,entry_time:next.time-900,exit_time:exitTime,side:setup.candidate,setup_type:setup.setup_type,entry,stop_loss:stop,take_profit:target,lots,risk_cash:riskCash,net_pnl:pnl,net_pips:pnl/(10*lots),exit_reason:reason,holding_minutes:(exitTime-(next.time-900))/60};
}
function summarize(trades){
 let eq=CONFIG.initialEquity,peak=eq,maxDd=0,maxDdPct=0,gp=0,gl=0,w=0,l=0,h=0;
 for(const t of trades){eq+=t.net_pnl;peak=Math.max(peak,eq);const dd=peak-eq;maxDd=Math.max(maxDd,dd);maxDdPct=Math.max(maxDdPct,peak?dd/peak*100:0);if(t.net_pnl>0){w++;gp+=t.net_pnl;}else if(t.net_pnl<0){l++;gl+=-t.net_pnl;}h+=t.holding_minutes;}
 return {initial_equity:CONFIG.initialEquity,final_equity:eq,net_profit:eq-CONFIG.initialEquity,return_pct:(eq/CONFIG.initialEquity-1)*100,trades:trades.length,wins:w,losses:l,win_rate_pct:trades.length?w/trades.length*100:0,profit_factor:gl?gp/gl:gp>0?Infinity:0,expectancy_per_trade:trades.length?(eq-CONFIG.initialEquity)/trades.length:0,max_drawdown:maxDd,max_drawdown_pct:maxDdPct,avg_holding_minutes:trades.length?h/trades.length:0};
}
export async function runBacktest(){
 const rawOpen=parseCsv(await (await fetch(M15_SOURCE)).text()); const rawM15=shiftBarsToCloseTime(rawOpen,900); const rawH1=shiftBarsToCloseTime(aggregateM15ToH1(rawOpen),3600);
 const latest=rawM15.at(-1).time; const end=CONFIG.endDate?Date.parse(CONFIG.endDate+'T23:59:59Z')/1000:latest; const start=CONFIG.startDate?Date.parse(CONFIG.startDate+'T00:00:00Z')/1000:latest-CONFIG.lookbackDays*86400; const warm=start-60*86400;
 const m15=rawM15.filter(b=>b.time>=warm&&b.time<=end),h1=rawH1.filter(b=>b.time>=warm-30*86400&&b.time<=end);
 const c=m15.map(b=>b.close),e20=ema(c,20),e50=ema(c,50),r14=rsi(c,14),a14=atr(m15,14), hi=addH1(h1);
 const risk={day:null,dayStart:CONFIG.initialEquity,peak:CONFIG.initialEquity}; let equity=CONFIG.initialEquity,trades=[],nextAvailable=0;
 for(let i=210;i<m15.length-1;i++){
   const s={...m15[i],ema20:e20[i],ema50:e50[i],rsi14:r14[i],atr14:a14[i]}; if(s.time<start||s.time>end||i<nextAvailable||![s.ema20,s.ema50,s.rsi14,s.atr14].every(Number.isFinite))continue;
   const hidx=latestCompletedH1Index(hi,s.time);const hb=hidx>=0?hi[hidx]:null;if(!hb||![hb.close,hb.ema20,hb.ema50,hb.ema200].every(Number.isFinite))continue;
   const spread=CONFIG.spreadPips*0.0001, f={bid:s.close-spread/2,ask:s.close+spread/2,spread,barTime:s.time,m15:{ema20:s.ema20,ema50:s.ema50,rsi14:s.rsi14,atr14:s.atr14},h1:{close:hb.close,ema20:hb.ema20,ema50:hb.ema50,ema200:hb.ema200},recentM15:recent(m15.map((b,j)=>({...b,ema20:e20[j],ema50:e50[j],rsi14:r14[j],atr14:a14[j]})),i)};
   const setup=buildEurUsdVolatilityExpansionSetup(f,{lookback:CONFIG.lookback,breakoutAtr:CONFIG.breakoutAtr,minBodyAtr:CONFIG.minBodyAtr,minCloseLocation:CONFIG.minCloseLocation,maxSqueezeWidthAtr:CONFIG.maxSqueezeWidthAtr,minAtrExpansion:CONFIG.minAtrExpansion,buyRsiMin:CONFIG.buyRsiMin,buyRsiMax:CONFIG.buyRsiMax,sellRsiMin:CONFIG.sellRsiMin,sellRsiMax:CONFIG.sellRsiMax,minVolumeRatio:CONFIG.minVolumeRatio,requireVolume:true,maxSpreadPips:CONFIG.maxSpreadPips,minStopAtr:CONFIG.minStopAtr,maxStopAtr:CONFIG.maxStopAtr,takeProfitR:2,maxSpreadToTpPct:CONFIG.maxSpreadToTpPct});
   if(setup.candidate==='WAIT'||!riskGate(risk,equity,s.time))continue; const t=simulate(s,m15[i+1],m15.slice(i+1),setup,equity);if(!t)continue;trades.push(t);equity+=t.net_pnl;nextAvailable=m15.findIndex(b=>b.time>t.exit_time);if(nextAvailable<0)nextAvailable=m15.length;
 }
 const report=summarize(trades); report.strategy='EURUSD M15 volatility squeeze -> Bollinger expansion -> ATR expansion + H1 trend';report.symbol='EURUSD';report.test_period={start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString()};report.trades_per_week=trades.length/Math.max(1,(end-start)/(7*86400));report.execution='next M15 bar open';report.ai='excluded from historical performance; environment-only downstream';report.risk={risk_per_trade_pct:.25,max_daily_loss_pct:2,max_drawdown_pct:5};report.data_source={m15:M15_SOURCE,h1:'FROM_M15'};
 const out=process.env.BACKTEST_OUTPUT_DIR||path.resolve(__dirname,'../backtest-output-volatility-expansion');await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'volatility_expansion_report.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(out,'volatility_expansion_trades.json'),JSON.stringify(trades,null,2));
 console.log('=== EURUSD VOLATILITY EXPANSION BACKTEST ===');console.log('Test:',report.test_period.start,'->',report.test_period.end);console.log('Trades:',report.trades);console.log('Win rate:',report.win_rate_pct.toFixed(2)+'%');console.log('Profit factor:',Number(report.profit_factor).toFixed(2));console.log('Expectancy:','$'+report.expectancy_per_trade.toFixed(2));console.log('Net profit:','$'+report.net_profit.toFixed(2));console.log('Return:',report.return_pct.toFixed(2)+'%');console.log('Max DD:','$'+report.max_drawdown.toFixed(2),'/',report.max_drawdown_pct.toFixed(2)+'%');console.log('Trades/week:',report.trades_per_week.toFixed(3));
 return {report,trades};
}
function addH1(bars){const c=bars.map(b=>b.close),e20=ema(c,20),e50=ema(c,50),e200=ema(c,200),r14=rsi(c,14),a14=atr(bars,14);return bars.map((b,i)=>({...b,ema20:e20[i],ema50:e50[i],ema200:e200[i],rsi14:r14[i],atr14:a14[i]}));}
if(import.meta.url===`file://${process.argv[1]}`) await runBacktest();
