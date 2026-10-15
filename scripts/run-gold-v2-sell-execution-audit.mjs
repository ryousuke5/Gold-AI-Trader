import fs from 'node:fs/promises';
import path from 'node:path';
import { loadBacktestM5FromFile } from './backtest-gold-v2.mjs';
import { classifyXmGoldGap, hourMinuteUtc, UNVERIFIED_XM_GAP_CLASSES } from '../src/xm_gold_trading_calendar.js';

const inputJson = path.resolve(process.env.GOLD_SELL_BREAKDOWN_JSON || 'gold-backtest-output/sell-breakdown-universe/gold_v2_sell_breakdown_universe.json');
const dataFile = process.env.GOLD_BACKTEST_DATA_FILE;
const outputDir = path.resolve(process.env.GOLD_SELL_EXECUTION_AUDIT_DIR || 'gold-backtest-output/sell-execution-audit');
if (!dataFile) throw new Error('GOLD_BACKTEST_DATA_FILE is required.');
await fs.access(inputJson);
await fs.access(dataFile);
await fs.mkdir(outputDir, {recursive:true});
const report=JSON.parse(await fs.readFile(inputJson,'utf8'));
const bars=await loadBacktestM5FromFile(dataFile);
if(!Array.isArray(bars)||bars.length<1000) throw new Error('Insufficient M5 rows for execution audit.');
const events=report.events;
if(!Array.isArray(events)||events.length!==Number(report.counts?.analyzed_events)) {
  throw new Error('Expanded SELL event count does not reconcile.');
}

const baseCosts={name:'baseline',spread:0.50,slippage:0.05};
const conservativeCosts={name:'conservative',spread:0.75,slippage:0.10};
const costs=[baseCosts,conservativeCosts];
const MIN_GAP_SECONDS=900;
const MAX_HOLD_BARS=Number(process.env.GOLD_BACKTEST_MAX_HOLD_BARS||96);
const MIN_STOP_ATR=Number(process.env.GOLD_MIN_STOP_ATR||0.8);
const MAX_STOP_ATR=Number(process.env.GOLD_MAX_STOP_ATR||2.0);


function median(values) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function avg(values) {
  const a=values.filter(Number.isFinite);
  return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
}
function pct(a,b) { return b?a/b*100:null; }
function finite(x) { return x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null; }
function quantiles(values) {
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return {n:0,min:null,p10:null,p25:null,p50:null,p75:null,p90:null,max:null,mean:null};
  const q=p=>a[Math.min(a.length-1,Math.floor((a.length-1)*p))];
  return {n:a.length,min:a[0],p10:q(.1),p25:q(.25),p50:q(.5),p75:q(.75),p90:q(.9),max:a[a.length-1],mean:avg(a)};
}
function eventPriceFill(e, cost) {
  const idx=indexByTime.get(e.signal_time+300);
  if(idx===undefined) return null;
  const next=bars[idx];
  const entry=next.open-cost.slippage;
  const stop=e.stop_loss;
  const target=e.take_profit;
  const signalAtr=e.signal_atr;
  const refStopDist=Math.abs(e.signal_close-stop);
  const entryStopDist=Math.abs(entry-stop);
  if(![entry,stop,target,signalAtr,refStopDist,entryStopDist].every(Number.isFinite)||entry<=0||stop<=0||target<=0||refStopDist<=0||entryStopDist<=0) return null;
  return {
    start_index:idx,
    entry,
    stop,
    target,
    signal_atr:signalAtr,
    reference_stop_distance:refStopDist,
    entry_stop_distance:entryStopDist,
    reference_stop_atr:refStopDist/signalAtr,
    entry_stop_atr:entryStopDist/signalAtr,
    effective_rr:Math.abs(target-entry)/entryStopDist,
    entry_gap_atr:Math.abs(next.open-e.signal_close)/signalAtr,
    next_open:next.open,
    next_time:next.time
  };
}
function gapCatalog(bars) {
  const rows=[];
  const pairCounts=new Map();
  for(let i=1;i<bars.length;i++) {
    const delta=bars[i].time-bars[i-1].time;
    if(delta<=MIN_GAP_SECONDS)continue;
    const gap=classifyXmGoldGap(bars[i-1].time,bars[i].time,0);
    pairCounts.set(gap.start_pair,(pairCounts.get(gap.start_pair)||0)+1);
    rows.push({
      previous_bar_time:bars[i-1].time,
      previous_bar_time_utc:new Date(bars[i-1].time*1000).toISOString(),
      next_bar_time:bars[i].time,
      next_bar_time_utc:new Date(bars[i].time*1000).toISOString(),
      ...gap
    });
  }
  for(const g of rows) {
    Object.assign(g,classifyXmGoldGap(
      g.previous_bar_time,g.next_bar_time,pairCounts.get(g.start_pair)||0
    ));
  }
  return {rows,pairCounts};
}
const gapInfo=gapCatalog(bars);
const gapByPreviousTime=new Map(gapInfo.rows.map(g=>[g.previous_bar_time,g]));
const indexByTime=new Map(bars.map((b,i)=>[b.time,i]));
const gapDurationCounts=new Map();
for(const g of gapInfo.rows) {
  const k=g.classification+'|'+g.start_pair;
  const z=gapDurationCounts.get(k)||{classification:g.classification,start_pair:g.start_pair,n:0,delta_seconds:[],minutes_missing:[]};
  z.n++;z.delta_seconds.push(g.delta_seconds);z.minutes_missing.push(g.minutes_missing);
  gapDurationCounts.set(k,z);
}
const gapSummary=[...gapDurationCounts.values()].map(g=>({
  classification:g.classification,start_pair:g.start_pair,count:g.n,
  delta_seconds:quantiles(g.delta_seconds),minutes_missing:quantiles(g.minutes_missing)
})).sort((a,b)=>b.count-a.count);

