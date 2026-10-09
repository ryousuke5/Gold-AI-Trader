import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildEurUsdSetup } from '../src/eurusd_features.js';

const C = {
  data: process.env.LEGACY_CORE_DATA_FILE || 'eurusd-core-v4-data/eurusd-m15.json.gz',
  out: process.env.LEGACY_CORE_OUTPUT_DIR || 'eurusd-legacy-core-backtest-output',
  scenarioName: String(process.env.LEGACY_CORE_SCENARIO_NAME || 'unspecified'),
  scenarioType: String(process.env.LEGACY_CORE_SCENARIO_TYPE || 'unspecified'),
  tz: 'Europe/Nicosia',
  spread: Number(process.env.LEGACY_CORE_SPREAD_PIPS || 0.8),
  slip: Number(process.env.LEGACY_CORE_SLIPPAGE_PIPS || 0.1),
  hold: Number(process.env.LEGACY_CORE_MAX_HOLD_BARS || 96),
  cooldown: Number(process.env.LEGACY_CORE_COOLDOWN_BARS || 2),
  rangeLookback: Number(process.env.LEGACY_CORE_RANGE_LOOKBACK || 6),
  minRangeAtr: Number(process.env.LEGACY_CORE_MIN_RANGE_ATR || 0.75),
  maxRangeAtr: Number(process.env.LEGACY_CORE_MAX_RANGE_ATR || 2.00),
  breakoutAtr: Number(process.env.LEGACY_CORE_BREAKOUT_ATR || 0.10),
  minBodyAtr: Number(process.env.LEGACY_CORE_MIN_BODY_ATR || 0.35),
  minCloseLocation: Number(process.env.LEGACY_CORE_BREAKOUT_CLOSE_LOCATION || 0.70),
  minVolumeRatio: Number(process.env.LEGACY_CORE_MIN_VOLUME_RATIO || 1.10),
  buyRsiMin: Number(process.env.LEGACY_CORE_BUY_RSI_MIN || 50),
  buyRsiMax: Number(process.env.LEGACY_CORE_BUY_RSI_MAX || 68),
  sellRsiMin: Number(process.env.LEGACY_CORE_SELL_RSI_MIN || 32),
  sellRsiMax: Number(process.env.LEGACY_CORE_SELL_RSI_MAX || 50),
  minStopAtr: Number(process.env.LEGACY_CORE_MIN_STOP_ATR || 0.50),
  maxStopAtr: Number(process.env.LEGACY_CORE_MAX_STOP_ATR || 1.50),
  tpR: Number(process.env.LEGACY_CORE_TP_R || 2.00),
  maxSpreadPips: Number(process.env.LEGACY_CORE_MAX_SPREAD_PIPS || 1.20),
  maxSpreadToTpPct: Number(process.env.LEGACY_CORE_MAX_SPREAD_TO_TP_PCT || 12)
};

async function load() {
  const raw = await fs.readFile(C.data);
  const text = C.data.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const rows = JSON.parse(text);
  return rows.map(b => ({time:Number(b.time),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume)||0}))
    .filter(b => Number.isFinite(b.time) && b.open>0 && b.high>=b.low && b.high>=b.open && b.high>=b.close && b.low<=b.open && b.low<=b.close)
    .sort((a,b)=>a.time-b.time);
}

