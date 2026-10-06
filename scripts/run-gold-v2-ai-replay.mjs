import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeHistoricalEnvironment } from '../src/gold_ai_replay.js';

const DIR=path.resolve(process.env.GOLD_AI_REPLAY_DIR||'gold-ai-replay');
const DATA=path.resolve(process.env.GOLD_AI_REPLAY_DATASET||path.join(DIR,'gold_v2_ai_replay_dataset.jsonl'));
const CONTEXT=path.resolve(process.env.GOLD_AI_REPLAY_CONTEXT||path.join(DIR,'historical_context.jsonl'));
const RESULTS=path.resolve(process.env.GOLD_AI_REPLAY_RESULTS||path.join(DIR,'ai_filter_results.jsonl'));
const MAX=Math.max(0,Number(process.env.GOLD_AI_REPLAY_MAX_CANDIDATES||0));
const MIN_SCORE=Math.min(1,Math.max(0.5,Number(process.env.AI_ENV_FILTER_MIN_SCORE||0.70)));
const REQUIRE_CONTEXT=String(process.env.GOLD_AI_REPLAY_REQUIRE_CONTEXT||'true').toLowerCase()!=='false';
const model=process.env.OPENAI_MODEL||'gpt-5.5';

async function lines(file){try{return (await fs.readFile(file,'utf8')).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}catch(e){if(e.code==='ENOENT')return[];throw e;}}
await fs.mkdir(DIR,{recursive:true});
const rows=await lines(DATA);
if(!rows.length)throw new Error('Replay dataset is empty: '+DATA);
const contextRows=await lines(CONTEXT);
const contextByTime=new Map(contextRows.map(x=>[String(x.asof_time),x]));
const prior=await lines(RESULTS);
const done=new Set(prior.map(x=>String(x.candidate_id)));
const out=await fs.open(RESULTS,'a');
let calls=0,approved=0,rejected=0,unclear=0,skipped=0;
try{
  for(const row of rows){
    if(MAX>0&&calls>=MAX)break;
    if(done.has(String(row.candidate_id)))continue;
    const ctx=contextByTime.get(String(row.asof_time))||{asof_time:row.asof_time,sources:[],missing:true};
    if(REQUIRE_CONTEXT&&ctx.missing){skipped++;continue;}
    const started=Date.now();
    try{
      const result=await analyzeHistoricalEnvironment({snapshot:row,context:ctx,model});
      const d=result.decision;
      const gate=d.decision==='APPROVE'&&Number(d.score)>=MIN_SCORE&&d.candidate_alignment==='ALIGNED';
      const record={candidate_id:row.candidate_id,asof_time:row.asof_time,candidate:row.candidate,replay:{decision:d.decision,score:d.score,gate_approved:gate,candidate_alignment:d.candidate_alignment,regime_fit:d.regime_fit,evidence_quality:d.evidence_quality,reasons:d.reasons,source_ids:d.source_ids},openai:{response_id:result.responseId,model:result.model},latency_ms:Date.now()-started};
      await out.write(JSON.stringify(record)+'\n');done.add(String(row.candidate_id));calls++;
      if(gate)approved++;else if(d.decision==='REJECT')rejected++;else unclear++;
      if(calls%25===0)console.log(JSON.stringify({calls,approved,rejected,unclear,skipped}));
    }catch(error){
      const record={candidate_id:row.candidate_id,asof_time:row.asof_time,candidate:row.candidate,replay:{decision:'UNCLEAR',score:0,gate_approved:false,candidate_alignment:'UNCLEAR',regime_fit:'UNCLEAR',evidence_quality:'INSUFFICIENT',reasons:['replay_error:'+String(error.message||error)],source_ids:[]},error:true};
      await out.write(JSON.stringify(record)+'\n');done.add(String(row.candidate_id));calls++;
    }
  }
}finally{await out.close();}
console.log(JSON.stringify({dataset_rows:rows.length,prior_results:prior.length,calls,approved,rejected,unclear,skipped,min_score:MIN_SCORE,require_context:REQUIRE_CONTEXT,results:RESULTS},null,2));
