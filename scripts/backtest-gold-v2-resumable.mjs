import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { buildGoldV2Setup } from '../src/gold_strategy_v2.js';
import { classifyTradeExit, summarizeExitMechanisms } from '../src/trade_exit_diagnostics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.env.GOLD_BACKTEST_OUTPUT_DIR || path.join(__dirname, '../gold-backtest-output'));
const CP = path.join(OUT, 'gold_v2_resume_checkpoint.json');
const CONFIG = {
  lookbackDays: Math.max(365, Number(process.env.GOLD_BACKTEST_LOOKBACK_DAYS || 1825)),
  initialEquity: Math.max(1000, Number(process.env.GOLD_BACKTEST_INITIAL_EQUITY || 100000)),
  riskPct: Math.max(0.01, Number(process.env.GOLD_BACKTEST_RISK_PCT || 0.25)),
  spreadPrice: Math.max(0, Number(process.env.GOLD_BACKTEST_SPREAD_PRICE || 0.50)),
  slippagePrice: Math.max(0, Number(process.env.GOLD_BACKTEST_SLIPPAGE_PRICE || 0.05)),
  maxDailyLossPct: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_DAILY_LOSS_PCT || 2)),
  maxDrawdownPct: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_DRAWDOWN_PCT || 5)),
  maxHoldBars: Math.max(1, Math.floor(Number(process.env.GOLD_BACKTEST_MAX_HOLD_BARS || 96))),
  maxEntryGapAtr: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_ENTRY_GAP_ATR || 0.50)),
  minEffectiveRR: Math.max(0.5, Number(process.env.GOLD_BACKTEST_MIN_EFFECTIVE_RR || 1.50)),
  serverTimezone: process.env.GOLD_BACKTEST_SERVER_TIMEZONE || 'Europe/Nicosia'
};
const STRATEGY = {
  rangeLookback: Math.max(4, Number(process.env.GOLD_RANGE_LOOKBACK || 12)),
  minRangeAtr: Math.max(0.1, Number(process.env.GOLD_MIN_RANGE_ATR || 0.8)),
  maxRangeAtr: Math.max(0.2, Number(process.env.GOLD_MAX_RANGE_ATR || 2.8)),
  breakoutAtr: Math.max(0.01, Number(process.env.GOLD_BREAKOUT_ATR || 0.10)),
  minBodyAtr: Math.max(0.05, Number(process.env.GOLD_MIN_BODY_ATR || 0.40)),
  minCloseLocation: Math.min(0.95, Math.max(0.50, Number(process.env.GOLD_MIN_CLOSE_LOCATION || 0.65))),
  minVolumeRatio: Math.max(0.1, Number(process.env.GOLD_MIN_VOLUME_RATIO || 1.10)),
  buyRsiMin: Math.max(1, Number(process.env.GOLD_BUY_RSI_MIN || 52)),
  buyRsiMax: Math.min(99, Number(process.env.GOLD_BUY_RSI_MAX || 75)),
  sellRsiMin: Math.max(1, Number(process.env.GOLD_SELL_RSI_MIN || 25)),
  sellRsiMax: Math.min(99, Number(process.env.GOLD_SELL_RSI_MAX || 48)),
  maxExtensionAtr: Math.max(0.1, Number(process.env.GOLD_MAX_EXTENSION_ATR || 1.50)),
  stopBufferAtr: Math.max(0, Number(process.env.GOLD_STOP_BUFFER_ATR || 0.15)),
  minStopAtr: Math.max(0.1, Number(process.env.GOLD_MIN_STOP_ATR || 0.80)),
  maxStopAtr: Math.max(0.2, Number(process.env.GOLD_MAX_STOP_ATR || 2.00)),
  takeProfitR: Math.max(1.0, Number(process.env.GOLD_TAKE_PROFIT_R || 2.00)),
  minH1RsiBuy: Math.max(1, Number(process.env.GOLD_MIN_H1_RSI_BUY || 50)),
  maxH1RsiBuy: Math.min(99, Number(process.env.GOLD_MAX_H1_RSI_BUY || 72)),
  minH1RsiSell: Math.max(1, Number(process.env.GOLD_MIN_H1_RSI_SELL || 28)),
  maxH1RsiSell: Math.min(99, Number(process.env.GOLD_MAX_H1_RSI_SELL || 50)),
  sessionStartUtc: Math.min(23, Math.max(0, Math.floor(Number(process.env.GOLD_SESSION_START_UTC || 7)))),
  sessionEndUtc: Math.min(23, Math.max(0, Math.floor(Number(process.env.GOLD_SESSION_END_UTC || 20))))
};

