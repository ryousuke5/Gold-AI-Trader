import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const inputPath=process.env.MACRO_INPUT||path.resolve(__dirname,'../backtest-output/eurusd_macro_daily.csv');
const outputPath=process.env.FUNDAMENTAL_MASK_OUTPUT||path.resolve(__dirname,'../backtest-output/eurusd_fundamental_ai_mask.csv');
const model=process.env.OPENAI_MODEL||'gpt-5-mini';

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
async function main(){
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error('OPENAI_API_KEY is required for AI fundamental replay');
  const snapshots=parseCsv(await fs.readFile(inputPath,'utf8'));
  if(snapshots.length<300) throw new Error('Not enough macro snapshots: '+snapshots.length);
  const schema={
    type:'object',additionalProperties:false,
    properties:{days:{type:'array',minItems:snapshots.length,maxItems:snapshots.length,items:{
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
  const system=[
    'Historical EURUSD fundamental replay.',
    'Use ONLY the supplied snapshot values. Do not use later information, current market information, or future meeting outcomes.',
    'The snapshot is constructed from official Federal Reserve and ECB policy-rate observations available from the prior UTC day.',
    'Higher US policy rates relative to ECB, or a widening US-minus-EUR policy-rate differential, can support USD and therefore bearish EURUSD fundamental bias.',
    'A narrowing differential can support EURUSD. When evidence is balanced or weak, use NEUTRAL.',
    'For dates where FOMC or ECB event flags are YES, event_risk_next_24h must be HIGH.',
    'Set freshness=CURRENT for all valid snapshots.',
    'Return exactly one object for each input row in the same order.'
  ].join('\n');
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
    body:JSON.stringify({
      model,store:false,
      reasoning:{effort:process.env.OPENAI_REASONING_EFFORT||'low'},
      input:[
        {role:'system',content:[{type:'input_text',text:system}]},
        {role:'user',content:[{type:'input_text',text:JSON.stringify(snapshots)}]}
      ],
      text:{verbosity:'low',format:{type:'json_schema',name:'eurusd_historical_fundamental_replay',strict:true,schema}}
    })
  });
  const body=await response.text();
  if(!response.ok) throw new Error('OpenAI '+response.status+': '+body.slice(0,1000));
  const parsed=JSON.parse(outputText(JSON.parse(body)));
  if(!Array.isArray(parsed.days)||parsed.days.length!==snapshots.length) throw new Error('Fundamental replay length mismatch');
  for(let i=0;i<parsed.days.length;i++) if(parsed.days[i].timestamp!==snapshots[i].timestamp) throw new Error('Timestamp mismatch at '+i);
  const lines=['timestamp,bias,confidence,freshness,event_risk_next_24h',...parsed.days.map(d=>[d.timestamp,d.bias,d.confidence.toFixed(4),d.freshness,d.event_risk_next_24h].join(','))];
  await fs.mkdir(path.dirname(outputPath),{recursive:true});
  await fs.writeFile(outputPath,lines.join('\n')+'\n');
  console.log('AI fundamental rows:',parsed.days.length);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
