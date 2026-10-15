import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addIndicators,
  aggregateM5ToH1,
  latestCompletedH1Index,
  loadBacktestM5FromFile
} from './backtest-gold-v2.mjs';
import { classifyXmGoldGap, UNVERIFIED_XM_GAP_CLASSES } from '../src/xm_gold_trading_calendar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dataFile = process.env.GOLD_BACKTEST_DATA_FILE;
const outputDir = path.resolve(process.env.GOLD_SELL_BREAKDOWN_OUTPUT_DIR || 'gold-backtest-output/sell-breakdown-universe');
if (!dataFile) throw new Error('GOLD_BACKTEST_DATA_FILE is required.');
await fs.access(dataFile);
await fs.mkdir(outputDir, { recursive: true });

const cfg = {
  timezone: process.env.GOLD_BACKTEST_SERVER_TIMEZONE || 'Europe/Nicosia',
  rangeLookback: Math.max(4, Number(process.env.GOLD_RANGE_LOOKBACK || 12)),
  minRangeAtr: Number(process.env.GOLD_MIN_RANGE_ATR || 0.8),
  maxRangeAtr: Number(process.env.GOLD_MAX_RANGE_ATR || 2.8),
  breakoutAtr: Number(process.env.GOLD_BREAKOUT_ATR || 0.1),
  minBodyAtr: Number(process.env.GOLD_MIN_BODY_ATR || 0.4),
  minCloseLocation: Number(process.env.GOLD_MIN_CLOSE_LOCATION || 0.65),
  minVolumeRatio: Number(process.env.GOLD_MIN_VOLUME_RATIO || 1.1),
  sellRsiMin: Number(process.env.GOLD_SELL_RSI_MIN || 25),
  sellRsiMax: Number(process.env.GOLD_SELL_RSI_MAX || 48),
  minH1RsiSell: Number(process.env.GOLD_MIN_H1_RSI_SELL || 28),
  maxH1RsiSell: Number(process.env.GOLD_MAX_H1_RSI_SELL || 50),
  maxExtensionAtr: Number(process.env.GOLD_MAX_EXTENSION_ATR || 1.5),
  stopBufferAtr: Number(process.env.GOLD_STOP_BUFFER_ATR || 0.15),
  minStopAtr: Number(process.env.GOLD_MIN_STOP_ATR || 0.8),
  maxStopAtr: Number(process.env.GOLD_MAX_STOP_ATR || 2.0),
  takeProfitR: Number(process.env.GOLD_TAKE_PROFIT_R || 2.0),
  sessionStartUtc: Number(process.env.GOLD_SESSION_START_UTC || 7),
  sessionEndUtc: Number(process.env.GOLD_SESSION_END_UTC || 20),
  spreadPrice: Number(process.env.GOLD_BACKTEST_SPREAD_PRICE || 0.5),
  slippagePrice: Number(process.env.GOLD_BACKTEST_SLIPPAGE_PRICE || 0.05),
  maxEntryGapAtr: Number(process.env.GOLD_BACKTEST_MAX_ENTRY_GAP_ATR || 0.5),
  minEffectiveRR: Number(process.env.GOLD_BACKTEST_MIN_EFFECTIVE_RR || 1.5),
  maxHoldBars: Number(process.env.GOLD_BACKTEST_MAX_HOLD_BARS || 96)
};

const raw = await loadBacktestM5FromFile(dataFile);
const m5 = addIndicators(raw);
const h1 = addIndicators(aggregateM5ToH1(raw, cfg.timezone));