function simulate(e,cost,mode) {
  const entryInfo=eventPriceFill(e,cost);
  if(!entryInfo) return {reason:'INVALID_GEOMETRY',net_R:null,diagnostic:'missing entry bar or zero/invalid stop geometry'};
  const {start_index,entry,stop,target,entry_stop_distance,signal_atr}=entryInfo;
  const scan=bars.slice(start_index,Math.min(bars.length,start_index+MAX_HOLD_BARS));
  let previous=null,firstGap=null,exit=null;
  for(let ix=0;ix<scan.length;ix++) {
    const b=scan[ix];
    if(previous) {
      const delta=b.time-previous.time;
      if(delta>MIN_GAP_SECONDS) {
        const gap=gapByPreviousTime.get(previous.time)||{
          previous_bar_time:previous.time,next_bar_time:b.time,delta_seconds:delta,classification:'unclassified_gap',
          start_pair:hourMinuteUtc(previous.time+300)+'>'+hourMinuteUtc(b.time)
        };
        if(!firstGap) firstGap=gap;
        if(mode==='force_close_on_gap') {
          exit={reason:'DATA_GAP_CLOSE_PREV',time:previous.time,price:entry>stop?previous.close+cost.spread+cost.slippage:previous.close+cost.spread+cost.slippage,gap};
          break;
        }
        if(mode==='censor_on_unclassified_gap' && UNVERIFIED_XM_GAP_CLASSES.has(gap.classification)) {
          exit={reason:'CENSORED_UNVERIFIED_SESSION_GAP',time:previous.time,price:null,gap};
          break;
        }
        // Hold-across-gap stress model: check the first available price for a barrier crossing.
        // Adverse stop gaps fill at the first observed open plus spread/slippage; target gaps
        // are conservatively filled at the target, not improved to the open.
        const openWithSpread=b.open+cost.spread;
        if(openWithSpread>=stop) {
          exit={reason:'STOP_GAP_ADVERSE_FILL',time:b.time,price:b.open+cost.spread+cost.slippage,gap};
          break;
        }
        if(openWithSpread<=target) {
          exit={reason:'TARGET_GAP_AT_LIMIT',time:b.time,price:target+cost.spread+cost.slippage,gap};
          break;
        }
      }
    }
    // OHLC cannot identify intrabar order when both barriers are touched; stop-first is conservative.
    const stopHit=b.high+cost.spread>=stop;
    const targetHit=b.low+cost.spread<=target;
    if(stopHit) {
      exit={reason:'STOP',time:b.time,price:stop+cost.spread+cost.slippage,gap:null};
      break;
    }
    if(targetHit) {
      exit={reason:'TARGET',time:b.time,price:target+cost.spread+cost.slippage,gap:null};
      break;
    }
    previous=b;
  }
  if(!exit) {
    const last=scan[scan.length-1];
    if(!last)return {reason:'NO_FORWARD_BARS',net_R:null,entry_info:entryInfo};
    exit={reason:'TIME',time:last.time,price:last.close+cost.spread+cost.slippage,gap:null};
  }
  const netR=exit.price===null?null:(entry-exit.price)/entry_stop_distance;
  return {
    reason:exit.reason,
    exit_time_utc:new Date(exit.time*1000).toISOString(),
    net_R:netR,
    first_gap: firstGap ? {
      classification:firstGap.classification,
      start_pair:firstGap.start_pair,
      gap_start_utc:firstGap.gap_start_utc,
      next_bar_time_utc:firstGap.next_bar_time_utc,
      gap_minutes:firstGap.minutes_missing,
      delta_seconds:firstGap.delta_seconds,
      pair_frequency:firstGap.pair_frequency
    } : null,
    entry_info:entryInfo
  };
}
function bucketGeometry(stopAtr) {
  if(stopAtr<0.8)return '<0.80';
  if(stopAtr<1.2)return '0.80–1.19';
  if(stopAtr<1.6)return '1.20–1.59';
  if(stopAtr<=2.0)return '1.60–2.00';
  return '>2.00';
}
function describe(rows) {
  const values=rows.map(x=>x.net_R).filter(Number.isFinite);
  const wins=values.filter(x=>x>0),losses=values.filter(x=>x<0);
  return {
    n:rows.length,n_outcomes:values.length,wins:wins.length,losses:losses.length,
    mean_R:avg(values),median_R:median(values),
    profit_factor:Math.abs(losses.reduce((s,x)=>s+x,0))?wins.reduce((s,x)=>s+x,0)/Math.abs(losses.reduce((s,x)=>s+x,0)):(wins.length?null:0)
  };
}
function group(rows,keyFn,valueFn) {
  const m=new Map();
  for(const row of rows) {
    const key=keyFn(row);
    if(!m.has(key))m.set(key,[]);
    m.get(key).push(row);
  }
  return [...m.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).map(([key,items])=>({group:key,...valueFn(items)}));
}