function ema(v,p){const o=new Array(v.length).fill(null),a=2/(p+1);let x=null;for(let i=0;i<v.length;i++){const n=Number(v[i]);if(!Number.isFinite(n))continue;x=x===null?n:a*n+(1-a)*x;o[i]=x;}return o;}
function rsi(c,p){const o=new Array(c.length).fill(null);if(c.length<=p)return o;let g=0,l=0;for(let i=1;i<=p;i++){const d=c[i]-c[i-1];g+=Math.max(0,d);l+=Math.max(0,-d);}let ag=g/p,al=l/p;o[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<c.length;i++){const d=c[i]-c[i-1];ag=(ag*(p-1)+Math.max(0,d))/p;al=(al*(p-1)+Math.max(0,-d))/p;o[i]=al===0?100:100-100/(1+ag/al);}return o;}
function atr(b,p){const o=new Array(b.length).fill(null),tr=new Array(b.length).fill(0);if(b.length<=p)return o;for(let i=0;i<b.length;i++)tr[i]=i?Math.max(b[i].high-b[i].low,Math.abs(b[i].high-b[i-1].close),Math.abs(b[i].low-b[i-1].close)):b[i].high-b[i].low;let s=0;for(let i=1;i<=p;i++)s+=tr[i];let x=s/p;o[p]=x;for(let i=p+1;i<b.length;i++){x=(x*(p-1)+tr[i])/p;o[i]=x;}return o;}
function indicators(b){const c=b.map(x=>x.close),e20=ema(c,20),e50=ema(c,50),e200=ema(c,200),r=rsi(c,14),a=atr(b,14);return b.map((x,i)=>({...x,ema20:e20[i],ema50:e50[i],ema200:e200[i],rsi14:r[i],atr14:a[i]}));}
function h1(m){const map=new Map();for(const b of m){const t=Math.floor(b.time/3600)*3600,x=map.get(t);if(!x)map.set(t,{time:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume});else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=b.volume;}}return [...map.values()].sort((a,b)=>a.time-b.time);}
function h1idx(h,t){let lo=0,hi=h.length-1,b=-1;while(lo<=hi){const m=(lo+hi)>>1;if(h[m].time+3600<=t){b=m;lo=m+1;}else hi=m-1;}return b;}
function recent(b,i,n=80){return b.slice(Math.max(0,i-n+1),i+1).map(x=>({...x,time:x.time+300}));}
function gate(state,e,t){const d=new Date(t*1000).toISOString().slice(0,10);if(state.day!==d){state.day=d;state.dayStartEquity=e;}state.peak=Math.max(state.peak,e);const daily=(e-state.dayStartEquity)/state.dayStartEquity*100,dd=(state.peak-e)/state.peak*100;const reasons=[];if(daily<=-CONFIG.maxDailyLossPct)reasons.push('daily_loss_limit');if(dd>=CONFIG.maxDrawdownPct)reasons.push('drawdown_limit');return{allowed:!reasons.length,reasons};}
function trade(signal,next,future,setup,e,diagnostics){
  const side=setup.candidate;
  const entry=side==='BUY'
    ? next.open+CONFIG.spreadPrice+CONFIG.slippagePrice
    : next.open-CONFIG.slippagePrice;
  const stop=setup.stop_loss;
  const target=setup.take_profit;
  const dist=Math.abs(entry-stop);
  const entryGapAtr=Math.abs(next.open-signal.close)/Math.max(1e-6,Number(signal.atr14));
  const effectiveTargetDistance=Math.abs(target-entry);
  const effectiveRR=dist>0 ? effectiveTargetDistance/dist : 0;

  if (!(entry > 0 && stop > 0 && target > 0 && dist > 0)) {
    diagnostics.rejected_invalid_geometry++;
    return null;
  }
  if (!(entryGapAtr <= CONFIG.maxEntryGapAtr)) {
    diagnostics.rejected_entry_gap++;
    return null;
  }
  if (!(effectiveRR >= CONFIG.minEffectiveRR)) {
    diagnostics.rejected_effective_rr++;
    return null;
  }

  const risk=e*CONFIG.riskPct/100;
  const scan=future.slice(0,CONFIG.maxHoldBars);
  let exit=scan.at(-1)||next;
  let reason='TIME';
  let price=exit?.close??next.close;
  let prev=null;
  let stopAndTargetSameBar=false;

  for(const bar of scan){
    if(prev&&bar.time-prev.time>900){
      exit=prev;
      reason='DATA_GAP';
      price=side==='BUY'
        ? prev.close-CONFIG.slippagePrice
        : prev.close+CONFIG.spreadPrice+CONFIG.slippagePrice;
      break;
    }
    const stopHit=side==='BUY'
      ? bar.low<=stop
      : bar.high+CONFIG.spreadPrice>=stop;
    const targetHit=side==='BUY'
      ? bar.high>=target
      : bar.low+CONFIG.spreadPrice<=target;
    if(stopHit){
      exit=bar;
      reason='STOP';
      price=side==='BUY'
        ? stop-CONFIG.slippagePrice
        : stop+CONFIG.spreadPrice+CONFIG.slippagePrice;
      stopAndTargetSameBar=targetHit;
      break;
    }
    if(targetHit){
      exit=bar;
      reason='TARGET';
      price=side==='BUY'
        ? target-CONFIG.slippagePrice
        : target+CONFIG.spreadPrice+CONFIG.slippagePrice;
      break;
    }
    prev=bar;
  }

  const r=(side==='BUY' ? price-entry : entry-price)/dist;
  const exitIndex=scan.indexOf(exit);
  const resolvedExitIndex=exitIndex>=0 ? exitIndex : Math.max(0,scan.length-1);
  const inspectedBars=scan.slice(0,Math.min(scan.length,resolvedExitIndex+1));
  let mfeR=0,maeR=0;
  for(const bar of inspectedBars){
    const favorablePrice=side==='BUY' ? bar.high : bar.low+CONFIG.spreadPrice;
    const adversePrice=side==='BUY' ? bar.low : bar.high+CONFIG.spreadPrice;
    const favorable=side==='BUY'
      ? (favorablePrice-entry)/dist
      : (entry-favorablePrice)/dist;
    const adverse=side==='BUY'
      ? (entry-adversePrice)/dist
      : (adversePrice-entry)/dist;
    if(Number.isFinite(favorable))mfeR=Math.max(mfeR,favorable);
    if(Number.isFinite(adverse))maeR=Math.max(maeR,adverse);
  }

  const setupDiagnostics=setup.diagnostics||{};
  const item={
    signal_time:signal.time,
    entry_time:next.time,
    exit_time:exit.time,
    exit_index:resolvedExitIndex,
    entry_bar_exit:resolvedExitIndex===0,
    holding_bars:Math.max(1,resolvedExitIndex+1),
    holding_minutes:Math.max(0,(exit.time-next.time)/60),
    side,
    setup_type:setup.setup_type,
    entry,
    stop_loss:stop,
    take_profit:target,
    risk_cash:risk,
    entry_gap_atr:entryGapAtr,
    effective_rr:effectiveRR,
    net_r:r,
    net_pnl:risk*r,
    exit_reason:reason,
    stop_and_target_same_bar:stopAndTargetSameBar,
    hour_utc:Number.isFinite(Number(setupDiagnostics.hour_utc))
      ? Number(setupDiagnostics.hour_utc)
      : new Date((signal.time+300)*1000).getUTCHours(),
    range_atr:setupDiagnostics.range_atr??null,
    breakout_atr:setupDiagnostics.breakout_atr??null,
    body_atr:setupDiagnostics.body_atr??null,
    close_location:setupDiagnostics.close_location??null,
    volume_ratio:setupDiagnostics.volume_ratio??null,
    extension_atr:setupDiagnostics.extension_atr??null,
    mfe_r:mfeR,
    mae_r:maeR
  };
  item.exit_class=classifyTradeExit(item);
  return item;
}
function fp(obj){return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');}
function datasetFingerprint(rows){
  const h=crypto.createHash('sha256');
  for(const b of rows){
    h.update(String(b.time));h.update('|');
    h.update(String(b.open));h.update('|');h.update(String(b.high));h.update('|');
    h.update(String(b.low));h.update('|');h.update(String(b.close));h.update('|');
    h.update(String(b.volume));h.update('\\n');
  }
  return h.digest('hex');
}
async function atomic(file,obj){const tmp=file+'.tmp-'+process.pid;await fs.writeFile(tmp,JSON.stringify(obj,null,2));await fs.rename(tmp,file);}
async function loadData(){const f=process.env.GOLD_BACKTEST_DATA_FILE;if(f){const raw=await fs.readFile(path.resolve(f));const text=f.endsWith('.gz')?gunzipSync(raw).toString('utf8'):raw.toString('utf8');const a=JSON.parse(text).map(b=>({time:Number(b.time),open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume)||0})).filter(b=>Number.isFinite(b.time)&&b.open>0&&b.high>=b.low&&b.high>=b.open&&b.high>=b.close&&b.low<=b.open&&b.low<=b.close).sort((a,b)=>a.time-b.time);if(a.length<200000)throw Error('Insufficient data: '+a.length);return a;}const mod=await import('dukascopy-node');const get=mod.getHistoricalRates||mod.default?.getHistoricalRates;if(typeof get!=='function')throw Error('dukascopy-node getHistoricalRates export not found');const end=process.env.GOLD_BACKTEST_END_UTC?new Date(process.env.GOLD_BACKTEST_END_UTC):new Date();if(Number.isNaN(end.getTime()))throw Error('Invalid GOLD_BACKTEST_END_UTC');const start=process.env.GOLD_BACKTEST_START_UTC?new Date(process.env.GOLD_BACKTEST_START_UTC):new Date(end.getTime()-CONFIG.lookbackDays*86400000);if(Number.isNaN(start.getTime())||start>=end)throw Error('Invalid GOLD_BACKTEST_START_UTC');const rows=await get({instrument:'xauusd',dates:{from:start,to:end},timeframe:'m5',priceType:'bid',volumes:true,format:'array'});const a=rows.map(r=>({time:Math.floor(Number(r[0])/1000),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])||0})).filter(b=>Number.isFinite(b.time)&&b.open>0&&b.high>=b.low&&b.high>=b.open&&b.high>=b.close&&b.low<=b.open&&b.low<=b.close).sort((a,b)=>a.time-b.time);if(a.length<200000)throw Error('Insufficient data: '+a.length);return a;}
function createFunnelDiagnostics() {
  return {
    schema_version: 1,
    bars_scanned: 0,
    bars_skipped_while_in_trade: 0,
    invalid_m5_feature_bars: 0,
    invalid_h1_feature_bars: 0,
    signals_evaluated: 0,
    setup_wait_reasons: {},
    candidates: 0,
    candidates_buy: 0,
    candidates_sell: 0,
    candidates_other: 0,
    risk_gate_checks: 0,
    risk_gate_blocked_candidates: 0,
    risk_gate_blocks: {},
    risk_gate_passed: 0,
    rejected_next_bar_gap: 0,
    trade_attempts: 0,
    rejected_invalid_geometry: 0,
    rejected_entry_gap: 0,
    rejected_effective_rr: 0,
    trades_accepted: 0
  };
}