function isContiguous(bars) {
  if (bars.length < 2) return true;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].time - bars[i-1].time !== 300) return false;
  }
  return true;
}
function avg(values) {
  const a=values.filter(Number.isFinite);
  return a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
}
function median(values) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if (!a.length) return null;
  const n=Math.floor(a.length/2);
  return a.length%2 ? a[n] : (a[n-1]+a[n])/2;
}
function pct(a,b) { return b ? a/b*100 : null; }
function finite(v) { return Number.isFinite(Number(v)) ? Number(v) : null; }
function sessionAllowed(hour) {
  return cfg.sessionStartUtc <= cfg.sessionEndUtc
    ? hour >= cfg.sessionStartUtc && hour <= cfg.sessionEndUtc
    : hour >= cfg.sessionStartUtc || hour <= cfg.sessionEndUtc;
}
function forwardHorizon(bars, startIndex, event) {
  const output={};
  for (const n of [3,6,12,18,24]) {
    const minutes=n*5;
    const sample=bars.slice(startIndex,startIndex+n);
    const seen=[];
    let prev=null;
    for(const b of sample) {
      if(prev && b.time-prev.time!==300) break;
      seen.push(b); prev=b;
    }
    const complete=seen.length===n;
    if(!seen.length) {
      output[String(minutes)]={horizon_minutes:minutes,complete:false,observed_bars:0};
      continue;
    }
    const lo=Math.min(...seen.map(b=>b.low));
    const hi=Math.max(...seen.map(b=>b.high));
    const last=seen[seen.length-1];
    const entry=event.entry_price;
    const stopDistance=event.stop_distance;
    const fav=entry-(lo+cfg.spreadPrice);
    const adv=hi+cfg.spreadPrice-entry;
    const close=entry-(last.close+cfg.spreadPrice);
    let firstBarrier=null;
    for(const b of seen) {
      const stopHit=b.high+cfg.spreadPrice>=event.stop_loss;
      const targetHit=b.low+cfg.spreadPrice<=event.take_profit;
      if(stopHit) {
        firstBarrier={reason:'STOP',bar_open_utc:new Date(b.time*1000).toISOString(),both_touched:targetHit};
        break;
      }
      if(targetHit) {
        firstBarrier={reason:'TARGET',bar_open_utc:new Date(b.time*1000).toISOString(),both_touched:false};
        break;
      }
    }
    output[String(minutes)]={
      horizon_minutes:minutes,
      complete,
      observed_bars:seen.length,
      close_time_utc:new Date((last.time+300)*1000).toISOString(),
      close_move_atr:close/event.signal_atr,
      MFE_atr:Math.max(0,fav/event.signal_atr),
      MAE_atr:Math.max(0,adv/event.signal_atr),
      close_move_R:stopDistance>0?close/stopDistance:null,
      MFE_R:stopDistance>0?Math.max(0,fav/stopDistance):null,
      MAE_R:stopDistance>0?Math.max(0,adv/stopDistance):null,
      first_barrier:firstBarrier,
      note:'Fixed-horizon path study; measurement continues after stop/target and is not tradable PnL.'
    };
  }
  return output;
}
function isolatedBarrierOutcome(bars, startIndex, event) {
  if (!(event.stop_distance>0) || !Number.isFinite(event.entry_price)) return {reason:'INVALID_STOP_GEOMETRY',net_R:null};
  const scan=bars.slice(startIndex,startIndex+cfg.maxHoldBars);
  if(!scan.length) return {reason:'NO_FORWARD_BARS',net_R:null};
  let previous=null, exitReason='TIME', exitPrice=scan[scan.length-1].close+cfg.spreadPrice+cfg.slippagePrice, exitTime=scan[scan.length-1].time;
  let firstGap=null;
  for(const b of scan) {
    if(previous && b.time-previous.time>900) {
      const gap=classifyXmGoldGap(previous.time,b.time);
      if(!firstGap) firstGap={
        classification:gap.classification,
        start_pair:gap.start_pair,
        gap_start_utc:new Date(gap.gap_start*1000).toISOString(),
        next_bar_time_utc:new Date(b.time*1000).toISOString(),
        minutes_missing:gap.minutes_missing,
        expected_xm_gold_gap_pair:gap.expected_xm_gold_gap_pair
      };
      if(UNVERIFIED_XM_GAP_CLASSES.has(gap.classification)) {
        return {
          reason:'CENSORED_UNVERIFIED_SESSION_GAP',
          exit_time_utc:new Date(previous.time*1000).toISOString(),
          net_R:null,
          first_gap:firstGap,
          note:'Censored because this gap is not verified by the published regular XM GOLD session or a dated holiday calendar.'
        };
      }
      // For a confirmed daily/weekend closure, carry the open position and check the reopen price.
      const openWithSpread=b.open+cfg.spreadPrice;
      if(openWithSpread>=event.stop_loss) {
        exitReason='STOP_GAP_ADVERSE_FILL';
        exitPrice=b.open+cfg.spreadPrice+cfg.slippagePrice;
        exitTime=b.time;
        break;
      }
      if(openWithSpread<=event.take_profit) {
        exitReason='TARGET_GAP_AT_LIMIT';
        exitPrice=event.take_profit+cfg.spreadPrice+cfg.slippagePrice;
        exitTime=b.time;
        break;
      }
    }
    const stopHit=b.high+cfg.spreadPrice>=event.stop_loss;
    const targetHit=b.low+cfg.spreadPrice<=event.take_profit;
    // M5 OHLC cannot establish intra-bar order if both barriers are touched; stop-first is conservative.
    if(stopHit) {
      exitReason='STOP';
      exitPrice=event.stop_loss+cfg.spreadPrice+cfg.slippagePrice;
      exitTime=b.time;
      break;
    }
    if(targetHit) {
      exitReason='TARGET';
      exitPrice=event.take_profit+cfg.spreadPrice+cfg.slippagePrice;
      exitTime=b.time;
      break;
    }
    previous=b;
  }
  return {
    reason:exitReason,
    exit_time_utc:new Date(exitTime*1000).toISOString(),
    net_R:(event.entry_price-exitPrice)/event.stop_distance,
    first_gap:firstGap,
    note:'Primary gap-aware isolated event-path sensitivity: carry positions through confirmed XM GOLD closures; censor unverified gaps. Event paths can overlap and are not portfolio results.'
  };
}

