import fs from 'node:fs/promises';
import path from 'node:path';

const DIR=path.resolve(process.env.GOLD_AI_REPLAY_DIR||'gold-ai-replay');
const DATA=path.resolve(process.env.GOLD_AI_REPLAY_DATASET||path.join(DIR,'gold_v2_ai_replay_dataset.jsonl'));
const RESULTS=path.resolve(process.env.GOLD_AI_REPLAY_RESULTS||path.join(DIR,'ai_filter_results.jsonl'));
const OUT=path.resolve(process.env.GOLD_AI_REPLAY_WALKFORWARD_REPORT||path.join(DIR,'gold_v2_ai_walkforward.json'));

const MIN_TRAIN_TRADES=Math.max(5,Number(process.env.GOLD_AI_REPLAY_MIN_TRAIN_TRADES||30));
const START_RATIO=0.50, VALID_RATIO=0.10, HOLDOUT_RATIO=0.20;
const thresholds=Array.from({length:9},(_,i)=>0.50+i*0.05);

async function lines(file){return (await fs.readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}
const rows=await lines(DATA), resultRows=await lines(RESULTS);
const byId=new Map(resultRows.map(x=>[String(x.candidate_id),x]));
const candidates=rows.filter(x=>x.execution?.eligible===true).sort((a,b)=>Number(a.asof_time)-Number(b.asof_time));
const missing=candidates.filter(x=>!byId.has(String(x.candidate_id)));
if(missing.length)throw new Error('Incomplete AI coverage: '+missing.length+' candidates missing');
const bad=resultRows.filter(x=>x.error===true||!['APPROVE','REJECT','UNCLEAR'].includes(String(x.replay?.decision||'').toUpperCase()));
if(bad.length)throw new Error('Invalid/error AI results: '+bad.length);

function gate(x,t){const a=byId.get(String(x.candidate_id))?.replay;return a?.decision==='APPROVE'&&a?.candidate_alignment==='ALIGNED'&&Number(a.score)>=t;}
function pick(items,fn){const chosen=[];let available=-Infinity;for(const x of [...items].sort((a,b)=>Number(a.asof_time)-Number(b.asof_time))){if(!fn(x))continue;if(Number(x.asof_time)<available)continue;chosen.push(x);available=Number(x.execution.exit_time)+300;}return chosen;}
function metrics(items){
 const rs=items.map(x=>Number(x.execution.net_r)).filter(Number.isFinite);
 const w=rs.filter(x=>x>0),l=rs.filter(x=>x<0),gw=w.reduce((s,x)=>s+x,0),gl=Math.abs(l.reduce((s,x)=>s+x,0));
 let eq=0,peak=0,mdd=0,lossStreak=0,maxLossStreak=0;
 for(const x of rs){eq+=x;peak=Math.max(peak,eq);mdd=Math.max(mdd,peak-eq);if(x<0){lossStreak++;maxLossStreak=Math.max(maxLossStreak,lossStreak)}else lossStreak=0;}
 return {trades:rs.length,netR:rs.reduce((s,x)=>s+x,0),expectancyR:rs.length?rs.reduce((s,x)=>s+x,0)/rs.length:0,profitFactor:gl>0?gw/gl:null,winRate:rs.length?w.length/rs.length:0,maxDrawdownR:mdd,maxConsecutiveLosses:maxLossStreak};
}
function objective(m,baseline){
 if(m.trades<MIN_TRAIN_TRADES)return null;
 const improvement=m.expectancyR-baseline.expectancyR;
 return {primary:m.expectancyR,improvement,secondary:m.profitFactor??-Infinity,drawdown:m.maxDrawdownR,trades:m.trades};
}
function between(items,startTime,endTimeExclusive){return items.filter(x=>Number(x.asof_time)>=startTime&&Number(x.asof_time)<endTimeExclusive);}
function better(a,b){
 if(!b)return true;
 if(a.primary!==b.primary)return a.primary>b.primary;
 if(a.improvement!==b.improvement)return a.improvement>b.improvement;
 if(a.secondary!==b.secondary)return a.secondary>b.secondary;
 if(a.drawdown!==b.drawdown)return a.drawdown<b.drawdown;
 return a.trades>b.trades;
}

const n=candidates.length;
const trainEnd=Math.floor(n*START_RATIO);
const valEnd=Math.floor(n*(START_RATIO+VALID_RATIO));
const holdoutStart=valEnd;
const train=candidates.slice(0,trainEnd);
const validation=candidates.slice(trainEnd,valEnd);
const holdout=candidates.slice(holdoutStart);
const trainBase=metrics(pick(train,()=>true));
let best=null;
for(const t of thresholds){const filtered=metrics(pick(train,x=>gate(x,t)));const score=objective(filtered,trainBase);if(score&&better(score,best?.score))best={threshold:t,score,metrics:filtered};}
if(!best)throw new Error('No threshold met minimum development trade count');
const chosen=best.threshold;
const validationStart=Number(validation[0]?.asof_time);
const holdoutStartTime=Number(holdout[0]?.asof_time);
const endTime=Number(candidates.at(-1)?.asof_time)+1;
const baselineAll=pick(candidates,()=>true);
const filteredAll=pick(candidates,x=>gate(x,chosen));
const validationBase=metrics(between(baselineAll,validationStart,holdoutStartTime));
const validationFiltered=metrics(between(filteredAll,validationStart,holdoutStartTime));
const holdoutBase=metrics(between(baselineAll,holdoutStartTime,endTime));
const holdoutFiltered=metrics(between(filteredAll,holdoutStartTime,endTime));
const report={
 schema_version:1,generated_at:new Date().toISOString(),
 split:{method:'chronological_candidate_split',development_pct:50,validation_pct:10,holdout_pct:40,candidates:n,development:train.length,validation:validation.length,holdout:holdout.length},
 optimization:{threshold_grid:thresholds,min_development_trades:MIN_TRAIN_TRADES,selected_threshold:chosen,development_baseline:trainBase,development_selected:best.metrics},
 validation:{baseline:validationBase,ai_filtered:validationFiltered,lift:{expectancyR:validationFiltered.expectancyR-validationBase.expectancyR,profitFactor:(validationFiltered.profitFactor??0)-(validationBase.profitFactor??0),netR:validationFiltered.netR-validationBase.netR,maxDrawdownR:validationFiltered.maxDrawdownR-validationBase.maxDrawdownR,tradeCountRatio:validationBase.trades?validationFiltered.trades/validationBase.trades:0}},
 final_holdout:{baseline:holdoutBase,ai_filtered:holdoutFiltered,lift:{expectancyR:holdoutFiltered.expectancyR-holdoutBase.expectancyR,profitFactor:(holdoutFiltered.profitFactor??0)-(holdoutBase.profitFactor??0),netR:holdoutFiltered.netR-holdoutBase.netR,maxDrawdownR:holdoutFiltered.maxDrawdownR-holdoutBase.maxDrawdownR,tradeCountRatio:holdoutBase.trades?holdoutFiltered.trades/holdoutBase.trades:0}},
 pass_criteria:{holdout_must_have_positive_expectancy_improvement:false,note:'This report provides evidence; it does not authorize live trading.'}
};
await fs.writeFile(OUT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
