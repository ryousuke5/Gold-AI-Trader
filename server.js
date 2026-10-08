import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { normalizeFeatures, validateFeatures, ruleCandidate } from './src/features.js';
import { buildGoldV2Setup } from './src/gold_strategy_v2.js';
import { analyzeWithOpenAI } from './src/ai.js';
import { evaluateRisk, getRiskLimits, safeDecision } from './src/risk.js';
import { dbEnabled, getRiskBySignal, getSignalByKey, getState, insertEvent, insertOrder, insertRisk, insertSignal, insertTradeResult, probeGoldDatabase, updateState } from './src/db.js';
import { registerEurUsdRoutes } from './src/eurusd.js';
import { startEurUsdNewsFeedMonitor } from './src/eurusd_news_feed.js';
import { buildForwardMonitorSnapshot } from './src/forward_monitor.js';

const app=express();
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
app.disable('x-powered-by');
app.use(express.json({limit:'96kb'}));
app.use(express.static(path.join(__dirname,'public'),{index:false}));
app.get('/forward-monitor',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','forward-monitor.html'));
});
const port=Number(process.env.PORT||3100);
const defaultSymbol=process.env.DEFAULT_SYMBOL||'XAUUSD';
const strategyVersion=process.env.STRATEGY_VERSION||'gold-m5-h1-v2';
const aiOnlyOnCandidate=process.env.AI_ONLY_ON_CANDIDATE!=='false';
const memoryState={id:'global',auto_trading_enabled:false,mode:'ANALYSIS',emergency_stopped_at:null,updated_at:new Date().toISOString()};
const seenBars=new Map();
function timingSafeEquals(a,b){const left=Buffer.from(String(a||''));const right=Buffer.from(String(b||''));return left.length===right.length&&crypto.timingSafeEqual(left,right);}
function auth(req,res,next){const expected=process.env.GOLD_API_KEY;if(!expected)return res.status(503).json({ok:false,error:'GOLD_API_KEY is not configured'});const supplied=String(req.headers['x-gold-api-key']||'');if(!timingSafeEquals(supplied,expected))return res.status(401).json({ok:false,error:'unauthorized'});next();}
function nowIso(){return new Date().toISOString();}
function keyFingerprint(value){
  return crypto.createHash('sha256').update(String(value||''),'utf8').digest('hex').slice(0,12);
}
function envNumber(name, fallback){const value=Number(process.env[name]);return Number.isFinite(value)?value:fallback;}
function getGoldV2Config(){
  return {
    rangeLookback: envNumber('GOLD_RANGE_LOOKBACK', 12),
    minRangeAtr: envNumber('GOLD_MIN_RANGE_ATR', 0.8),
    maxRangeAtr: envNumber('GOLD_MAX_RANGE_ATR', 2.8),
    breakoutAtr: envNumber('GOLD_BREAKOUT_ATR', 0.10),
    minBodyAtr: envNumber('GOLD_MIN_BODY_ATR', 0.40),
    minCloseLocation: envNumber('GOLD_MIN_CLOSE_LOCATION', 0.65),
    minVolumeRatio: envNumber('GOLD_MIN_VOLUME_RATIO', 1.10),
    sessionStartUtc: envNumber('GOLD_SESSION_START_UTC', 7),
    sessionEndUtc: envNumber('GOLD_SESSION_END_UTC', 20)
  };
}
function currentState(){return{...memoryState};}
function markSeen(key){seenBars.set(key,Date.now());if(seenBars.size>5000)seenBars.delete(seenBars.keys().next().value);}
function applyDeterministicGoldSetup(decision, setup, candidate){
  if(strategyVersion!=='gold-m5-h1-v2'||!setup||typeof setup!=='object'||!['BUY','SELL'].includes(candidate))return decision;
  if(String(decision?.decision||'WAIT').toUpperCase()!==candidate)return decision;
  const entry=Number(setup.entry_reference),sl=Number(setup.stop_loss),tp=Number(setup.take_profit),rr=Number(setup.risk_reward);
  if(![entry,sl,tp,rr].every(Number.isFinite)||entry<=0||sl<=0||tp<=0||rr<=0)return decision;
  return {...decision,candidate,entry,stop_loss:sl,take_profit:tp,risk_reward:rr};
}
function waitDecision(){return{decision:'WAIT',confidence:0,market_regime:'UNCLEAR',entry:0,stop_loss:0,take_profit:0,risk_reward:0,reason:'Rule filter found no eligible setup.',invalid_reasons:['rule_candidate_wait'],fundamental:{bias:'INSUFFICIENT',confidence:0,freshness:'INSUFFICIENT',summary:'Fundamental search skipped because the deterministic rule candidate was WAIT.',drivers:[],risks:[]}};}function preserveFundamental(safe,raw){const f=raw?.fundamental||{};const c=Number(f.confidence);return{...safe,fundamental:{bias:String(f.bias||'INSUFFICIENT').toUpperCase(),confidence:Number.isFinite(c)?c:0,freshness:String(f.freshness||'INSUFFICIENT').toUpperCase(),summary:String(f.summary||''),drivers:Array.isArray(f.drivers)?f.drivers.map(String):[],risks:Array.isArray(f.risks)?f.risks.map(String):[]}};}
app.get('/api/forward-monitor',auth,async(req,res)=>{
  try {
    const snapshot=await buildForwardMonitorSnapshot(Date.now());
    res.set('Cache-Control','no-store');
    res.json(snapshot);
  } catch(error) {
    console.error('[forward-monitor]',error);
    res.status(500).json({ok:false,error:error.message||'forward monitor failed'});
  }
});