const events=[];
const scanned={evaluated_bars:0,valid_indicators:0,session_and_soft_H1_gate:0,range_compression_pass:0,first_breaks:0,excluded_for_next_bar_gap:0};
const lb=cfg.rangeLookback;
for(let i=250;i<m5.length-1;i++) {
  const s=m5[i];
  if(![s.ema20,s.ema50,s.rsi14,s.atr14].every(Number.isFinite) || !(s.atr14>0)) continue;
  scanned.evaluated_bars++;
  const signalTime=s.time+300;
  const hi=latestCompletedH1Index(h1,signalTime);
  const h=h1[hi];
  if(!h || ![h.close,h.ema20,h.ema50,h.ema200,h.rsi14,h.atr14].every(Number.isFinite)) continue;
  scanned.valid_indicators++;

  const strategyHour=new Date(signalTime*1000).getUTCHours();
  if(!sessionAllowed(strategyHour)) continue;
  if(!(h.close<h.ema20 && h.rsi14>=cfg.minH1RsiSell && h.rsi14<=cfg.maxH1RsiSell)) continue;
  scanned.session_and_soft_H1_gate++;

  if(i<lb+1) continue;
  const prior=m5.slice(i-lb,i);
  const prevPrior=m5.slice(i-lb-1,i-1);
  const prev=m5[i-1];
  if(prior.length!==lb || prevPrior.length!==lb || !isContiguous(prior) || !isContiguous(prevPrior)) continue;
  if(s.time-prior[prior.length-1].time!==300 || prev.time-prevPrior[prevPrior.length-1].time!==300) continue;

  const rangeHigh=Math.max(...prior.map(b=>b.high));
  const rangeLow=Math.min(...prior.map(b=>b.low));
  const prevRangeLow=Math.min(...prevPrior.map(b=>b.low));
  const rangeWidth=rangeHigh-rangeLow;
  const rangeAtr=rangeWidth/s.atr14;
  if(!(rangeWidth>0 && rangeAtr>=cfg.minRangeAtr && rangeAtr<=cfg.maxRangeAtr)) continue;
  scanned.range_compression_pass++;

  // One event is recorded at the first close that crosses under the preceding rolling range low.
  // A continuing sequence of lower closes is not counted again until price first reclaims its
  // own immediately preceding rolling range floor.
  const breakoutDistance=rangeLow-s.close;
  if(!(breakoutDistance>0 && prev.close>=prevRangeLow)) continue;
  scanned.first_breaks++;
  const next=m5[i+1];
  if(next.time-s.time!==300) {
    scanned.excluded_for_next_bar_gap++;
    continue;
  }

  const signalHourUtc=new Date(s.time*1000).getUTCHours();
  const candleRange=s.high-s.low;
  const body=Math.abs(s.close-s.open);
  const bearishBody=s.open-s.close;
  const closeLocation=candleRange>0?(s.close-s.low)/candleRange:null;
  const avgVolume=prior.reduce((sum,b)=>sum+Math.max(0,b.volume),0)/prior.length;
  const volumeRatio=avgVolume>0?s.volume/avgVolume:0;
  const breakoutAtr=breakoutDistance/s.atr14;
  const bodyAtr=body/s.atr14;
  const bearishBodyAtr=bearishBody/s.atr14;
  const extensionAtr=(s.ema20-s.close)/s.atr14;
  const strictBearStack=h.ema20<h.ema50 && h.ema50<h.ema200;
  const entry=next.open-cfg.slippagePrice;
  const stop=Math.max(rangeHigh+cfg.stopBufferAtr*s.atr14,s.high+0.05*s.atr14);
  const stopDistance=Math.abs(entry-stop);
  const referenceStopDistance=Math.abs(s.close-stop);
  const target=s.close-cfg.takeProfitR*referenceStopDistance;
  const effectiveRR=stopDistance>0?Math.abs(target-entry)/stopDistance:null;
  const entryGapAtr=Math.abs(next.open-s.close)/s.atr14;
  const event={
    signal_time:s.time,
    signal_time_utc:new Date(s.time*1000).toISOString(),
    signal_close_time_utc:new Date(signalTime*1000).toISOString(),
    year_utc:new Date(s.time*1000).toISOString().slice(0,4),
    hour_utc:signalHourUtc,
    strategy_session_hour_utc:strategyHour,
    side:'SELL',
    h1_soft_gate_passed:true,
    h1_close_below_ema20:true,
    h1_rsi14:h.rsi14,
    h1_close_vs_ema20_atr:(h.close-h.ema20)/h.atr14,
    h1_ema20_vs_ema50_atr:(h.ema20-h.ema50)/h.atr14,
    h1_ema50_vs_ema200_atr:(h.ema50-h.ema200)/h.atr14,
    strict_bear_stack:strictBearStack,
    m5_rsi14:s.rsi14,
    range_atr:rangeAtr,
    breakout_atr:breakoutAtr,
    body_atr:bodyAtr,
    bearish_body_atr:bearishBodyAtr,
    close_location:closeLocation,
    volume_ratio:volumeRatio,
    extension_atr:extensionAtr,
    stop_atr:referenceStopDistance/s.atr14,
    entry_gap_atr:entryGapAtr,
    effective_rr:effectiveRR,
    entry_gap_pass:entryGapAtr<=cfg.maxEntryGapAtr,
    effective_rr_pass:Number.isFinite(effectiveRR)&&effectiveRR>=cfg.minEffectiveRR,
    m5_body_pass:bodyAtr>=cfg.minBodyAtr,
    volume_pass:volumeRatio>=cfg.minVolumeRatio,
    breakout_threshold_pass:breakoutAtr>=cfg.breakoutAtr,
    close_location_pass:closeLocation!==null&&closeLocation<=1-cfg.minCloseLocation,
    m5_rsi_pass:s.rsi14>=cfg.sellRsiMin&&s.rsi14<=cfg.sellRsiMax,
    m5_ema_alignment_pass:s.close<=s.ema20,
    extension_pass:extensionAtr<=cfg.maxExtensionAtr,
    stop_distance_pass:referenceStopDistance/s.atr14>=cfg.minStopAtr&&referenceStopDistance/s.atr14<=cfg.maxStopAtr,
    signal_open:s.open,
    signal_high:s.high,
    signal_low:s.low,
    signal_close:s.close,
    signal_atr:s.atr14,
    range_high:rangeHigh,
    range_low:rangeLow,
    entry_price:entry,
    stop_loss:stop,
    take_profit:target,
    stop_distance:stopDistance
  };
  event.forward_followthrough=forwardHorizon(m5,i+1,event);
  event.isolated_barrier_outcome=isolatedBarrierOutcome(m5,i+1,event);
  event.passes_strict_h1_gate=strictBearStack;
  event.passes_current_m5_gates=Boolean(event.m5_body_pass&&event.volume_pass&&event.breakout_threshold_pass&&event.close_location_pass&&event.m5_rsi_pass&&event.m5_ema_alignment_pass&&event.extension_pass&&event.stop_distance_pass&&event.entry_gap_pass&&event.effective_rr_pass);
  event.passes_approx_full_entry_gates=Boolean(event.passes_strict_h1_gate&&event.passes_current_m5_gates);
  events.push(event);
}

