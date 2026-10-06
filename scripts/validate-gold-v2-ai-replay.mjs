import fs from 'node:fs/promises';
import path from 'node:path';

const DIR=path.resolve(process.env.GOLD_AI_REPLAY_DIR||'gold-ai-replay');
const DATA=path.resolve(process.env.GOLD_AI_REPLAY_DATASET||path.join(DIR,'gold_v2_ai_replay_dataset.jsonl'));
const CONTEXT=path.resolve(process.env.GOLD_AI_REPLAY_CONTEXT||path.join(DIR,'historical_context.jsonl'));
const RESULTS=path.resolve(process.env.GOLD_AI_REPLAY_RESULTS||path.join(DIR,'ai_filter_results.jsonl'));

async function lines(file){return (await fs.readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}
const rows=await lines(DATA), ctx=await lines(CONTEXT);
if(!rows.length)throw new Error('Replay dataset empty');
const candidateTimes=new Map(rows.map(x=>[String(x.candidate_id),Number(x.asof_time)]));
const contextTimes=new Set();
const sourceIdsByContext=new Map();
let sources=0,future=0,invalid=0,duplicateContext=0,duplicateSource=0,orphanContext=0,missingContext=0;
for(const item of ctx){
  const asof=Number(item.asof_time);
  if(!Number.isFinite(asof)||asof<=0){invalid++;continue;}
  const key=String(asof);
  if(contextTimes.has(key))duplicateContext++;contextTimes.add(key);
  const localSourceIds=new Set();
  for(const s of Array.isArray(item.sources)?item.sources:[]){
    sources++;
    const id=String(s?.id||'');
    const published=Number(s?.published_at);
    if(!id||localSourceIds.has(id))duplicateSource++;
    if(id)localSourceIds.add(id);
    if(!Number.isFinite(published)||published>asof)future++;
    if(s?.event_time!==undefined && !Number.isFinite(Number(s.event_time)))invalid++;
  }
  sourceIdsByContext.set(key,localSourceIds.size);
}
for(const key of contextTimes)if(!candidateTimes.has(key))orphanContext++;
for(const key of candidateTimes.keys())if(!contextTimes.has(key))missingContext++;
const results=await lines(RESULTS).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));
const resultIds=new Set();
let duplicateResults=0,orphanResults=0;
for(const x of results){
  const id=String(x.candidate_id||'');
  if(resultIds.has(id))duplicateResults++;
  resultIds.add(id);
  if(!candidateTimes.has(id))orphanResults++;
  if(x.openai?.prompt_fingerprint && !/^[a-f0-9]{64}$/.test(String(x.openai.prompt_fingerprint)))invalid++;
  if(x.openai?.context_fingerprint && !/^[a-f0-9]{64}$/.test(String(x.openai.context_fingerprint)))invalid++;
}
if(future>0)throw new Error('Historical context contains future-dated evidence: '+future);
if(invalid>0)throw new Error('Historical context/result validation errors: '+invalid);
if(duplicateSource>0)throw new Error('Duplicate source IDs: '+duplicateSource);
if(duplicateResults>0)throw new Error('Duplicate AI result candidate IDs: '+duplicateResults);
if(orphanResults>0)throw new Error('AI results reference unknown candidate IDs: '+orphanResults);
if(orphanContext>0)throw new Error('Historical context references unknown candidate timestamps: '+orphanContext);
if(missingContext>0)throw new Error('Historical context missing candidate timestamps: '+missingContext);
console.log(JSON.stringify({
  dataset_candidates:rows.length,
  context_rows:ctx.length,
  source_count:sources,
  duplicate_context_rows:duplicateContext,
  ai_results:results.length,
  orphan_context_rows:orphanContext,
  missing_context_rows:missingContext,
  validation:'PASS'
},null,2));