function ema(v,p){const o=new Array(v.length).fill(null),a=2/(p+1);let x=null;for(let i=0;i<v.length;i++){x=x===null?v[i]:a*v[i]+(1-a)*x;o[i]=x;}return o;}
function rsi(v,p){const o=new Array(v.length).fill(null);if(v.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const d=v[i]-v[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}let ag=g/p,al=l/p;o[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<v.length;i++){const d=v[i]-v[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function atr(b,p){const o=new Array(b.length).fill(null);if(b.length<=p)return o;let v=0;const tr=new Array(b.length);for(let i=0;i<b.length;i++)tr[i]=i?Math.max(b[i].high-b[i].low,Math.abs(b[i].high-b[i-1].close),Math.abs(b[i].low-b[i-1].close)):b[i].high-b[i].low;for(let i=1;i<=p;i++)v+=tr[i];v/=p;o[p]=v;for(let i=p+1;i<b.length;i++){v=(v*(p-1)+tr[i])/p;o[i]=v;}return o;}
function indicators(b){const c=b.map(x=>x.close),e20=ema(c,20),e50=ema(c,50),e200=ema(c,200),rr=rsi(c,14),aa=atr(b,14);return b.map((x,i)=>({...x,ema20:e20[i],ema50:e50[i],ema200:e200[i],rsi14:rr[i],atr14:aa[i]}));}
function local(ts,tz){const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts*1000)).reduce((o,x)=>(x.type==='literal'?o:(o[x.type]=Number(x.value),o)),{});const localMs=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second),off=Math.round((localMs-ts*1000)/1000),hMs=Date.UTC(p.year,p.month-1,p.day,p.hour);return Math.floor((hMs-off*1000)/1000);}
function h1agg(m){const map=new Map();for(const b of m){const t=local(b.time,C.tz),x=map.get(t);if(!x)map.set(t,{time:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume});else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=b.volume;}}return [...map.values()].sort((a,b)=>a.time-b.time);}
function latestH1(h,t){let lo=0,hi=h.length-1,b=-1;while(lo<=hi){const m=(lo+hi)>>1;if(h[m].time+3600<=t){b=m;lo=m+1;}else hi=m-1;}return b;}
function stats(ts){const rs=ts.map(t=>t.r),w=rs.filter(x=>x>0),l=rs.filter(x=>x<0);let eq=0,peak=0,dd=0;for(const x of rs){eq+=x;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);}return {trades:rs.length,wins:w.length,losses:l.length,win_rate_pct:rs.length?w.length/rs.length*100:0,net_r:rs.reduce((a,b)=>a+b,0),expectancy_r:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:0,profit_factor:l.length?w.reduce((a,b)=>a+b,0)/(-l.reduce((a,b)=>a+b,0)):null,max_drawdown_r:dd};}
function simulate(m,i,s){const sp=C.spread*1e-4,sl=C.slip*1e-4,side=s.candidate,entry=side==='BUY'?m[i+1].open+sp/2+sl:m[i+1].open-sp/2-sl,stopDist=Math.abs(entry-s.stop_loss);if(!(stopDist>0))return null;const stop=side==='BUY'?entry-stopDist:entry+stopDist,target=side==='BUY'?entry+stopDist*C.tpR:entry-stopDist*C.tpR;const end=Math.min(m.length-1,i+C.hold);let r=0,reason='TIME',ei=end;for(let j=i+1;j<=end;j++){const b=m[j],sh=side==='BUY'?b.low-sp/2<=stop:b.high+sp/2>=stop,th=side==='BUY'?b.high-sp/2>=target:b.low+sp/2<=target;if(sh&&th||sh){r=side==='BUY'?(stop-sl-entry)/stopDist:(entry-(stop+sl))/stopDist;reason=sh&&th?'STOP_AND_TARGET_SAME_BAR':'STOP';ei=j;break;}if(th){r=side==='BUY'?(target-sl-entry)/stopDist:(entry-(target+sl))/stopDist;reason='TARGET';ei=j;break;}}if(reason==='TIME'){const px=side==='BUY'?m[end].close:m[end].close+sp/2;r=side==='BUY'?(px-sl-entry)/stopDist:(entry-(px+sl))/stopDist;}return {signal_time:new Date((m[i].time+900)*1000).toISOString(),direction:side,r,exit_reason:reason,exit_time:new Date((m[ei].time+900)*1000).toISOString()};}

