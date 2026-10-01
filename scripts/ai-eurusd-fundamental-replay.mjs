import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const inputPath=process.env.MACRO_INPUT||path.resolve(__dirname,'../backtest-output/eurusd_macro_daily.csv');
const outputPath=process.env.FUNDAMENTAL_MASK_OUTPUT||path.resolve(__dirname,'../backtest-output/eurusd_fundamental_ai_mask.csv');
const model=process.env.OPENAI_MODEL||'gpt-5-mini';
const chunkSize=Math.max(10,Math.min(120,Number(process.env.AI_REPLAY_CHUNK_SIZE||90)));
const maxRetries=Math.max(1,Math.min(5,Number(process.env.AI_REPLAY_MAX_RETRIES||3)));

function parseCsv(text){
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean);
  const header=lines[0].split(',');
  return lines.slice(1).map(line=>{
    const cells=line.split(','), row={};
    header.forEach((h,i)=>row[h]=cells[i]);
    return row;
  });
}
function outputText(response){
  if(typeof response?.output_text==='string') return response.output_text;
  return (response?.output||[]).flatMap(item=>item.content||[]).map(c=>c.text||'').join('');
}
function schemaFor(size){
  return {
    type:'object',additionalProperties:false,
    properties:{days:{type:'array',minItems:size,maxItems:size,items:{
      type:'object',additionalProperties:false,
      properties:{
        timestamp:{type:'string'},
        bias:{type:'string',enum:['BULLISH_EURUSD','BEARISH_EURUSD','NEUTRAL','INSUFFICIENT']},
        confidence:{type:'number',minimum:0,maximum:1},
        freshness:{type:'string',enum:['CURRENT','MIXED','STALE','INSUFFICIENT']},
        event_risk_next_24h:{type:'string',enum:['LOW','MEDIUM','HIGH','UNKNOWN']}
      },
      required:['timestamp','bias','confidence','freshness','event_risk_next_24h']
    }}},
    required:['days']
  };
}
function buildSystem(){
  return [
    'Historical EURUSD fundamental replay.',
    'Use ONLY the supplied historical snapshot values. Do not use later information, current information, future meeting outcomes, or hindsight.',
    'Each snapshot represents the macro information available at the start of that UTC day, using prior-day official Federal Reserve and ECB policy-rate observations.',
    'Higher US policy rates relative to ECB, or a widening US-minus-EUR policy-rate differential, can support USD and therefore bearish EURUSD.',
    'A narrowing differential can support EURUSD. Use NEUTRAL when the evidence is balanced or weak.',
    'For dates where FOMC or ECB event flags are YES, event_risk_next_24h must be HIGH.',
    'Set freshness=CURRENT for valid snapshots.',
    'Return exactly one object per input row, preserving input order and timestamps.'
  ].join('\n');
}
async function classifyChunk(snapshots){
  let lastError=null;
  for(let attempt=1;attempt<=maxRetries;attempt++){
    try{
      const response=await fetch('https://api.openai.com/v1/responses',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},
        body:JSON.stringify({
          model,store:false,
          reasoning:{effort:process.env.OPENAI_REASONING_EFFORT||'low'},
          input:[
            {role:'system',content:[{type:'input_text',text:buildSystem()}]},
            {role:'user',content:[{type:'input_text',text:JSON.stringify(snapshots)}]}
          ],
          text:{verbosity:'low',format:{type:'json_schema',name:'eurusd_historical_fundamental_replay_chunk',strict:true,schema:schemaFor(snapshots.length)}}
        })
      });
      const body=await response.text();
      if(!response.ok) throw new Error('OpenAI '+response.status+': '+body.slice(0,1200));
      const parsed=JSON.parse(outputText(JSON.parse(body)));
      if(!Array.isArray(parsed.days)||parsed.days.length!==snapshots.length) throw new Error('Chunk length mismatch');
      for(let i=0;i<parsed.days.length;i++){
        if(parsed.days[i].timestamp!==snapshots[i].timestamp) throw new Error('Timestamp mismatch at chunk index '+i);
      }
      return parsed.days;
    }catch(e){
      lastError=e;
      console.error('Chunk attempt '+attempt+'/'+maxRetries+' failed:',e.message);
      if(attempt<maxRetries) await new Promise(r=>setTimeout(r,Math.min(15000,1000*2**(attempt-1))));
    }
  }
  throw lastError;
}
async function main(){
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error('OPENAI_API_KEY is required for AI fundamental replay');
  const snapshots=parseCsv(await fs.readFile(inputPath,'utf8'));
  if(snapshots.length<300) throw new Error('Not enough macro snapshots: '+snapshots.length);
  const all=[];
  for(let start=0;start<snapshots.length;start+=chunkSize){
    const chunk=snapshots.slice(start,start+chunkSize);
    console.log('AI replay chunk:',start,'->',start+chunk.length-1);
    const classified=await classifyChunk(chunk);
    all.push(...classified);
  }
  const lines=['timestamp,bias,confidence,freshness,event_risk_next_24h',...all.map(d=>[d.timestamp,d.bias,d.confidence.toFixed(4),d.freshness,d.event_risk_next_24h].join(','))];
  await fs.mkdir(path.dirname(outputPath),{recursive:true});
  await fs.writeFile(outputPath,lines.join('\n')+'\n');
  console.log('AI fundamental rows:',all.length);
  console.log('Chunk size:',chunkSize,'chunks:',Math.ceil(all.length/chunkSize));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  main().catch(e=>{console.error(e);process.exitCode=1;});
}