function horizonMetrics(rows, minutes) {
  const all=rows.map(e=>e.forward_followthrough?.[String(minutes)]).filter(Boolean);
  const complete=all.filter(x=>x.complete);
  const close=complete.map(x=>finite(x.close_move_R)).filter(Number.isFinite);
  const mfe=complete.map(x=>finite(x.MFE_R)).filter(Number.isFinite);
  const mae=complete.map(x=>finite(x.MAE_R)).filter(Number.isFinite);
  const fav=complete.filter(x=>finite(x.close_move_R)>0).length;
  const barriers=Object.fromEntries(['STOP','TARGET'].map(k=>[k,complete.filter(x=>x.first_barrier?.reason===k).length]).filter(([,n])=>n>0));
  return {
    n_events:rows.length,
    n_complete:complete.length,
    mean_close_move_R:avg(close),
    median_close_move_R:median(close),
    favourable_close_pct:pct(fav,complete.length),
    mean_MFE_R:avg(mfe),
    mean_MAE_R:avg(mae),
    first_barrier_counts:barriers
  };
}
function outcomeMetrics(rows) {
  const outcomes=rows.map(e=>e.isolated_barrier_outcome||{}).filter(x=>Number.isFinite(x.net_R));
  const net=outcomes.map(x=>x.net_R);
  const wins=outcomes.filter(x=>x.net_R>0).length;
  const positive=outcomes.filter(x=>x.net_R>0).map(x=>x.net_R).reduce((s,x)=>s+x,0);
  const negative=Math.abs(outcomes.filter(x=>x.net_R<0).map(x=>x.net_R).reduce((s,x)=>s+x,0));
  return {
    isolated_events:outcomes.length,
    target_exits:outcomes.filter(x=>x.reason==='TARGET').length,
    stop_exits:outcomes.filter(x=>x.reason==='STOP').length,
    scheduled_gap_stop_exits:outcomes.filter(x=>x.reason==='STOP_GAP_ADVERSE_FILL').length,
    scheduled_gap_target_exits:outcomes.filter(x=>x.reason==='TARGET_GAP_AT_LIMIT').length,
    censored_unverified_gap_exits:rows.map(e=>e.isolated_barrier_outcome).filter(x=>x?.reason==='CENSORED_UNVERIFIED_SESSION_GAP').length,
    time_exits:outcomes.filter(x=>x.reason==='TIME').length,
    winners:wins,
    mean_net_R:avg(net),
    profit_factor_isolated_events:negative>0?positive/negative:null,
    note:'Isolated-event outcomes may overlap and are not portfolio performance.'
  };
}
function groupRows(rows, def) {
  return def.buckets.map(bucket=>{
    const subset=rows.filter(e=>{
      const x=def.feature(e);
      return Number.isFinite(x)&&bucket.test(x);
    });
    return {
      bucket:bucket.label,
      n:subset.length,
      event_rate_pct:pct(subset.length,rows.length),
      strict_bear_stack_n:subset.filter(e=>e.strict_bear_stack).length,
      approx_full_gate_n:subset.filter(e=>e.passes_approx_full_entry_gates).length,
      isolated_outcomes:outcomeMetrics(subset),
      horizons:Object.fromEntries([15,30,60,90,120].map(m=>[String(m),horizonMetrics(subset,m)])),
      signal_times_utc:subset.map(e=>e.signal_time_utc)
    };
  });
}

