import crypto from 'node:crypto';

function fingerprint(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

const schema={
  type:'object',additionalProperties:false,
  properties:{
    decision:{type:'string',enum:['APPROVE','REJECT','UNCLEAR']},
    score:{type:'number',minimum:0,maximum:1},
    candidate_alignment:{type:'string',enum:['ALIGNED','CONFLICTING','UNCLEAR']},
    regime_fit:{type:'string',enum:['STRONG','MODERATE','WEAK','UNCLEAR']},
    evidence_quality:{type:'string',enum:['GOOD','LIMITED','INSUFFICIENT']},
    reasons:{type:'array',items:{type:'string'}},
    source_ids:{type:'array',items:{type:'string'}}
  },
  required:['decision','score','candidate_alignment','regime_fit','evidence_quality','reasons','source_ids']
};

export async function analyzeHistoricalEnvironment({snapshot,context={},model=process.env.OPENAI_MODEL||'gpt-5.5'}){
  const asof=Number(snapshot?.asof_time);
  if(!Number.isFinite(asof)||asof<=0)throw new Error('invalid_snapshot_asof_time');
  const sources=Array.isArray(context?.sources)?context.sources:[];
  for(const s of sources){
    const published=Number(s?.published_at);
    if(!Number.isFinite(published)||published>asof)throw new Error('future_information_detected:'+String(s?.id||'unknown'));
  }
  const apiKey=process.env.OPENAI_API_KEY;if(!apiKey)throw new Error('OPENAI_API_KEY is not configured');
  const system=[
    'You are the historical market-environment filter for an XAUUSD trading research system.',
    'This is a point-in-time replay. You have NO web access and must NEVER use information from outside the supplied snapshot/context.',
    'The V2 rule engine has already produced the candidate direction. You may only evaluate whether that existing direction fits the environment; never reverse BUY to SELL or SELL to BUY.',
    'The as-of timestamp is authoritative. Any evidence published after that time is invalid and must cause the evidence quality to be INSUFFICIENT.',
    'Do not infer or invent missing prices, news, macro releases, or probabilities.',
    'decision=APPROVE means the supplied evidence supports trading the existing V2 candidate. REJECT means there is a material environment mismatch. UNCLEAR means evidence is insufficient or conflicting.',
    'score measures environment compatibility, not probability of profit and not backtested expectancy.',
    'Evaluate regime, volatility, trend persistence, breakout quality context, session/liquidity context, and supplied fundamental evidence when available.',
    'Give conservative judgments. Missing historical news is not neutral; it is missing evidence.'
  ].join('\n');
  const promptFingerprint=fingerprint(system);
  const input={asof_time:asof,asof_iso:new Date(asof*1000).toISOString(),candidate_snapshot:snapshot,historical_context:context};
  const contextFingerprint=fingerprint(context);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),Math.max(5000,Number(process.env.OPENAI_TIMEOUT_MS||60000)));
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},signal:controller.signal,
      body:JSON.stringify({
        model,store:false,reasoning:{effort:process.env.OPENAI_REASONING_EFFORT||'medium'},
        tool_choice:'none',
        input:[{role:'system',content:[{type:'input_text',text:system}]},{role:'user',content:[{type:'input_text',text:JSON.stringify(input)}]}],
        text:{verbosity:'low',format:{type:'json_schema',name:'gold_historical_environment_filter',strict:true,schema}}
      })
    });
    const body=await response.text();if(!response.ok)throw new Error('OpenAI '+response.status+': '+body.slice(0,1000));
    const envelope=JSON.parse(body);
    const raw=typeof envelope?.output_text==='string'?envelope.output_text:'';
    if(!raw)throw new Error('empty_structured_output');
    const decision=JSON.parse(raw);
    if(decision.source_ids.some(id=>!sources.some(s=>String(s.id)===String(id))))throw new Error('unverified_source_id');
    return {decision,responseId:envelope?.id||null,model,promptFingerprint,contextFingerprint};
  }catch(e){if(e?.name==='AbortError')throw new Error('OpenAI request timed out');throw e;}
  finally{clearTimeout(timeout);}
}
