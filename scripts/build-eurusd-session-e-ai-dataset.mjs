import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEurUsdSessionRangeBreakoutSetupE } from '../src/eurusd_session_breakout_e.js';

const SPREAD=Number(process.env.EURUSD_AI_DATASET_SPREAD_PIPS||0.8);
const SLIP=Number(process.env.EURUSD_AI_DATASET_SLIPPAGE_PIPS||0.1);
const HOLD=Number(process.env.EURUSD_AI_DATASET_MAX_HOLD_BARS||96);
const TIMEZONE='Europe/London';
const OUTPUT=process.env.EURUSD_AI_DATASET_OUTPUT||'eurusd-session-e-ai-dataset.jsonl';

function ema(v,p){const o=new Array(v.length).fill(null),a=2/(p+1);let x=null;for(let i=0;i<v.length;i++){x=x===null?v[i]:a*v[i]+(1-a)*x;o[i]=x;}return o;}
function rsi(c,p){const o=new Array(c.length).fill(null);if(c.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}let ag=g/p,al=l/p;o[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function atr(b,p){const o=new Array(b.length).fill(null);if(b.length<=p)return o;const tr=b.map((x,i)=>i===0?x.high-x.low:Math.max(x.high-x.low,Math.abs(x.high-b[i-1].close),Math.abs(x.low-b[i-1].close)));let v=tr.slice(1,p+1).reduce((s,x)=>s+x,0)/p;o[p]=v;for(let i=p+1;i<b.length;i++){v=(v*(p-1)+tr[i])/p;o[i]=v;}return o;}
function indicators(b){const c=b.map(x=>x.close),e20=ema(c,20),e50=ema(c,50),e200=ema(c,200),rr=rsi(c,14),a=atr(b,14);return b.map((x,i)=>({...x,ema20:e20[i],ema50:e50[i],ema200:e200[i],rsi14:rr[i],atr14:a[i]}));}
function localParts(ts){return new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(new Date(ts*1000)).reduce((o,p)=>{if(p.type!=='literal')o[p.type]=p.value;return o;},{});}
function localKey(ts){const p=localParts(ts);return `${p.year}-${p.month}-${p.day}`;}
function h1Key(ts){const p=localParts(ts);return String(p.year)+'-'+String(p.month)+'-'+String(p.day)+'-'+String(p.hour);}
function h1Agg(m){const map=new Map();for(const b of m){const k=h1Key(b.time),x=map.get(k);if(!x)map.set(k,{time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume});else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=b.volume;}}return [...map.values()].sort((a,b)=>a.time-b.time);}
function latestCompletedH1(h,t){let lo=0,hi=h.length-1,ans=-1;while(lo<=hi){const m=Math.floor((lo+hi)/2);if(h[m].time+3600<=t){ans=m;lo=m+1;}else hi=m-1;}return ans;}
function futureOutcome(bars,i,dir,entry,stop,target){
  const spread=SPREAD*0.0001,sl=SLIP*0.0001,end=Math.min(bars.length-1,i+HOLD);
  const risk=Math.abs(entry-stop);let mfe=0,mae=0,hitStop=false,hitTarget=false,exitR=0,exitReason='TIME',exitIndex=end;
  for(let j=i+1;j<=end;j++){
    const favorable=dir==='BUY'?(bars[j].high-entry):(entry-(bars[j].low+spread));
    const adverse=dir==='BUY'?(entry-bars[j].low):((bars[j].high+spread)-entry);
    mfe=Math.max(mfe,favorable/risk);mae=Math.max(mae,adverse/risk);
    const hs=dir==='BUY'?bars[j].low<=stop:bars[j].high+spread>=stop;
    const ht=dir==='BUY'?bars[j].high>=target:bars[j].low+spread<=target;
    if(hs){hitStop=true;exitReason='STOP';exitIndex=j;exitR=dir==='BUY'?(stop-sl-entry)/risk:(entry-(stop+sl))/risk;break;}
    if(ht){hitTarget=true;exitReason='TARGET';exitIndex=j;exitR=dir==='BUY'?(target-sl-entry)/risk:(entry-(target+sl))/risk;break;}
  }
  if(exitReason==='TIME'){
    const px=dir==='BUY'?bars[end].close:bars[end].close+spread;
    exitR=dir==='BUY'?(px-sl-entry)/risk:(entry-(px+sl))/risk;
  }
  const returns={};for(const n of [4,8,16,32,64]){const j=Math.min(bars.length-1,i+n);const px=dir==='BUY'?bars[j].close:bars[j].close+spread;returns[`fwd_${n}_m15_r`]=dir==='BUY'?(px-entry)/risk:(entry-px)/risk;}
  return {outcome_r:exitR,hit_target:hitTarget,hit_stop:hitStop,exit_reason:exitReason,hold_bars:exitIndex-i,mfe_r:mfe,mae_r:mae,...returns};
}
async function main(){
  const file=process.env.EURUSD_AI_DATASET_INPUT||'data/eurusd-m15-bid.json';
  const payload=JSON.parse(await fs.readFile(file,'utf8'));
  if(!Array.isArray(payload.bars)||payload.bars.length<100000)throw new Error('Dataset safety check failed');
  const m=indicators(payload.bars),h=indicators(h1Agg(m)),rows=[];
  for(let i=500;i<m.length-HOLD-2;i++){
    const t=m[i].time+900,hi=latestCompletedH1(h,t);if(hi<200)continue;
    const b=m[i],sp=SPREAD*0.0001;
    const features={
      barTime:t,bid:b.close-sp/2,ask:b.close+sp/2,spread:sp,
      m15:{ema20:b.ema20,ema50:b.ema50,rsi14:b.rsi14,atr14:b.atr14},
      h1:{close:h[hi].close,ema20:h[hi].ema20,ema50:h[hi].ema50,ema200:h[hi].ema200,rsi14:h[hi].rsi14,atr14:h[hi].atr14},
      recentM15:m.slice(Math.max(0,i-79),i+1).map(x=>({...x,time:x.time+900})),
      recentH1:h.slice(Math.max(0,hi-79),hi+1).map(x=>({...x,time:x.time+3600}))
    };
    const s=buildEurUsdSessionRangeBreakoutSetupE(features);
    if(s.candidate==='WAIT')continue;
    const lp=localParts(t),dayOfWeek=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(lp.weekday);
    const trendDir=s.candidate==='BUY'?1:-1;
    const triggerRange=Math.max(1e-12,b.high-b.low);
    const pWidth=s.range_width_atr;
    const breakoutDist=s.candidate==='BUY'?(b.close-s.range_high)/b.atr14:(s.range_low-b.close)/b.atr14;
    const h1Ext=h[hi].atr14>0?Math.abs(h[hi].close-h[hi].ema50)/h[hi].atr14:null;
    const bodyAtr=Math.abs(b.close-b.open)/b.atr14;
    const closeLoc=s.candidate==='BUY'?(b.close-b.low)/triggerRange:(b.high-b.close)/triggerRange;
    const entry=s.entry,stop=s.stop_loss,target=s.take_profit;
    const label=futureOutcome(m,i,s.candidate,entry,stop,target);
    const split=t < Date.parse(new Date(Date.parse(payload.last_bar_time)-365*86400000).toISOString())/1000 ? 'development':'validation_recent_365d';
    rows.push({
      schema_version:'eurusd_session_e_ai_v1',
      split,
      signal_time:new Date(t*1000).toISOString(),
      session_key:s.session_key,
      direction:s.candidate,
      point_in_time_features:{
        direction:trendDir,
        london_hour:Number(lp.hour),
        day_of_week:dayOfWeek,
        spread_pips:s.spread_pips,
        range_width_atr:pWidth,
        breakout_distance_atr:breakoutDist,
        h1_slope_agreement:s.h1_slope_agreement,
        h1_extension_atr:h1Ext,
        m15_rsi14:b.rsi14,
        m15_ema20_distance_atr:(b.close-b.ema20)/b.atr14,
        m15_ema50_distance_atr:(b.close-b.ema50)/b.atr14,
        m15_body_atr:bodyAtr,
        m15_close_location:closeLoc,
        m15_range_atr:triggerRange/b.atr14,
        stop_atr:s.stop_atr,
        spread_to_tp_pct:s.spread_to_tp_pct,
        range_high:s.range_high,
        range_low:s.range_low
      },
      decision_context:{setup_type:s.setup_type,trend:s.trend,take_profit_r:s.risk_reward,max_trades_per_session:s.max_trades_per_session},
      label
    });
  }
  await fs.mkdir(path.dirname(OUTPUT)==='.'?'.':path.dirname(OUTPUT),{recursive:true});
  const text=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
  await fs.writeFile(OUTPUT,text);
  const counts=rows.reduce((a,r)=>(a[r.split]=(a[r.split]||0)+1,a),{});
  console.log(JSON.stringify({rows:rows.length,split_counts:counts,output:OUTPUT},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