const bucketDefs=[
  {key:'strict_bear_stack',label:'H1 EMA stack',feature:e=>e.strict_bear_stack?1:0,buckets:[
    {label:'Non-strict EMA20/50/200 stack',test:x=>x===0},
    {label:'Strict bearish EMA20 < EMA50 < EMA200',test:x=>x===1}
  ]},
  {key:'h1_close_vs_ema20',label:'|H1 close - EMA20| / H1 ATR',feature:e=>Math.abs(e.h1_close_vs_ema20_atr),buckets:[
    {label:'<0.50',test:x=>x<0.5},{label:'0.50–0.99',test:x=>x>=0.5&&x<1},{label:'≥1.00',test:x=>x>=1}
  ]},
  {key:'h1_ema20_vs_ema50',label:'H1 EMA20 - EMA50 / H1 ATR (signed)',feature:e=>e.h1_ema20_vs_ema50_atr,buckets:[
    {label:'≤-1.00',test:x=>x<=-1},{label:'-1.00 to -0.50',test:x=>x>-1&&x<=-0.5},{label:'-0.50 to 0',test:x=>x>-0.5&&x<0},{label:'≥0',test:x=>x>=0}
  ]},
  {key:'h1_ema50_vs_ema200',label:'H1 EMA50 - EMA200 / H1 ATR (signed)',feature:e=>e.h1_ema50_vs_ema200_atr,buckets:[
    {label:'≤-1.00',test:x=>x<=-1},{label:'-1.00 to -0.25',test:x=>x>-1&&x<=-0.25},{label:'-0.25 to 0',test:x=>x>-0.25&&x<0},{label:'≥0',test:x=>x>=0}
  ]},
  {key:'h1_rsi',label:'H1 RSI14',feature:e=>e.h1_rsi14,buckets:[
    {label:'28–34.99',test:x=>x>=28&&x<35},{label:'35–41.99',test:x=>x>=35&&x<42},{label:'42–50',test:x=>x>=42&&x<=50}
  ]},
  {key:'breakout_atr',label:'M5 breakout width / M5 ATR',feature:e=>e.breakout_atr,buckets:[
    {label:'0–0.149',test:x=>x<0.15},{label:'0.15–0.249',test:x=>x>=0.15&&x<0.25},{label:'≥0.25',test:x=>x>=0.25}
  ]},
  {key:'body_atr',label:'M5 absolute candle body / M5 ATR',feature:e=>e.body_atr,buckets:[
    {label:'<0.60',test:x=>x<0.60},{label:'0.60–0.799',test:x=>x>=0.6&&x<0.8},{label:'≥0.80',test:x=>x>=0.8}
  ]},
  {key:'bearish_body_atr',label:'M5 signed bearish body (open-close) / ATR',feature:e=>e.bearish_body_atr,buckets:[
    {label:'<0.40',test:x=>x<0.4},{label:'0.40–0.599',test:x=>x>=0.4&&x<0.6},{label:'≥0.60',test:x=>x>=0.6}
  ]},
  {key:'volume_ratio',label:'M5 volume / preceding range mean volume',feature:e=>e.volume_ratio,buckets:[
    {label:'<1.15',test:x=>x<1.15},{label:'1.15–1.349',test:x=>x>=1.15&&x<1.35},{label:'≥1.35',test:x=>x>=1.35}
  ]},
  {key:'close_location',label:'M5 close location in candle range (0=low)',feature:e=>e.close_location,buckets:[
    {label:'≤0.20 (close near low)',test:x=>x<=0.2},{label:'0.20–0.35',test:x=>x>0.2&&x<=0.35},{label:'>0.35',test:x=>x>0.35}
  ]},
  {key:'utc_hour',label:'UTC signal hour',feature:e=>e.hour_utc,buckets:[
    {label:'07–11 UTC',test:x=>x>=7&&x<=11},{label:'12–15 UTC',test:x=>x>=12&&x<=15},{label:'16–19 UTC',test:x=>x>=16&&x<=19},{label:'20 UTC',test:x=>x===20}
  ]}
];