const perCost={};
const flat=[];
for(const cost of costs) {
  const cases=events.map(e=>{
    const p=eventPriceFill(e,cost);
    if(!p)return {signal_time_utc:e.signal_time_utc,year_utc:e.year_utc,hour_utc:e.hour_utc,side:'SELL',cost_scenario:cost.name,geometry_valid:false};
    const refAtr=p.reference_stop_atr;
    const storedAtr=finite(e.stop_atr);
    const expectedEff=p.effective_rr;
    const storedRR=finite(e.effective_rr);
    const geometry={
      stop_atr_ref:p.reference_stop_atr,
      stop_atr_entry:p.entry_stop_atr,
      stop_distance_ref:p.reference_stop_distance,
      stop_distance_entry:p.entry_stop_distance,
      effective_rr_recomputed:expectedEff,
      effective_rr_stored:storedRR,
      stop_atr_difference_vs_stored:storedAtr===null?null:refAtr-storedAtr,
      effective_rr_difference_vs_stored:storedRR===null?null:expectedEff-storedRR,
      stop_distance_gate_pass:refAtr>=MIN_STOP_ATR&&refAtr<=MAX_STOP_ATR,
      effective_rr_gate_pass:expectedEff>=1.5,
      entry_gap_atr:p.entry_gap_atr
    };
    const current=simulate(e,cost,'force_close_on_gap');
    const hold=simulate(e,cost,'hold_across_gap');
    const censor=simulate(e,cost,'censor_on_unclassified_gap');
    const gap=current.first_gap||hold.first_gap||censor.first_gap;
    const row={
      cost_scenario:cost.name,
      signal_time_utc:e.signal_time_utc,year_utc:e.year_utc,hour_utc:e.hour_utc,
      h1_rsi14:e.h1_rsi14,h1_close_vs_ema20_atr:e.h1_close_vs_ema20_atr,
      h1_ema20_vs_ema50_atr:e.h1_ema20_vs_ema50_atr,h1_ema50_vs_ema200_atr:e.h1_ema50_vs_ema200_atr,
      strict_bear_stack:e.strict_bear_stack,
      m5_rsi14:e.m5_rsi14,
      range_atr:e.range_atr,breakout_atr:e.breakout_atr,body_atr:e.body_atr,bearish_body_atr:e.bearish_body_atr,
      volume_ratio:e.volume_ratio,close_location:e.close_location,extension_atr:e.extension_atr,
      ...geometry,
      existing_isolated_reason:e.isolated_barrier_outcome?.reason??null,
      existing_isolated_net_R:finite(e.isolated_barrier_outcome?.net_R),
      force_close_reason:current.reason,force_close_net_R:current.net_R,
      hold_gap_aware_reason:hold.reason,hold_gap_aware_net_R:hold.net_R,
      censor_irregular_gap_reason:censor.reason,censor_irregular_gap_net_R:censor.net_R,
      first_gap_classification:gap?.classification??null,
      first_gap_pair:gap?.start_pair??null,
      first_gap_missing_minutes:gap?.minutes_missing??null,
      first_gap_pair_frequency:gap?.pair_frequency??null,
      first_gap_next_bar_time_utc:gap?.next_bar_time_utc??null
    };
    flat.push(row);
    return row;
  }).filter(r=>r.geometry_valid!==false);
  const geometryRows=cases.map((r,i)=>({...r,stop_bucket:bucketGeometry(r.stop_atr_ref)}));
  const validCurrent=geometryRows.filter(r=>Number.isFinite(r.force_close_net_R));
  const validHold=geometryRows.filter(r=>Number.isFinite(r.hold_gap_aware_net_R));
  const validCensor=geometryRows.filter(r=>Number.isFinite(r.censor_irregular_gap_net_R));
  const discrepancies={
    reference_stop_atr_max_abs:Math.max(0,...geometryRows.map(r=>Math.abs(r.stop_atr_difference_vs_stored??0))),
    effective_rr_max_abs_for_baseline_source:Math.max(0,...geometryRows.map(r=>cost.name==='baseline'?Math.abs(r.effective_rr_difference_vs_stored??0):0)),
    primary_gap_policy_reason_mismatches:geometryRows.filter(r=>r.censor_irregular_gap_reason!==r.existing_isolated_reason).length,
    primary_net_R_max_abs_difference:Math.max(0,...geometryRows.map(r=>Math.abs((r.existing_isolated_net_R??0)-(r.censor_irregular_gap_net_R??0))))
  };
  perCost[cost.name]={
    costs:{spread:cost.spread,slippage:cost.slippage},
    event_count:cases.length,
    outcomes:{
      primary_censored_unverified_gap_count:cases.filter(r=>r.existing_isolated_reason==='CENSORED_UNVERIFIED_SESSION_GAP').length,
      force_close_on_gap:describe(validCurrent.map(r=>({net_R:r.force_close_net_R}))),
      hold_gap_aware:describe(validHold.map(r=>({net_R:r.hold_gap_aware_net_R}))),
      censor_irregular_gap:describe(validCensor.map(r=>({net_R:r.censor_irregular_gap_net_R})))
    },
    outcome_reason_counts:{
      force_close_on_gap:Object.fromEntries([...new Set(cases.map(r=>r.force_close_reason))].sort().map(k=>[k,cases.filter(r=>r.force_close_reason===k).length])),
      hold_gap_aware:Object.fromEntries([...new Set(cases.map(r=>r.hold_gap_aware_reason))].sort().map(k=>[k,cases.filter(r=>r.hold_gap_aware_reason===k).length])),
      censor_irregular_gap:Object.fromEntries([...new Set(cases.map(r=>r.censor_irregular_gap_reason))].sort().map(k=>[k,cases.filter(r=>r.censor_irregular_gap_reason===k).length]))
    },
    outcomes_by_first_gap_classification:group(cases.filter(r=>r.first_gap_classification),r=>r.first_gap_classification,items=>({
      n:items.length,
      force_close:describe(items.filter(r=>Number.isFinite(r.force_close_net_R)).map(r=>({net_R:r.force_close_net_R}))),
      hold_gap_aware:describe(items.filter(r=>Number.isFinite(r.hold_gap_aware_net_R)).map(r=>({net_R:r.hold_gap_aware_net_R}))),
      censor_irregular_gap:describe(items.filter(r=>Number.isFinite(r.censor_irregular_gap_net_R)).map(r=>({net_R:r.censor_irregular_gap_net_R})))
    })),
    geometry_distribution:group(geometryRows,r=>r.stop_bucket,items=>({
      n:items.length,passes_stop_gate:items.filter(r=>r.stop_distance_gate_pass).length,
      mean_effective_rr:avg(items.map(r=>r.effective_rr_recomputed)),
      pass_rr_150:items.filter(r=>r.effective_rr_gate_pass).length,
      mean_force_close_R:avg(items.map(r=>r.force_close_net_R).filter(Number.isFinite)),
      mean_hold_gap_aware_R:avg(items.map(r=>r.hold_gap_aware_net_R).filter(Number.isFinite))
    })),
    geometry_gate_counts:{
      stop_distance_pass:geometryRows.filter(r=>r.stop_distance_gate_pass).length,
      effective_rr_pass:geometryRows.filter(r=>r.effective_rr_gate_pass).length,
      entry_gap_pass:geometryRows.filter(r=>r.entry_gap_atr<=0.5).length,
      approximate_all_entry_gates:geometryRows.filter(r=>r.stop_distance_gate_pass&&r.effective_rr_gate_pass&&r.entry_gap_atr<=0.5&&r.breakout_atr>=0.1&&r.body_atr>=0.4&&r.volume_ratio>=1.1&&r.close_location<=0.35&&r.m5_rsi14>=25&&r.m5_rsi14<=48&&r.extension_atr<=1.5).length,
      strict_h1_plus_approximate_all_entry_gates:geometryRows.filter(r=>r.strict_bear_stack&&r.stop_distance_gate_pass&&r.effective_rr_gate_pass&&r.entry_gap_atr<=0.5&&r.breakout_atr>=0.1&&r.body_atr>=0.4&&r.volume_ratio>=1.1&&r.close_location<=0.35&&r.m5_rsi14>=25&&r.m5_rsi14<=48&&r.extension_atr<=1.5).length
    },
    annual:group(geometryRows,r=>r.year_utc,items=>({
      n:items.length,
      primary_censored_unverified_gap:items.filter(r=>r.existing_isolated_reason==='CENSORED_UNVERIFIED_SESSION_GAP').length,
      force_close:describe(items.filter(r=>Number.isFinite(r.force_close_net_R)).map(r=>({net_R:r.force_close_net_R}))),
      hold_gap_aware:describe(items.filter(r=>Number.isFinite(r.hold_gap_aware_net_R)).map(r=>({net_R:r.hold_gap_aware_net_R})))
    })),
    geometry_integrity:{
      maximum_abs_reference_stop_atr_difference:discrepancies.reference_stop_atr_max_abs,
      maximum_abs_effective_rr_difference_against_baseline_stored:discrepancies.effective_rr_max_abs_for_baseline_source,
      primary_gap_policy_reason_mismatches:cost.name==='baseline'?discrepancies.primary_gap_policy_reason_mismatches:null,
      primary_net_R_max_abs_difference:cost.name==='baseline'?discrepancies.primary_net_R_max_abs_difference:null,
      all_stop_distances_recomputed_from_signal_close_and_stop:geometryRows.every(r=>Math.abs(r.stop_atr_ref-Math.abs((events.find(e=>e.signal_time_utc===r.signal_time_utc)?.signal_close??0)-(events.find(e=>e.signal_time_utc===r.signal_time_utc)?.stop_loss??0))/(events.find(e=>e.signal_time_utc===r.signal_time_utc)?.signal_atr??1))<1e-8)
    }
  };
}