function incrementCounter(map, key) {
  map[key] = (map[key] || 0) + 1;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const raw = await loadData();
  const m = indicators(raw);
  const h = indicators(h1(raw));
  const dataset = fp({
    content_sha256: datasetFingerprint(raw),
    first: raw[0],
    last: raw.at(-1),
    rows: raw.length,
    config: CONFIG,
    strategy: STRATEGY
  });

  let cp = null;
  try {
    cp = JSON.parse(await fs.readFile(CP, 'utf8'));
  } catch {}
  const identity = fp({
    dataset,
    config: CONFIG,
    strategy: STRATEGY,
    exit_diagnostics_version: 1,
    funnel_diagnostics_version: 1
  });
  if (cp && cp.identity !== identity) {
    throw Error('Checkpoint identity mismatch; refusing unsafe resume');
  }

  let i = cp?.next_index ?? 250;
  let e = cp?.equity ?? CONFIG.initialEquity;
  const trades = cp?.trades ?? [];
  const state = cp?.state ?? { day: null, dayStartEquity: e, peak: e };
  let nextAvailable = cp?.next_available ?? 0;
  const diagnostics = cp?.funnel_diagnostics ?? createFunnelDiagnostics();
  const stopAfter = Number(process.env.GOLD_TEST_STOP_AFTER_BARS || 0);
  let processed = 0;

  const saveCheckpoint = async (status) => atomic(CP, {
    version: 2,
    identity,
    dataset,
    updated_at: new Date().toISOString(),
    next_index: i,
    equity: e,
    trades,
    state,
    next_available: nextAvailable,
    funnel_diagnostics: diagnostics,
    ...(status ? { status } : {})
  });

  while (i < m.length - 1) {
    diagnostics.bars_scanned++;
    if (i < nextAvailable) {
      diagnostics.bars_skipped_while_in_trade++;
      i++;
      continue;
    }

    const s = m[i];
    if (![s.ema20, s.ema50, s.rsi14, s.atr14].every(Number.isFinite)) {
      diagnostics.invalid_m5_feature_bars++;
      i++;
      continue;
    }

    const st = s.time + 300;
    const hi = h1idx(h, st);
    const hv = h[hi];
    if (!hv || ![hv.close, hv.ema20, hv.ema50, hv.ema200, hv.rsi14, hv.atr14].every(Number.isFinite)) {
      diagnostics.invalid_h1_feature_bars++;
      i++;
      continue;
    }

    const setup = buildGoldV2Setup({
      m5: { ema20: s.ema20, ema50: s.ema50, rsi14: s.rsi14, atr14: s.atr14 },
      h1: { close: hv.close, ema20: hv.ema20, ema50: hv.ema50, ema200: hv.ema200, rsi14: hv.rsi14, atr14: hv.atr14 },
      recentM5: recent(m, i, Math.max(80, STRATEGY.rangeLookback + 1))
    }, STRATEGY);
    diagnostics.signals_evaluated++;

    if (setup.candidate === 'WAIT') {
      incrementCounter(
        diagnostics.setup_wait_reasons,
        typeof setup.reason === 'string' && setup.reason ? setup.reason : 'unknown'
      );
    } else {
      diagnostics.candidates++;
      if (setup.candidate === 'BUY') diagnostics.candidates_buy++;
      else if (setup.candidate === 'SELL') diagnostics.candidates_sell++;
      else diagnostics.candidates_other++;

      const g = gate(state, e, st);
      diagnostics.risk_gate_checks++;
      if (!g.allowed) {
        diagnostics.risk_gate_blocked_candidates++;
        for (const reason of g.reasons) incrementCounter(diagnostics.risk_gate_blocks, reason);
      } else {
        diagnostics.risk_gate_passed++;
        if (m[i + 1].time - s.time !== 300) {
          diagnostics.rejected_next_bar_gap++;
        } else {
          diagnostics.trade_attempts++;
          const t = trade(s, m[i + 1], m.slice(i + 1), setup, e, diagnostics);
          if (t) {
            diagnostics.trades_accepted++;
            trades.push(t);
            e += t.net_pnl;
            const ex = i + 1 + (Number.isInteger(t.exit_index) ? t.exit_index : 0) + 1;
            nextAvailable = Math.min(m.length, ex);
          }
        }
      }
    }

    i++;
    processed++;
    if (processed % 1000 === 0) {
      await saveCheckpoint();
      console.log('CHECKPOINT', i, 'trades', trades.length, 'equity', e);
    }
    if (stopAfter > 0 && processed >= stopAfter) {
      await saveCheckpoint('PAUSED');
      console.log('PAUSED_FOR_TEST', i);
      return;
    }
  }

  await saveCheckpoint('COMPLETE');
  await fs.writeFile(
    path.join(OUT, 'gold_v2_resumed_trades.json'),
    JSON.stringify(trades, null, 2)
  );
  await fs.writeFile(
    path.join(OUT, 'gold_v2_funnel_diagnostics.json'),
    JSON.stringify(diagnostics, null, 2)
  );
  console.log('COMPLETE', JSON.stringify({
    rows: raw.length,
    trades: trades.length,
    final_equity: e,
    funnel_diagnostics: diagnostics,
    checkpoint: CP
  }));
}
main().catch(async err=>{console.error('FATAL',err.stack||err);process.exitCode=1;});