const counts={
  data_rows:raw.length,
  evaluated_bars:scanned.evaluated_bars,
  valid_indicators:scanned.valid_indicators,
  session_and_soft_H1_gate:scanned.session_and_soft_H1_gate,
  range_compression_pass:scanned.range_compression_pass,
  first_breaks:scanned.first_breaks,
  excluded_for_next_bar_gap:scanned.excluded_for_next_bar_gap,
  analyzed_events:events.length,
  passes_strict_h1_gate:events.filter(e=>e.passes_strict_h1_gate).length,
  fails_strict_h1_gate:events.filter(e=>!e.passes_strict_h1_gate).length,
  passes_approx_full_entry_gates:events.filter(e=>e.passes_approx_full_entry_gates).length,
  m5_filter_passes:Object.fromEntries(['m5_body_pass','volume_pass','breakout_threshold_pass','close_location_pass','m5_rsi_pass','m5_ema_alignment_pass','extension_pass','stop_distance_pass','entry_gap_pass','effective_rr_pass'].map(k=>[k,events.filter(e=>e[k]).length]))
};
const result={
  generated_at:new Date().toISOString(),
  research_only:true,
  live_trading_settings_changed:false,
  instrument:'XAUUSD',
  data_source:process.env.GOLD_BACKTEST_DATA_FILE,
  source_period:{m5_first:new Date(raw[0].time*1000).toISOString(),m5_last:new Date(raw[raw.length-1].time*1000).toISOString()},
  data_rows:raw.length,
  timezone_h1_aggregation:cfg.timezone,
  universe_definition:'A single first close-break below the prior rolling M5 range low after a reclaim, using the baseline compression range (0.8–2.8 ATR), UTC session and a soft bearish H1 gate (H1 close below EMA20 and H1 RSI 28–50). All later M5 acceptance filters and the strict EMA20/50/200 stack are treated as diagnostic variables, not universe gates.',
  fixed_assumptions:{
    range_lookback:cfg.rangeLookback,
    range_atr_min:cfg.minRangeAtr,
    range_atr_max:cfg.maxRangeAtr,
    h1_rsi_sell_min:cfg.minH1RsiSell,
    h1_rsi_sell_max:cfg.maxH1RsiSell,
    session_start_utc:cfg.sessionStartUtc,
    session_end_utc:cfg.sessionEndUtc,
    spread_price:cfg.spreadPrice,
    slippage_price:cfg.slippagePrice,
    take_profit_R:cfg.takeProfitR,
    max_hold_bars:cfg.maxHoldBars
  },
  counts,
  overall:{
    isolated_outcomes:outcomeMetrics(events),
    horizons:Object.fromEntries([15,30,60,90,120].map(m=>[String(m),horizonMetrics(events,m)])),
    by_strict_bear_stack:groupRows(events,bucketDefs[0]),
    by_year:Object.fromEntries([...new Set(events.map(e=>e.year_utc))].sort().map(y=>[y,{n:events.filter(e=>e.year_utc===y).length,metrics:outcomeMetrics(events.filter(e=>e.year_utc===y)),horizons:Object.fromEntries([30,60,120].map(m=>[String(m),horizonMetrics(events.filter(e=>e.year_utc===y),m)]))}]))
  },
  feature_breakdowns:Object.fromEntries(bucketDefs.slice(1).map(def=>[def.key,{feature:def.label,buckets:groupRows(events,def)}])),
  events,
  interpretation_limits:[
    'These are first-break event observations, not all tick movements or independent observations; separated events can still overlap within the 96-bar horizon.',
    'The event universe intentionally ignores M5 body, volume, close-location, RSI, EMA-alignment, extension, stop-distance, entry-gap and effective-RR filters; those are studied as variables/gates.',
    'Fixed-horizon outcomes require consecutive M5 bars; any timestamp gap inside a selected horizon makes it incomplete/censored. Horizons represent contiguous active-market bars, not elapsed wall-clock minutes, and continue after barriers; they are not real trade PnL.',
    'The primary isolated barrier model carries positions across calendar-confirmed daily/weekend closures and uses the first observed reopen price for gap-through barriers; unverified gaps are censored rather than exited at the prior candle close.',
    'Bucket counts below five are descriptive only; no causal or production rule should be inferred from these results.'
  ]
};
await fs.writeFile(path.join(outputDir,'gold_v2_sell_breakdown_universe.json'),JSON.stringify(result,null,2));

