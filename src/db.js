import { createClient } from '@supabase/supabase-js';
const enabled=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase=enabled?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY):null;
export function dbEnabled(){return Boolean(supabase);}
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