const m=indicators(await load()),h=indicators(h1agg(m));const trades=[];let next=0;const diagnostics={
  evaluated:0,
  candidates:0,
  h1_up:0,
  h1_down:0,
  h1_range:0,
  waits:0,
  wait_reasons:{},
  h1_trend_breakdown:{
    bullish_ema_stack:0,
    bearish_ema_stack:0,
    close_at_or_above_ema20:0,
    close_at_or_below_ema20:0,
    bullish_stack_rejected_by_close:0,
    bearish_stack_rejected_by_close:0,
    mixed_ema_stack:0,
    confirmed_up:0,
    confirmed_down:0
  }
};
for(let i=250;i<m.length-2;i++){if(i<next)continue;const hi=latestH1(h,m[i].time+900);if(hi<200)continue;diagnostics.evaluated++;const b=m[i];const hb=h[hi];const f={bid:b.close-C.spread*1e-4/2,ask:b.close+C.spread*1e-4/2,point:1e-5,spread:C.spread*1e-4,barTime:b.time+900,m15:{ema20:b.ema20,ema50:b.ema50,rsi14:b.rsi14,atr14:b.atr14},h1:{close:hb.close,ema20:hb.ema20,ema50:hb.ema50,ema200:hb.ema200,rsi14:hb.rsi14,atr14:hb.atr14},recentM15:m.slice(Math.max(0,i-79),i+1).map(x=>({...x,time:x.time+900})),recentH1:h.slice(Math.max(0,hi-79),hi+1).map(x=>({...x,time:x.time+3600}))};
const s=buildEurUsdSetup(f,{rangeLookback:C.rangeLookback,minRangeAtr:C.minRangeAtr,maxRangeAtr:C.maxRangeAtr,breakoutAtr:C.breakoutAtr,minBodyAtr:C.minBodyAtr,minCloseLocation:C.minCloseLocation,minVolumeRatio:C.minVolumeRatio,maxSpreadPips:C.maxSpreadPips,maxSpreadAtrPct:15,minStopAtr:C.minStopAtr,maxStopAtr:C.maxStopAtr,takeProfitR:C.tpR,maxSpreadToTpPct:C.maxSpreadToTpPct,buyRsiMin:C.buyRsiMin,buyRsiMax:C.buyRsiMax,sellRsiMin:C.sellRsiMin,sellRsiMax:C.sellRsiMax});
const bullStack=hb.ema20>hb.ema50&&hb.ema50>hb.ema200;
const bearStack=hb.ema20<hb.ema50&&hb.ema50<hb.ema200;
const closeAtOrAbove=hb.close>=hb.ema20;
const closeAtOrBelow=hb.close<=hb.ema20;
if(bullStack)diagnostics.h1_trend_breakdown.bullish_ema_stack++;
if(bearStack)diagnostics.h1_trend_breakdown.bearish_ema_stack++;
if(closeAtOrAbove)diagnostics.h1_trend_breakdown.close_at_or_above_ema20++;
if(closeAtOrBelow)diagnostics.h1_trend_breakdown.close_at_or_below_ema20++;
if(bullStack&&!closeAtOrAbove)diagnostics.h1_trend_breakdown.bullish_stack_rejected_by_close++;
if(bearStack&&!closeAtOrBelow)diagnostics.h1_trend_breakdown.bearish_stack_rejected_by_close++;
if(!bullStack&&!bearStack)diagnostics.h1_trend_breakdown.mixed_ema_stack++;
if(s.trend==='UP'){diagnostics.h1_up++;diagnostics.h1_trend_breakdown.confirmed_up++;}
else if(s.trend==='DOWN'){diagnostics.h1_down++;diagnostics.h1_trend_breakdown.confirmed_down++;}
else diagnostics.h1_range++;
if(s.candidate==='WAIT'){diagnostics.waits++;for(const x of s.reasons||[])diagnostics.wait_reasons[x]=(diagnostics.wait_reasons[x]||0)+1;continue;}
diagnostics.candidates++;const t=simulate(m,i,s);if(t){trades.push(t);next=i+Math.max(1,Math.ceil((Date.parse(t.exit_time)-Date.parse(t.signal_time))/900000))+C.cooldown;}}
const cutoff=new Date(Date.now()-365*86400000),recent=trades.filter(t=>new Date(t.signal_time)>=cutoff),prior=trades.filter(t=>new Date(t.signal_time)<cutoff);
const lastBarTime = m.length ? m[m.length - 1].time + 900 : 0;
const shiftUtcYears = (unixSeconds, years) => {
  const date = new Date(unixSeconds * 1000);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return Math.floor(date.getTime() / 1000);
};
const fiveYearStart = lastBarTime ? shiftUtcYears(lastBarTime, -5) : 0;
const twoYearOosStart = lastBarTime ? shiftUtcYears(lastBarTime, -2) : 0;
const lastFiveYears = trades.filter(t => Date.parse(t.signal_time) / 1000 >= fiveYearStart);
const inSample = lastFiveYears.filter(t => Date.parse(t.signal_time) / 1000 < twoYearOosStart);
const outOfSample = lastFiveYears.filter(t => Date.parse(t.signal_time) / 1000 >= twoYearOosStart);
const report={
  strategy:'EURUSD legacy range breakout + H1 trend',
  scenario:{name:C.scenarioName,type:C.scenarioType},
  generated_at:new Date().toISOString(),
  data:{
    bars:m.length,
    source:C.data,
    spread_history_available:false,
    spread_model:'constant assumed spread; historical OHLCV dataset does not contain per-bar bid/ask spread'
  },
  parameters:{
    rangeLookback:C.rangeLookback,
    minRangeAtr:C.minRangeAtr,
    maxRangeAtr:C.maxRangeAtr,
    breakoutAtr:C.breakoutAtr,
    minBodyAtr:C.minBodyAtr,
    minCloseLocation:C.minCloseLocation,
    minVolumeRatio:C.minVolumeRatio,
    buyRsi:[C.buyRsiMin,C.buyRsiMax],
    sellRsi:[C.sellRsiMin,C.sellRsiMax],
    tpR:C.tpR,
    maxSpreadPips:C.maxSpreadPips,
    maxSpreadToTpPct:C.maxSpreadToTpPct
  },
  execution:{
    spread_pips:C.spread,
    slippage_pips:C.slip,
    max_hold_bars:C.hold,
    cooldown_bars:C.cooldown
  },
  overall:stats(trades),
  recent_365_days:stats(recent),
  prior_period:stats(prior),
  fixed_five_year_validation:{
    period_start:fiveYearStart?new Date(fiveYearStart*1000).toISOString():null,
    period_end:lastBarTime?new Date(lastBarTime*1000).toISOString():null,
    is_period:{start:fiveYearStart?new Date(fiveYearStart*1000).toISOString():null,end:twoYearOosStart?new Date(twoYearOosStart*1000).toISOString():null,...stats(inSample)},
    oos_period:{start:twoYearOosStart?new Date(twoYearOosStart*1000).toISOString():null,end:lastBarTime?new Date(lastBarTime*1000).toISOString():null,...stats(outOfSample)}
  },
  diagnostics
};
await fs.mkdir(C.out,{recursive:true});await fs.writeFile(path.join(C.out,'summary.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(C.out,'trades.csv'),['signal_time,direction,r,exit_reason,exit_time',...trades.map(t=>[t.signal_time,t.direction,t.r,t.exit_reason,t.exit_time].join(','))].join('\n')+'\n');console.log(JSON.stringify(report,null,2));