const gaps=gapInfo.rows;
const result={
  generated_at:new Date().toISOString(),
  research_only:true,
  production_settings_changed:false,
  instrument:'XAUUSD',
  source_period:{start:new Date(bars[0].time*1000).toISOString(),end:new Date((bars[bars.length-1].time+300)*1000).toISOString()},
  bars:bars.length,
  audit_scope:'Stop-distance geometry and gap handling for the 1,897 historical first-break SELL events. Results are isolated per-event counterfactuals, not a non-overlapping portfolio.',
  assumptions:{minimum_gap_trigger_seconds:MIN_GAP_SECONDS,maximum_hold_bars:MAX_HOLD_BARS,min_stop_atr:MIN_STOP_ATR,max_stop_atr:MAX_STOP_ATR,costs:costs},
  gap_catalog:{
    total_gaps_over_15m:gaps.length,
    classifications:Object.fromEntries([...new Set(gaps.map(g=>g.classification))].sort().map(k=>[k,gaps.filter(g=>g.classification===k).length])),
    common_pairs:gapSummary.slice(0,80),
    examples:gaps.filter(g=>g.classification==='scheduled_daily_maintenance').slice(0,30),
    xm_regular_session:{
      symbol:'GOLD / XAUUSD on MT4 (legacy regular session; not GOLD24-7)',
      summer_japan:'07:02 to 05:58 next day, Monday-Friday',
      winter_japan:'08:02 to 06:58 next day, Monday-Friday',
      server_timezone:'Europe/Nicosia seasonal offset: GMT+3 summer, GMT+2 winter',
      daily_break_server:'23:58 close to 01:02 reopen',
      derived_utc_daily_break_summer:'about 20:58 to 22:02 UTC; M5 labels commonly 20:55 then 22:00',
      derived_utc_daily_break_winter:'about 21:58 to 23:02 UTC; M5 labels commonly 21:55 then 23:00',
      weekly_closure:'Friday close to Sunday reopen; about 49 hours',
      sources:['https://fxplus.xmtrading.com/media/2025110701.html','https://fxplus.xmtrading.com/trading-hours/','https://fxplus.xmtrading.com/news/n2026100101.html','https://fxplus.xmtrading.com/news/n2026091801.html']
    },
    holiday_calendar_check:{
      checked_at_utc:'2026-10-15',
      october_notice_date:'2026-10-01',
      october_notice_gold_specific_change_found:false,
      november_2026_notice_found:false,
      note:'No GOLD-specific October schedule change was visible in the published/indexed XM October bulletin. This does not rule out exceptional interruptions; use the dated XM notice for each future month.'
    },
    note:'Confirmed daily maintenance and normal Friday-to-Sunday closures are expected market closures, not feed failures. Unpublished long closures, DST-transition mismatches, and non-recurring gaps are unverified and are censored in the primary event-study model rather than priced at the prior close.'
  },
  costs:perCost,
  holdout_warning:'The five-year price sample and its recent windows have already been examined in prior reports. Annual/late-period results here are retrospective audits, not an untouched OOS test. A genuinely untouched holdout must use data not used for these prior hypotheses or a pre-registered prospective window.',
  interpretation_limits:[
    'XM regular GOLD session hours confirm a roughly 64-minute daily break plus a roughly 49-hour Friday-to-Sunday closure. These are scheduled trading pauses, not data-feed outages.',
    'A position cannot be assumed closed at the previous M5 close merely because a gap is visible afterward. The gap-aware hold model is primary for scheduled pauses and checks stop/target gaps at the first observed reopen price.',
    'A holiday extension, DST-transition anomaly, or other gap without a matching documented XM session window is unverified: censor its primary event outcome and record it for calendar review.',
    'The 2026-10-01 official October holiday notice had no GOLD-specific schedule change visible in the published/indexed list; as of 2026-10-15 a November 2026 holiday-hours notice was not found. This is not a guarantee against exceptional outages.',
    'GOLD24-7 is a separate product announced for MT5; its weekend session must not be applied to the current MT4 GOLD/XAUUSD model.',
    'The hold-across-gap sensitivity handles an adverse SELL open beyond stop at the next observed open; target gaps are conservatively filled at the target. Intra-bar sequencing is still unknown.',
    'Censoring unverified gaps removes outcomes where the path cannot be responsibly inferred; its sample differs by design.',
    'All event outcomes are isolated and may overlap; their aggregate is not portfolio PF, expectancy, drawdown or a trading track record.',
    'The approximate all-gates count is a diagnostic proxy. The exact strategy engine remains authoritative for executable trade counts.'
  ]
};
if(!result.costs.baseline.geometry_integrity.all_stop_distances_recomputed_from_signal_close_and_stop) {
  throw new Error('Stop-distance geometry integrity check failed.');
}
if(result.costs.baseline.geometry_integrity.maximum_abs_reference_stop_atr_difference>1e-7) {
  throw new Error('Stored stop_atr does not reconcile with signal-close-to-stop geometry.');
}
if(result.costs.baseline.geometry_integrity.primary_gap_policy_reason_mismatches!==0) {
  throw new Error('Reconstructed XM-session-aware primary gap reasons do not match stored event outcomes.');
}
if(result.costs.baseline.geometry_integrity.primary_net_R_max_abs_difference>1e-7) {
  throw new Error('Reconstructed XM-session-aware primary net R does not match stored event outcomes.');
}
await fs.writeFile(path.join(outputDir,'gold_v2_sell_execution_geometry_gap_audit.json'),JSON.stringify(result,null,2));

