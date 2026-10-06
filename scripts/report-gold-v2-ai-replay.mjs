import fs from 'node:fs/promises';
import path from 'node:path';

const DIR=path.resolve(process.env.GOLD_AI_REPLAY_DIR||'gold-ai-replay');
const DATA=path.resolve(process.env.GOLD_AI_REPLAY_DATASET||path.join(DIR,'gold_v2_ai_replay_dataset.jsonl'));
const RESULTS=path.resolve(process.env.GOLD_AI_REPLAY_RESULTS||path.join(DIR,'ai_filter_results.jsonl'));
const OUT=path.resolve(process.env.GOLD_AI_REPLAY_REPORT||path.join(DIR,'gold_v2_ai_ab_report.json'));

async function lines(file){return (await fs.readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}
const rows=await lines(DATA), results=await lines(RESULTS);
if(!rows.length)throw new Error('Empty replay dataset');
const byId=new Map(results.map(x=>[String(x.candidate_id),x]));
const candidates=rows.filter(x=>x.execution?.eligible===true);
const missing=candidates.filter(x=>!byId.has(String(x.candidate_id)));
if(missing.length&&!['1','true'].includes(String(process.env.GOLD_AI_REPLAY_ALLOW_PARTIAL||'false').toLowerCase()))
  throw new Error('Incomplete AI replay results: '+missing.length+' eligible candidates have no AI result');

function selectPortfolio(items,allow){
  const sorted=[...items].filter(x=>x.execution?.eligible===true&&allow(x)).sort((a,b)=>Number(a.asof_time)-Number(b.asof_time));
  const chosen=[];let available=-Infinity;
  for(const x of sorted){if(Number(x.asof_time)<available)continue;chosen.push(x);available=Number(x.execution.exit_time)+300;}
  return chosen;
}
function metrics(items){
  const rs=items.map(x=>Number(x.execution.net_r)||0).filter(Number.isFinite);
  const wins=rs.filter(x=>x>0),losses=rs.filter(x=>x<0);
  const grossWin=wins.reduce((s,x)=>s+x,0),grossLoss=Math.abs(losses.reduce((s,x)=>s+x,0));
  let eq=0,peak=0,maxDd=0,curLoss=0,maxLoss=0;
  for(const x of rs){eq+=x;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,peak-eq);if(x<0){curLoss++;maxLoss=Math.max(maxLoss,curLoss)}else curLoss=0;}
  const holds=items.map(x=>(Number(x.execution.exit_time)-Number(x.asof_time))/60).filter(x=>Number.isFinite(x));
  return {trades:rs.length,netR:rs.reduce((s,x)=>s+x,0),expectancyR:rs.length?rs.reduce((s,x)=>s+x,0)/rs.length:0,profitFactor:grossLoss?grossWin/grossLoss:null,winRate:rs.length?wins.length/rs.length:0,maxDrawdownR:maxDd,maxConsecutiveLosses:maxLoss,avgHoldMinutes:holds.length?holds.reduce((s,x)=>s+x,0)/holds.length:null};
}
function groups(items,kind){
  const map=new Map();
  for(const x of items){const d=new Date(Number(x.execution.exit_time)*1000),key=kind==='year'?d.toISOString().slice(0,4):d.toISOString().slice(0,7);if(!map.has(key))map.set(key,[]);map.get(key).push(x);}
  return Object.fromEntries([...map].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,metrics(v)]));
}
const aiAllowed=x=>{const a=byId.get(String(x.candidate_id))?.replay;return a?.gate_approved===true;};
const baseline=selectPortfolio(candidates,()=>true);
const filtered=selectPortfolio(candidates,aiAllowed);
const report={
 schema_version:1,
 generated_at:new Date().toISOString(),
 coverage:{dataset_candidates:candidates.length,ai_results:results.length,missing_eligible_results:missing.length},
 gate:{min_score:Number(process.env.AI_ENV_FILTER_MIN_SCORE||0.70)},
 baseline:{overall:metrics(baseline),yearly:groups(baseline,'year'),monthly:groups(baseline,'month')},
 ai_filtered:{overall:metrics(filtered),yearly:groups(filtered,'year'),monthly:groups(filtered,'month')},
 lift:{
   profitFactor_delta:(metrics(filtered).profitFactor??0)-(metrics(baseline).profitFactor??0),
   expectancyR_delta:metrics(filtered).expectancyR-metrics(baseline).expectancyR,
   netR_delta:metrics(filtered).netR-metrics(baseline).netR,
   maxDrawdownR_delta:metrics(filtered).maxDrawdownR-metrics(baseline).maxDrawdownR,
   trade_count_ratio:baseline.length?filtered.length/baseline.length:0
 }
};
await fs.writeFile(OUT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
