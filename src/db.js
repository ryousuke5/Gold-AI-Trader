import { createClient } from '@supabase/supabase-js';
const supabaseKey=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const enabled=Boolean(process.env.SUPABASE_URL&&supabaseKey);
const supabase=enabled?createClient(process.env.SUPABASE_URL,supabaseKey):null;
export function dbEnabled(){return Boolean(supabase);}
export async function probeGoldDatabase(){
  if(!supabase) return {ok:false,status:'not_configured'};
  const {data,error}=await supabase.from('gold_system_state').select('id,mode,auto_trading_enabled').eq('id','global').maybeSingle();
  if(!error) return {ok:true,status:'ok',state_present:Boolean(data)};
  const code=String(error.code||'');
  if(code==='PGRST205'||code==='42P01') return {ok:false,status:'schema_missing'};
  return {ok:false,status:'error'};
}
export async function getSignalByKey({signalId=null,symbol=null,timeframe=null,barTimeIso=null,strategyVersion=null}={}) {
  if(!supabase) return null;
  let q=supabase.from('gold_ai_signals').select('*').limit(1);
  if(signalId) q=q.eq('id',signalId); else q=q.eq('symbol',symbol).eq('timeframe',timeframe).eq('bar_time',barTimeIso).eq('strategy_version',strategyVersion);
  const {data,error}=await q.maybeSingle(); if(error) throw error; return data||null;
}
export async function insertSignal(row){if(!supabase)return{row,persisted:false};const{data,error}=await supabase.from('gold_ai_signals').insert(row).select().single();if(error)throw error;return{row:data,persisted:true};}
export async function getRiskBySignal(signalId){if(!supabase)return null;const{data,error}=await supabase.from('gold_risk_checks').select('*').eq('signal_id',signalId).order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;return data||null;}
export async function insertRisk(row){if(!supabase)return{row,persisted:false};const{data,error}=await supabase.from('gold_risk_checks').insert(row).select().single();if(error)throw error;return{row:data,persisted:true};}
export async function insertOrder(row){if(!supabase)return{row,persisted:false};const{data,error}=await supabase.from('gold_orders').upsert(row,{onConflict:'idempotency_key'}).select().single();if(error)throw error;return{row:data,persisted:true};}
export async function updateState(patch){if(!supabase)return{row:{id:'global',...patch},persisted:false};const{data,error}=await supabase.from('gold_system_state').upsert({id:'global',...patch,updated_at:new Date().toISOString()}).select().single();if(error)throw error;return{row:data,persisted:true};}
export async function getState(){if(!supabase)return null;const{data,error}=await supabase.from('gold_system_state').select('*').eq('id','global').maybeSingle();if(error)throw error;return data;}
export async function insertEvent(row){if(!supabase)return{row,persisted:false};const{data,error}=await supabase.from('gold_system_events').insert(row).select().single();if(error)throw error;return{row:data,persisted:true};}
export async function insertTradeResult(row){if(!supabase)return{row,persisted:false};const{data,error}=await supabase.from('gold_trade_results').upsert(row,{onConflict:'idempotency_key'}).select().single();if(error)throw error;return{row:data,persisted:true};}


export async function insertEurUsdForwardTrade(row){
  if(!supabase)return{row,persisted:false};
  const{data,error}=await supabase.from('gold_eurusd_forward_trades').insert(row).select().single();
  if(error)throw error;
  return{row:data,persisted:true};
}
export async function listEurUsdForwardOpenTrades(){
  if(!supabase)return[];
  const{data,error}=await supabase.from('gold_eurusd_forward_trades').select('*').eq('status','OPEN').order('opened_at',{ascending:true});
  if(error)throw error;
  return data||[];
}
export async function listEurUsdForwardTrades({limit=5000}={}){
  if(!supabase)return[];
  const{data,error}=await supabase.from('gold_eurusd_forward_trades').select('*').order('opened_at',{ascending:true}).limit(Math.max(1,Math.min(20000,Number(limit)||5000)));
  if(error)throw error;
  return data||[];
}
export async function updateEurUsdForwardTrade(id,row){
  if(!supabase)return{row:{id,...row},persisted:false};
  const{data,error}=await supabase.from('gold_eurusd_forward_trades').update(row).eq('id',id).select().single();
  if(error)throw error;
  return{row:data,persisted:true};
}