const flat=events.map(e=>{
  const row={...e};
  for(const minutes of [15,30,60,90,120]){
    const x=e.forward_followthrough[String(minutes)]||{};
    row['close_move_'+minutes+'m_R']=x.complete?x.close_move_R:null;
    row['MFE_'+minutes+'m_R']=x.complete?x.MFE_R:null;
    row['MAE_'+minutes+'m_R']=x.complete?x.MAE_R:null;
    row['barrier_'+minutes+'m']=x.complete?(x.first_barrier?.reason||'NONE'):null;
    delete row.forward_followthrough;
  }
  return row;
});
const csvFields=Object.keys(flat[0]||{});
const esc=v=>{
  if(v===null||v===undefined)return '';
  const s=typeof v==='object'?JSON.stringify(v):String(v);
  return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
};
await fs.writeFile(path.join(outputDir,'gold_v2_sell_breakdown_universe_events.csv'),
  [csvFields.join(','),...flat.map(row=>csvFields.map(k=>esc(row[k])).join(','))].join('\n')+'\n');

const f=x=>x===null||x===undefined||!Number.isFinite(Number(x))?'—':Number(x).toFixed(3);
const table=(groupRows, featureName)=>[
  '',
  '### '+featureName,
  '',
  '| Bucket | n events | Approx full-gate matches | 30m mean close R | 60m mean close R | 60m favourable-close % | 60m mean MFE R | 60m mean MAE R | 96-bar isolated targets | 96-bar isolated stops |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...groupRows.map(g=>'| '+[
    g.bucket,g.n,g.approx_full_gate_n,
    f(g.horizons['30'].mean_close_move_R),f(g.horizons['60'].mean_close_move_R),
    f(g.horizons['60'].favourable_close_pct),f(g.horizons['60'].mean_MFE_R),f(g.horizons['60'].mean_MAE_R),
    g.isolated_outcomes.target_exits,g.isolated_outcomes.stop_exits
  ].join(' | ')+' |')
];
const md=[
  '# Expanded GOLD SELL range-break event study',
  '',
  '**Research only. No entry filter, RR floor or live execution setting was changed.**',
  '',
  'This second layer widens the universe beyond accepted strategy signals: it records the first close below the preceding rolling M5 range low after a reclaim, with the baseline range ATR, UTC session and soft bearish H1 gate fixed. Strict EMA stack, M5 body, volume, breakout width, close location, M5 RSI, EMA alignment, extension, stop geometry, entry gap and effective RR are then measured rather than used as eligibility gates.',
  '',
  'Fixed-horizon returns continue after the simulated stop/target and therefore describe the OHLC price path, not real trade PnL. Isolated target/stop outcomes can overlap and are not portfolio performance.',
  '',
  '## Event counts and funnel',
  '',
  '| Stage | Count |',
  '|---|---:|',
  ...Object.entries(counts).map(([k,v])=>'| '+k+' | '+(typeof v==='number'?v:JSON.stringify(v))+' |'),
  '',
  '## Overall SELL breakdown follow-through',
  '',
  '| Horizon | Complete n | Mean close move R | Median close move R | Favourable close % | Mean MFE R | Mean MAE R | Barrier counts within window |',
  '|---:|---:|---:|---:|---:|---:|---:|---|',
  ...[15,30,60,90,120].map(m=>{const x=result.overall.horizons[String(m)];return '| '+m+'m | '+x.n_complete+' | '+f(x.mean_close_move_R)+' | '+f(x.median_close_move_R)+' | '+f(x.favourable_close_pct)+' | '+f(x.mean_MFE_R)+' | '+f(x.mean_MAE_R)+' | '+JSON.stringify(x.first_barrier_counts)+' |';}),
  ...table(result.overall.by_strict_bear_stack,'Strict H1 EMA stack vs non-strict H1 stack')
];
for(const def of bucketDefs.slice(1)){
  md.push(...table(result.feature_breakdowns[def.key].buckets,def.label));
}
md.push(
  '',
  '## Interpretation limits',
  '',
  '- The universe starts with H1 close below EMA20 and H1 RSI 28–50, a compression-range width of 0.8–2.8 ATR and a fresh close-break below the prior range low. It intentionally includes breakouts that later M5 strategy filters would reject.',
  '- The fixed buckets were chosen before looking at these event results. Buckets with fewer than five events are descriptive only.',
  '- Event horizons can overlap and continue after a simulated barrier; do not treat the isolated outcomes as strategy expectancy or deployable results.',
  '- If a pattern appears useful, it still requires independent out-of-sample and conservative-cost testing before considering any strategy change.',
  ''
);
await fs.writeFile(path.join(outputDir,'gold_v2_sell_breakdown_universe.md'),md.join('\n'));
console.log('GOLD V2 SELL BREAKDOWN UNIVERSE PASS',JSON.stringify({
  counts,
  outputDir,
  json:path.join(outputDir,'gold_v2_sell_breakdown_universe.json'),
  csv:path.join(outputDir,'gold_v2_sell_breakdown_universe_events.csv'),
  markdown:path.join(outputDir,'gold_v2_sell_breakdown_universe.md')
}));
