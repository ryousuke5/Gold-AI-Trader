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
  const order = {
    id: row.id || undefined,
    signal_id: row.signal_id,
    idempotency_key: 'FORWARD-' + String(row.signal_id),
    symbol: 'EURUSD',
    mt4_ticket: null,
    side: row.side,
    requested_price: row.entry,
    filled_price: row.entry,
    volume: Number(row.metadata?.calculated_lots || 0) || null,
    stop_loss: row.stop_loss,
    take_profit: row.take_profit,
    status: 'FORWARD_OPEN',
    broker_error: null,
    metadata: {
      ...(row.metadata || {}),
      mode: 'FORWARD_PAPER',
      forward: {
        strategy_version: row.strategy_version,
        risk_reward: row.risk_reward,
        risk_distance: row.risk_distance,
        opened_at: row.opened_at,
        opened_bar_time: row.opened_bar_time,
        safety_snapshot: row.safety_snapshot || {},
        account_snapshot: row.account_snapshot || {}
      }
    },
    created_at: row.created_at || new Date().toISOString()
  };
  const{data,error}=await supabase.from('gold_orders').upsert(order,{onConflict:'idempotency_key'}).select().single();
  if(error)throw error;
  return{row:data,persisted:true};
}

function mapForwardOrder(row){
  const forward = row?.metadata?.forward || {};
  const result = forward?.result || {};
  const rawStatus = String(row?.status || '');
  const status = rawStatus === 'FORWARD_OPEN'
    ? 'OPEN'
    : String(result.status || '').toUpperCase() || 'OPEN';

  return {
    id: row.id,
    signal_id: row.signal_id,
    strategy_version: forward.strategy_version || null,
    symbol: row.symbol,
    timeframe: 'M15',
    side: row.side,
    entry: Number(row.requested_price ?? 0),
    stop_loss: Number(row.stop_loss ?? 0),
    take_profit: Number(row.take_profit ?? 0),
    risk_reward: Number(forward.risk_reward ?? 0),
    risk_distance: Number(forward.risk_distance ?? 0),
    opened_at: forward.opened_at || row.created_at,
    opened_bar_time: forward.opened_bar_time || forward.opened_at || row.created_at,
    status,
    exit_price: result.exit_price ?? null,
    exit_at: result.exit_at ?? null,
    exit_bar_time: result.exit_bar_time ?? result.exit_at ?? null,
    exit_reason: result.exit_reason ?? null,
    r_multiple: result.r_multiple ?? null,
    holding_seconds: result.holding_seconds ?? null,
    safety_snapshot: forward.safety_snapshot || {},
    account_snapshot: forward.account_snapshot || {},
    metadata: row.metadata || {},
    created_at: row.created_at
  };
}

export async function listEurUsdForwardOpenTrades(){
  if(!supabase)return[];
  const{data,error}=await supabase.from('gold_orders').select('*').eq('symbol','EURUSD').eq('status','FORWARD_OPEN').order('created_at',{ascending:true});
  if(error)throw error;
  return (data||[]).map(mapForwardOrder);
}

export async function listEurUsdForwardTrades({limit=5000}={}){
  if(!supabase)return[];
  const{data,error}=await supabase.from('gold_orders').select('*').eq('symbol','EURUSD').in('status',['FORWARD_OPEN','FORWARD_WIN','FORWARD_LOSS','FORWARD_BREAKEVEN','FORWARD_EXPIRED']).order('created_at',{ascending:true}).limit(Math.max(1,Math.min(20000,Number(limit)||5000)));
  if(error)throw error;
  return (data||[]).map(mapForwardOrder);
}

export async function updateEurUsdForwardTrade(id,row){
  if(!supabase)return{row:{id,...row},persisted:false};

  const statusMap = {
    WIN: 'FORWARD_WIN',
    LOSS: 'FORWARD_LOSS',
    BREAKEVEN: 'FORWARD_BREAKEVEN',
    EXPIRED: 'FORWARD_EXPIRED'
  };
  const normalizedStatus = String(row.status || '').toUpperCase();
  const orderStatus = statusMap[normalizedStatus] || 'FORWARD_OPEN';

  const existing = await supabase.from('gold_orders')
    .select('metadata')
    .eq('id',id)
    .single();
  if(existing.error)throw existing.error;

  const existingMetadata = existing.data?.metadata || {};
  const metadata = {
    ...existingMetadata,
    mode: 'FORWARD_PAPER',
    forward: {
      ...(existingMetadata.forward || {}),
      result: {
        status: normalizedStatus,
        exit_price: row.exit_price ?? null,
        exit_at: row.exit_at ?? null,
        exit_bar_time: row.exit_bar_time ?? null,
        exit_reason: row.exit_reason ?? null,
        r_multiple: Number(row.r_multiple ?? 0),
        holding_seconds: Number(row.holding_seconds ?? 0)
      }
    }
  };

  const{data,error}=await supabase.from('gold_orders').update({
    status: orderStatus,
    metadata
  }).eq('id',id).select().single();
  if(error)throw error;

  if(['WIN','LOSS','BREAKEVEN','EXPIRED'].includes(normalizedStatus)){
    const result = Number(row.r_multiple || 0) > 0 ? 'WIN'
      : Number(row.r_multiple || 0) < 0 ? 'LOSS'
      : 'BREAKEVEN';

    const tradeResult = await supabase.from('gold_trade_results').upsert({
      order_id: id,
      idempotency_key: 'FORWARD-RESULT-' + String(id),
      mt4_ticket: null,
      symbol: 'EURUSD',
      result,
      profit: null,
      r_multiple: Number(row.r_multiple || 0),
      holding_seconds: Math.round(Number(row.holding_seconds || 0)),
      exit_reason: row.exit_reason || null,
      metadata: { mode: 'FORWARD_PAPER', forward_status: normalizedStatus },
      created_at: row.exit_at || new Date().toISOString()
    },{onConflict:'idempotency_key'}).select().single();
    if(tradeResult.error)throw tradeResult.error;
  }

  return{row:mapForwardOrder(data),persisted:true};
}
