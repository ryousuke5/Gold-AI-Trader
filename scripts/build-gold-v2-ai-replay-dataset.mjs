import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { buildGoldV2Setup } from '../src/gold_strategy_v2.js';

const OUT=path.resolve(process.env.GOLD_AI_REPLAY_OUTPUT_DIR||'gold-ai-replay');
const INPUT=process.env.GOLD_BACKTEST_DATA_FILE;
const START=process.env.GOLD_BACKTEST_START_UTC;
const END=process.env.GOLD_BACKTEST_END_UTC;
const CONFIG={
  lookbackDays:Math.max(365,Number(process.env.GOLD_BACKTEST_LOOKBACK_DAYS||1825)),
  spreadPrice:Math.max(0,Number(process.env.GOLD_BACKTEST_SPREAD_PRICE||0.50)),
  slippagePrice:Math.max(0,Number(process.env.GOLD_BACKTEST_SLIPPAGE_PRICE||0.05)),
  maxHoldBars:Math.max(1,Math.floor(Number(process.env.GOLD_BACKTEST_MAX_HOLD_BARS||96))),
  maxEntryGapAtr:Math.max(0.1,Number(process.env.GOLD_BACKTEST_MAX_ENTRY_GAP_ATR||0.50)),
  minEffectiveRR:Math.max(0.5,Number(process.env.GOLD_BACKTEST_MIN_EFFECTIVE_RR||1.50))
};
const STRATEGY={
  rangeLookback:Math.max(4,Number(process.env.GOLD_RANGE_LOOKBACK||12)),
  minRangeAtr:Math.max(0.1,Number(process.env.GOLD_MIN_RANGE_ATR||0.8)),
  maxRangeAtr:Math.max(0.2,Number(process.env.GOLD_MAX_RANGE_ATR||2.8)),
  breakoutAtr:Math.max(0.01,Number(process.env.GOLD_BREAKOUT_ATR||0.10)),
  minBodyAtr:Math.max(0.05,Number(process.env.GOLD_MIN_BODY_ATR||0.40)),
  minCloseLocation:Math.min(0.95,Math.max(0.50,Number(process.env.GOLD_MIN_CLOSE_LOCATION||0.65))),
  minVolumeRatio:Math.max(0.1,Number(process.env.GOLD_MIN_VOLUME_RATIO||1.10)),
  buyRsiMin:Math.max(1,Number(process.env.GOLD_BUY_RSI_MIN||52)),
  buyRsiMax:Math.min(99,Number(process.env.GOLD_BUY_RSI_MAX||75)),
  sellRsiMin:Math.max(1,Number(process.env.GOLD_SELL_RSI_MIN||25)),
  sellRsiMax:Math.min(99,Number(process.env.GOLD_SELL_RSI_MAX||48)),
  maxExtensionAtr:Math.max(0.1,Number(process.env.GOLD_MAX_EXTENSION_ATR||1.50)),
  stopBufferAtr:Math.max(0,Number(process.env.GOLD_STOP_BUFFER_ATR||0.15)),
  minStopAtr:Math.max(0.1,Number(process.env.GOLD_MIN_STOP_ATR||0.80)),
  maxStopAtr:Math.max(0.2,Number(process.env.GOLD_MAX_STOP_ATR||2.00)),
  takeProfitR:Math.max(1.0,Number(process.env.GOLD_TAKE_PROFIT_R||2.00)),
  minH1RsiBuy:Math.max(1,Number(process.env.GOLD_MIN_H1_RSI_BUY||50)),
  maxH1RsiBuy:Math.min(99,Number(process.env.GOLD_MAX_H1_RSI_BUY||72)),
  minH1RsiSell:Math.max(1,Number(process.env.GOLD_MIN_H1_RSI_SELL||28)),
  maxH1RsiSell:Math.min(99,Number(process.env.GOLD_MAX_H1_RSI_SELL||50)),
  sessionStartUtc:Math.min(23,Math.max(0,Math.floor(Number(process.env.GOLD_SESSION_START_UTC||7)))),
  sessionEndUtc:Math.min(23,Math.max(0,Math.floor(Number(process.env.GOLD_SESSION_END_UTC||20))))
};
function ema(v,p){const o=new Array(v.length).fill(null),a=2/(p+1);let x=null;for(let i=0;i<v.length;i++){const n=Number(v[i]);if(!Number.isFinite(n))continue;x=x===null?n:a*n+(1-a)*x;o[i]=x;}return o;}
function rsi(c,p){const o=new Array(c.length).fill(null);if(c.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}let ag=g/p,al=l/p;o[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function atr(b,p){const o=new Array(b.length).fill(null),tr=new Array(b.length).fill(0);if(b.length<=p)return o;for(let i=0;i<b.length;i++)tr[i]=i?Math.max(b[i].high-b[i].low,Math.abs(b[i].high-b[i-1].close),Math.abs(b[i].low-b[i-1].close)):b[i].high-b[i].low;let s=0;for(let i=1;i<=p;i++)s+=tr[i];let x=s/p;o[p]=x;for(let i=p+1;i<b.length;i++){x=(x*(p-1)+tr[i])/p;o[i]=x;}return o;}
function indicators(b){const c=b.map(x=>x.close),e20=ema(c,20),e50=ema(c,50),e200=ema(c,200),r=rsi(c,14),a=atr(b,14);return b.map((x,i)=>({...x,ema20:e20[i],ema50:e50[i],ema200:e200[i],rsi14:r[i],atr14:a[i]}));}
function h1(m){const map=new Map();for(const b of m){const t=Math.floor(b.time/3600)*3600,x=map.get(t);if(!x)map.set(t,{time:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume});else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=b.volume;}}return [...map.values()].sort((a,b)=>a.time-b.time);}
function h1idx(h,t){let lo=0,hi=h.length-1,b=-1;while(lo<=hi){const m=(lo+hi)>>1;if(h[m].time+3600<=t){b=m;lo=m+1;}else hi=m-1;}return b;}
function recent(b,i,n=80){return b.slice(Math.max(0,i-n+1),i+1).map(x=>({...x,time:x.time+300}));}
function executableOutcome(signal,next,future,setup){
  const side=setup.candidate,entry=side==='BUY'?next.open+CONFIG.spreadPrice+CONFIG.slippagePrice:next.open-CONFIG.slippagePrice;
  const stop=setup.stop_loss,target=setup.take_profit,dist=Math.abs(entry-stop);
  const gap=Math.abs(next.open-signal.close)/Math.max(1e-6,Number(signal.atr14));
  const effectiveRR=Math.abs(target-entry)/dist;
  if(!(entry>0&&stop>0&&target>0&&dist>0&&gap<=CONFIG.maxEntryGapAtr&&effectiveRR>=CONFIG.minEffectiveRR))
    return {eligible:false,reason:'execution_filter',entry_gap_atr:gap,effective_rr:effectiveRR};
  const scan=future.slice(0,CONFIG.maxHoldBars);let exit=scan.at(-1)||next,reason='TIME',price=exit?.close??next.close,prev=null;
  for(const b of scan){if(prev&&b.time-prev.time>900){exit=prev;reason='DATA_GAP';price=side==='BUY'?prev.close-CONFIG.slippagePrice:prev.close+CONFIG.spreadPrice+CONFIG.slippagePrice;break;}
    const sh=side==='BUY'?b.low<=stop:b.high+CONFIG.spreadPrice>=stop,th=side==='BUY'?b.high>=target:b.low+CONFIG.spreadPrice<=target;
    if(sh){exit=b;reason='STOP';price=side==='BUY'?stop-CONFIG.slippagePrice:stop+CONFIG.spreadPrice+CONFIG.slippagePrice;break;}
    if(th){exit=b;reason='TARGET';price=side==='BUY'?target-CONFIG.slippagePrice:target+CONFIG.spreadPrice+CONFIG.slippagePrice;break;}
    prev=b;}
  const r=(side==='BUY'?price-entry:entry-price)/dist;
  return {eligible:true,outcome:r>0?'WIN':r<0?'LOSS':'BREAKEVEN',net_r:r,exit_reason:reason,entry,entry_gap_atr:gap,effective_rr:effectiveRR,exit_time:exit.time};
}
async function load(){if(!INPUT)throw Error('GOLD_BACKTEST_DATA_FILE is required for deterministic replay build');const raw=await fs.readFile(path.resolve(INPUT));const text=INPUT.endsWith('.gz')?gunzipSync(raw).toString('utf8'):raw.toString('utf8');return JSON.parse(text).map(b=>({time:Number(b.time),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume)||0})).filter(b=>Number.isFinite(b.time)&&b.open>0&&b.high>=b.low&&b.high>=b.open&&b.high>=b.close&&b.low<=b.open&&b.low<=b.close).sort((a,b)=>a.time-b.time);}
function sha256(s){return crypto.createHash('sha256').update(s).digest('hex');}
const raw=await load();if(raw.length<200000)throw Error('Insufficient data: '+raw.length);
const m=indicators(raw),h=indicators(h1(raw));const sourceFingerprint=sha256(raw.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume].join('|')).join('\n'));
await fs.mkdir(OUT,{recursive:true});
const file=path.join(OUT,'gold_v2_ai_replay_dataset.jsonl');
const manifest=path.join(OUT,'manifest.json');
await fs.writeFile(file,'');
let candidates=0,eligible=0,wins=0,losses=0;
for(let i=250;i<m.length-1;i++){
  const s=m[i],st=s.time+300,hi=h1idx(h,st),hv=h[hi];
  if(!hv||![s.ema20,s.ema50,s.rsi14,s.atr14,hv.close,hv.ema20,hv.ema50,hv.ema200,hv.rsi14,hv.atr14].every(Number.isFinite))continue;
  const recentM5=recent(m,i,Math.max(80,STRATEGY.rangeLookback+1));
  const features={m5:{ema20:s.ema20,ema50:s.ema50,rsi14:s.rsi14,atr14:s.atr14},h1:{close:hv.close,ema20:hv.ema20,ema50:hv.ema50,ema200:hv.ema200,rsi14:hv.rsi14,atr14:hv.atr14},recentM5};
  const setup=buildGoldV2Setup(features,STRATEGY);
  if(setup.candidate==='WAIT')continue;
  if(m[i+1].time-s.time!==300)continue;
  const outcome=executableOutcome(s,m[i+1],m.slice(i+1),setup);
  const id=sha256([sourceFingerprint,s.time,setup.candidate,setup.entry_reference,setup.stop_loss,setup.take_profit].join('|')).slice(0,24);
  const row={schema_version:1,candidate_id:id,asof_time:st,asof_iso:new Date(st*1000).toISOString(),symbol:'XAUUSD',candidate:setup.candidate,features,setup,execution:outcome,historical_context:{news_snapshot_required:true,web_search_forbidden_during_replay:true}};
  await fs.appendFile(file,JSON.stringify(row)+'\n');candidates++;if(outcome.eligible){eligible++;if(outcome.net_r>0)wins++;if(outcome.net_r<0)losses++;}
}
const meta={schema_version:1,created_at:new Date().toISOString(),source_data:{path:path.resolve(INPUT),rows:raw.length,content_sha256:sourceFingerprint},period:{start_utc:START||null,end_utc:END||null},config:CONFIG,strategy:STRATEGY,counts:{candidates,eligible,wins,losses}};
await fs.writeFile(manifest,JSON.stringify(meta,null,2));console.log(JSON.stringify(meta,null,2));