app.get('/health',async(req,res)=>{const exists=k=>Object.prototype.hasOwnProperty.call(process.env,k);const nonempty=k=>Boolean(String(process.env[k]||'').trim());const keys=['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY','GOLD_API_KEY'];const env={supabase_url:nonempty('SUPABASE_URL'),supabase_key:nonempty('SUPABASE_SECRET_KEY')||nonempty('SUPABASE_SERVICE_ROLE_KEY'),openai:nonempty('OPENAI_API_KEY'),gold_api:nonempty('GOLD_API_KEY'),env_probe:nonempty('GOLD_CONFIG_PROBE')&&process.env.GOLD_CONFIG_PROBE==='1'};const env_presence=Object.fromEntries(keys.map(k=>[k,{present:exists(k),nonempty:nonempty(k)}]));const missing_env=[];if(!env.supabase_url)missing_env.push('SUPABASE_URL');if(!env.supabase_key)missing_env.push('SUPABASE_SECRET_KEY');if(!env.openai)missing_env.push('OPENAI_API_KEY');if(!env.gold_api)missing_env.push('GOLD_API_KEY');const db_probe=await probeGoldDatabase();res.json({ok:true,service:'gold-ai-trader-v1',config:env,env_presence,missing_env,db:dbEnabled(),db_probe,mode:currentState().mode,strategy_version:strategyVersion});});
app.post('/api/gold/ai-test',auth,async(req,res)=>{const requestId=String(req.headers['x-request-id']||crypto.randomUUID());try{const body=req.body||{};const symbol=String(body.symbol||defaultSymbol);const timeframe=String(body.timeframe||'M5');if(timeframe!=='M5')return res.status(400).json({ok:false,error:'V1 supports M5 only',request_id:requestId});const features=normalizeFeatures(body.features||body);const featureErrors=validateFeatures(features);if(featureErrors.length)return res.status(400).json({ok:false,error:'invalid_features',reasons:featureErrors,request_id:requestId});const setup = strategyVersion === 'gold-m5-h1-v2' ? buildGoldV2Setup(features, getGoldV2Config()) : ruleCandidate(features);
const candidate = typeof setup === 'string' ? setup : String(setup?.candidate || 'WAIT');const ai=await analyzeWithOpenAI({features,candidate,symbol});const decision=applyDeterministicGoldSetup(preserveFundamental(safeDecision(ai.decision),ai.decision),setup,candidate);const risk=evaluateRisk({decision:{...decision,candidate},features,account:{equity:100000,open_positions:0,daily_pnl_pct:0,drawdown_pct:0,risk_data_ready:true,trade_allowed:1,tick_size:0.01,tick_value:1,min_lot:0.01,max_lot:100,lot_step:0.01},signalCreatedAt:Date.now(),now:Date.now()});res.json({ok:true,request_id:requestId,symbol,timeframe,strategy_version:strategyVersion,setup,candidate,decision,risk,fundamental_sources:ai.sources,openai:{called:true,response_id:ai.responseId,model:ai.model,web_search_used:ai.webSearchUsed===true},fundamental_source_selection_method:ai.sourceSelectionMethod||null,searched_sources_count:Array.isArray(ai.searchedSources)?ai.searchedSources.length:0,persisted:false,orders_executed:false,execution_test_only:true});}catch(error){console.error('[gold/ai-test]',requestId,error);res.status(500).json({ok:false,error:error.message||'AI test failed',request_id:requestId});}});
app.get('/api/gold/status',auth,async(req,res)=>{try{const remote=await getState();res.json({ok:true,state:remote||currentState(),limits:getRiskLimits(),strategy_version:strategyVersion,ai_only_on_candidate:aiOnlyOnCandidate});}catch(error){res.status(500).json({ok:false,error:error.message});}});
app.post('/api/gold/state',auth,async(req,res)=>{try{const mode=String(req.body?.mode||'').toUpperCase();const allowedModes=new Set(['ANALYSIS','PAPER','DEMO','LIVE']);if(!allowedModes.has(mode))return res.status(400).json({ok:false,error:'mode must be ANALYSIS|PAPER|DEMO|LIVE'});const autoTrading=req.body?.auto_trading_enabled===true;const liveApproved=String(process.env.GOLD_LIVE_TRADING_APPROVED||'false').toLowerCase()==='true';if(mode==='LIVE'&&!liveApproved)return res.status(403).json({ok:false,error:'LIVE trading is disabled until GOLD_LIVE_TRADING_APPROVED=true'});if(mode==='LIVE'&&!autoTrading)return res.status(400).json({ok:false,error:'LIVE requires auto_trading_enabled=true'});memoryState.mode=mode;memoryState.auto_trading_enabled=autoTrading;memoryState.emergency_stopped_at=null;memoryState.updated_at=nowIso();await updateState(memoryState);await insertEvent({level:'WARN',event_type:'state_change',message:'gold trader state changed',metadata:memoryState,created_at:nowIso()});res.json({ok:true,state:currentState()});}catch(error){res.status(500).json({ok:false,error:error.message});}});
app.post('/api/gold/emergency-stop',auth,async(req,res)=>{try{memoryState.mode='ANALYSIS';memoryState.auto_trading_enabled=false;memoryState.emergency_stopped_at=nowIso();memoryState.updated_at=nowIso();await updateState(memoryState);await insertEvent({level:'ERROR',event_type:'emergency_stop',message:'manual emergency stop; new orders disabled',metadata:{},created_at:nowIso()});res.json({ok:true,state:currentState()});}catch(error){res.status(500).json({ok:false,error:error.message});}});
app.post('/api/gold/signal',auth,async(req,res)=>{const requestId=String(req.headers['x-request-id']||crypto.randomUUID());try{const body=req.body||{};const symbol=String(body.symbol||defaultSymbol);const timeframe=String(body.timeframe||'M5');if(timeframe!=='M5')return res.status(400).json({ok:false,error:'V1 supports M5 only',request_id:requestId});const features=normalizeFeatures(body.features||body);const featureErrors=validateFeatures(features);if(featureErrors.length)return res.status(400).json({ok:false,error:'invalid_features',reasons:featureErrors,request_id:requestId});const barKey=`${symbol}:${timeframe}:${features.barTime}:${strategyVersion}`;const existing=await getSignalByKey({symbol,timeframe,barTimeIso:new Date(features.barTime*1000).toISOString(),strategyVersion});if(existing)return res.status(409).json({ok:false,error:'duplicate_bar',request_id:requestId,signal_id:existing.id,decision:existing.decision,existing:true});if(seenBars.has(barKey))return res.status(409).json({ok:false,error:'duplicate_bar',request_id:requestId,bar_key:barKey});const setup = strategyVersion === 'gold-m5-h1-v2' ? buildGoldV2Setup(features, getGoldV2Config()) : ruleCandidate(features);
const candidate = typeof setup === 'string' ? setup : String(setup?.candidate || 'WAIT');if(!dbEnabled())return res.status(503).json({ok:false,error:'database_not_configured',request_id:requestId});const state=(await getState())||currentState();let ai;if(aiOnlyOnCandidate&&candidate==='WAIT')ai={decision:waitDecision(),responseId:null,model:null,sources:[],webSearchUsed:false};else ai=await analyzeWithOpenAI({features,candidate,symbol});const decision=applyDeterministicGoldSetup(preserveFundamental(safeDecision(ai.decision),ai.decision),setup,candidate);const signalCreatedAt=Date.now();const signalId=crypto.randomUUID();const risk=evaluateRisk({decision:{...decision,candidate},features,account:body.account||{},signalCreatedAt,now:Date.now()});if(ai.webSearchUsed){try{await insertEvent({level:'INFO',event_type:'fundamental_analysis',message:'live web fundamental analysis completed',metadata:{request_id:requestId,signal_id:signalId,candidate,fundamental:decision.fundamental,sources:ai.sources},created_at:nowIso()});}catch(eventError){console.error('[gold/fundamental-event]',requestId,eventError);}}const setupReason=(candidate==='WAIT'&&setup&&typeof setup==='object'&&setup.reason)?String(setup.reason):decision.reason;
const setupDiagnosticReasons=(setup&&typeof setup==='object'&&setup.diagnostics&&typeof setup.diagnostics==='object')
  ? ['GOLD_V2_DIAG:'+JSON.stringify(setup.diagnostics),
     ...(Number.isFinite(Number(setup.diagnostics.range_atr)) ? ['GOLD_V2_RANGE_ATR:'+Number(setup.diagnostics.range_atr)] : [])]
  : [];
const baseInvalidReasons=Array.isArray(decision.invalid_reasons)?decision.invalid_reasons:[];
const signalInvalidReasons=[...baseInvalidReasons,...(setupReason&&!baseInvalidReasons.includes(setupReason)?[setupReason]:[]),...setupDiagnosticReasons];
const signalRow={id:signalId,symbol,timeframe,bar_time:new Date(features.barTime*1000).toISOString(),strategy_version:strategyVersion,request_id:requestId,candidate,decision:decision.decision,confidence:decision.confidence,market_regime:decision.market_regime,entry:decision.entry||null,stop_loss:decision.stop_loss||null,take_profit:decision.take_profit||null,risk_reward:decision.risk_reward||null,reason:setupReason,invalid_reasons:signalInvalidReasons,openai_response_id:ai.responseId,model:ai.model,created_at:nowIso()};let signalSave;try{signalSave=await insertSignal(signalRow);}catch(error){if(error?.code==='23505'){const raced=await getSignalByKey({symbol,timeframe,barTimeIso:signalRow.bar_time,strategyVersion});return res.status(409).json({ok:false,error:'duplicate_bar',request_id:requestId,signal_id:raced?.id||null,existing:true});}throw error;}if(!signalSave?.persisted)return res.status(503).json({ok:false,error:'signal_not_persisted',request_id:requestId,signal_id:signalId});markSeen(barKey);const riskSave=await insertRisk({signal_id:signalId,approved:risk.approved,reasons:risk.reasons,age_seconds:risk.ageSeconds,account_snapshot:{...(body.account||{}),risk_limits:getRiskLimits(),calculated_lots:risk.lots},created_at:nowIso()});if(!riskSave?.persisted)return res.status(500).json({ok:false,error:'risk_not_persisted',request_id:requestId,signal_id:signalId});const orderAllowed=Boolean(risk.approved&&state?.auto_trading_enabled===true&&!state?.emergency_stopped_at&&['DEMO','LIVE'].includes(String(state?.mode||'')));const expiresAt=new Date(Date.now()+getRiskLimits().maxSignalAgeSeconds*1000);res.json({ok:true,request_id:requestId,signal_id:signalId,symbol,timeframe,strategy_version:strategyVersion,candidate,decision,risk,state,fundamental_sources:ai.sources,persistence:{signal:true,risk:true},openai:{called:Boolean(ai.responseId),response_id:ai.responseId,model:ai.model,web_search_used:ai.webSearchUsed===true},fundamental_source_selection_method:ai.sourceSelectionMethod||null,searched_sources_count:Array.isArray(ai.searchedSources)?ai.searchedSources.length:0,order_allowed:orderAllowed,expires_at:expiresAt.toISOString(),expires_at_epoch:Math.floor(expiresAt.getTime()/1000)});}catch(error){console.error('[gold/signal]',requestId,error);try{await insertEvent({level:'ERROR',event_type:'signal_error',message:error.message||String(error),metadata:{request_id:requestId},created_at:nowIso()});}catch{}res.status(500).json({ok:false,error:error.message||'signal generation failed',request_id:requestId});}});
app.post('/api/gold/trade-result',auth,async(req,res)=>{try{const body=req.body||{};if(!body.idempotency_key||!body.mt4_ticket||!body.symbol||!body.result)return res.status(400).json({ok:false,error:'idempotency_key, mt4_ticket, symbol and result are required'});const result=String(body.result||'').toUpperCase();if(!['WIN','LOSS','BREAKEVEN'].includes(result))return res.status(400).json({ok:false,error:'result must be WIN|LOSS|BREAKEVEN'});const saved=await insertTradeResult({id:crypto.randomUUID(),idempotency_key:String(body.idempotency_key),mt4_ticket:Number(body.mt4_ticket),symbol:String(body.symbol),result,profit:Number(body.profit||0),r_multiple:Number(body.r_multiple||0),holding_seconds:Math.max(0,Math.floor(Number(body.holding_seconds||0))),exit_reason:body.exit_reason?String(body.exit_reason):null,metadata:body.metadata||{},created_at:nowIso()});res.json({ok:true,persisted:saved.persisted,trade_result:saved.row});}catch(error){res.status(500).json({ok:false,error:error.message||'trade result persistence failed'});}});
app.post('/api/gold/execution-result',auth,async(req,res)=>{try{const body=req.body||{};if(!body.signal_id||!body.idempotency_key)return res.status(400).json({ok:false,error:'signal_id and idempotency_key are required'});const signal=await getSignalByKey({signalId:String(body.signal_id)});if(!signal)return res.status(404).json({ok:false,error:'signal_not_found'});const riskCheck=await getRiskBySignal(String(body.signal_id));if(!riskCheck?.approved)return res.status(409).json({ok:false,error:'signal_was_not_risk_approved'});const side=String(body.side||'').toUpperCase();if(!['BUY','SELL'].includes(side)||side!==String(signal.decision).toUpperCase())return res.status(400).json({ok:false,error:'side_mismatch'});const status=String(body.status||'UNKNOWN').toUpperCase();const ticket=Number(body.mt4_ticket||0)||null;if(status==='FILLED'&&!ticket)return res.status(400).json({ok:false,error:'filled_order_requires_ticket'});const saved=await insertOrder({id:body.order_id||crypto.randomUUID(),signal_id:body.signal_id,idempotency_key:String(body.idempotency_key),symbol:String(body.symbol||defaultSymbol),mt4_ticket:ticket,side,requested_price:Number(body.requested_price||0)||null,filled_price:Number(body.filled_price||0)||null,volume:Number(body.volume||0)||null,stop_loss:Number(body.stop_loss||0)||null,take_profit:Number(body.take_profit||0)||null,status,broker_error:body.broker_error?String(body.broker_error):null,metadata:body.metadata||{},created_at:nowIso()});res.json({ok:true,persisted:saved.persisted,order:saved.row});}catch(error){res.status(500).json({ok:false,error:error.message});}});
registerEurUsdRoutes(app);
app.listen(port,async()=>{
  startEurUsdNewsFeedMonitor();
  console.log(`Gold AI Trader V1 listening on ${port}`);
  const cfg=getGoldV2Config();
  console.log('[GOLD CONFIG] strategy_version=%s ai_only_on_candidate=%s risk_pct=%s range=%s-%s ATR breakout=%s body=%s close=%s volume=%s session_utc=%s-%s', strategyVersion, aiOnlyOnCandidate, getRiskLimits().maxRiskPct, cfg.minRangeAtr, cfg.maxRangeAtr, cfg.breakoutAtr, cfg.minBodyAtr, cfg.minCloseLocation, cfg.minVolumeRatio, cfg.sessionStartUtc, cfg.sessionEndUtc);
  let supabaseHost=''; try { supabaseHost=new URL(String(process.env.SUPABASE_URL||'')).hostname; } catch {}
  let dbProbe={ok:false,status:'probe_failed'}; try { dbProbe=await probeGoldDatabase(); } catch (error) { dbProbe={ok:false,status:'error',error:String(error?.message||error)}; }
  console.log('[GOLD DB] enabled=%s url_host=%s probe=%s state_present=%s', dbEnabled(), supabaseHost||'unset', dbProbe?.status||'unknown', Boolean(dbProbe?.state_present));
});