const csvFields=Object.keys(flat[0]||{});
const esc=v=>{
  if(v===null||v===undefined)return '';
  const s=typeof v==='object'?JSON.stringify(v):String(v);
  return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
};
await fs.writeFile(path.join(outputDir,'gold_v2_sell_execution_geometry_gap_events.csv'),
  [csvFields.join(','),...flat.map(row=>csvFields.map(k=>esc(row[k])).join(','))].join('\n')+'\n');

const f=x=>x===null||x===undefined||!Number.isFinite(Number(x))?'—':Number(x).toFixed(3);
const md=[
  '# GOLD SELL stop-distance geometry and data-gap audit',
  '',
  '**Research only. No production settings changed.**',
  '',
  '## Main question',
  '',
  'XMTrading’s normal GOLD MT4 schedule confirms a recurring ~64-minute daily maintenance break and a ~49-hour Friday-to-Sunday closure. A previous-close exit inferred only after observing a gap is not the primary execution assumption. This audit compares (1) legacy prior-close exit as a sensitivity, (2) gap-aware holding across confirmed schedule windows, and (3) censoring gaps not explained by the published session or a dated holiday-calendar override.',
  '',
  'The event universe contains '+events.length+' isolated SELL events; those events can overlap and do not form a portfolio.',
  '',
  '## Timestamp-gap classification',
  '',
  '| Classification | Count |',
  '|---|---:|',
  ...Object.entries(result.gap_catalog.classifications).map(([k,v])=>'| '+k+' | '+v+' |'),
  '',
  '| Repeated time-pair (gap begins after prior M5 bar) | Count | Missing minutes min | median | max |',
  '|---|---:|---:|---:|---:|',
  ...gapSummary.slice(0,30).map(g=>'| '+g.start_pair+' ('+g.classification+') | '+g.count+' | '+f(g.minutes_missing.min)+' | '+f(g.minutes_missing.p50)+' | '+f(g.minutes_missing.max)+' |'),
  '',
  'Daily maintenance labels are matched against XMTrading’s published regular GOLD hours and Europe/Nicosia GMT+3/GMT+2 offset. Normal Friday-to-Sunday closures are identified by the observed weekday pattern and ~49-hour duration. Longer/irregular gaps remain unverified unless the dated XM holiday bulletin documents them.',
  '',
  '## Execution outcome sensitivity by cost assumption',
  '',
  '| Cost | Gap model | Outcomes n | Mean R | Median R | PF (isolated events) |',
  '|---|---|---:|---:|---:|---:|'
];
for(const [costName,costResult] of Object.entries(perCost)){
  for(const model of ['force_close_on_gap','hold_gap_aware','censor_irregular_gap']){
    const x=costResult.outcomes[model];
    md.push('| '+costName+' | '+model+' | '+x.n_outcomes+' | '+f(x.mean_R)+' | '+f(x.median_R)+' | '+f(x.profit_factor)+' |');
  }
}
md.push(
  '',
  '## Stop distance from signal close to stop level (ATR units)',
  '',
  '| Reference stop distance | Events | Pass 0.8–2.0 ATR gate | Mean effective RR | Mean forced-close R | Mean gap-aware R |',
  '|---|---:|---:|---:|---:|---:|'
);
for(const [costName,costResult] of Object.entries(perCost)){
  md.push('', '### '+costName+' costs', '');
  for(const g of costResult.geometry_distribution){
    md.push('| '+g.group+' | '+g.n+' | '+g.passes_stop_gate+' | '+f(g.mean_effective_rr)+' | '+f(g.mean_force_close_R)+' | '+f(g.mean_hold_gap_aware_R)+' |');
  }
}
md.push(
  '',
  '## Isolated outcomes by first gap class',
  '',
  '| Cost | First gap class | Events | Forced-close mean R | Gap-aware mean R | Censor-irregular mean R |',
  '|---|---|---:|---:|---:|---:|'
);
for(const [costName,costResult] of Object.entries(perCost)){
  for(const g of costResult.outcomes_by_first_gap_classification){
    md.push('| '+costName+' | '+g.group+' | '+g.n+' | '+f(g.force_close.mean_R)+' | '+f(g.hold_gap_aware.mean_R)+' | '+f(g.censor_irregular_gap.mean_R)+' |');
  }
}
md.push(
  '',
  '## Execution geometry interpretation',
  '',
  'The official strategy stop-distance gate is checked against the signal close, not the next-bar entry fill. The audit separately records reference stop distance and entry-fill stop distance, then recomputes effective RR using the modeled entry. They are related but are not interchangeable.',
  '',
  'Primary gap premise: maintain an open simulated position across the confirmed daily maintenance break and normal weekend closure; test stop/target against the next observed open using spread/slippage. Do not infer that the position closed at the previous candle close. For any gap not explained by the published regular session or a dated XM calendar override, censor the primary event outcome until the gap is resolved.',
  '',
  '## Holdout status and guardrails',
  '',
  result.holdout_warning,
  '',
  '- The annual and recent-period values are not a fresh holdout; do not use them to choose thresholds.',
  '- Stop-first intrabar assumptions remain necessary with M5 OHLC and cannot reveal the true order when both barriers are touched in one candle.',
  '- Cost-scenario results and gap-treatment results are isolated-event diagnostics, not tradable strategy performance.',
  '- Before any strategy change, validate preregistered hypotheses on a new untouched period, using actual broker-session knowledge and conservative costs.',
  ''
);
await fs.writeFile(path.join(outputDir,'gold_v2_sell_execution_geometry_gap_audit.md'),md.join('\n'));

console.log('GOLD V2 SELL EXECUTION AUDIT PASS',JSON.stringify({
  events:events.length,
  m5_bars:bars.length,
  gaps_over_15m:gaps.length,
  gap_classifications:result.gap_catalog.classifications,
  outputs:[
    path.join(outputDir,'gold_v2_sell_execution_geometry_gap_audit.json'),
    path.join(outputDir,'gold_v2_sell_execution_geometry_gap_events.csv'),
    path.join(outputDir,'gold_v2_sell_execution_geometry_gap_audit.md')
  ]
}));
