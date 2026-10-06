import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.resolve(process.env.GOLD_BACKTEST_DATA_FILE || path.join(ROOT, 'gold-xauusd-data', 'xauusd-m5.json.gz'));
const OUTPUT_DIR = path.resolve(process.env.GOLD_V4_WALKFORWARD_OUTPUT_DIR || path.join(ROOT, 'gold-v4-walkforward-output'));

const VARIANTS = [
  { name:'baseline', rangeLookback:12, minRangeAtr:.60, maxRangeAtr:2.40, breakoutAtr:.10, breakoutBodyAtr:.45, breakoutCloseLocation:.70, breakoutVolumeRatio:1.15, maxRetestBars:4, retestToleranceAtr:.20, maxRetestDepthAtr:.35, retestBodyAtr:.15, retestCloseLocation:.60, confirmationBufferAtr:.05, maxExtensionAtr:1.30, sessionStart:7, sessionEnd:20 },
  { name:'strict', rangeLookback:12, minRangeAtr:.70, maxRangeAtr:2.20, breakoutAtr:.15, breakoutBodyAtr:.50, breakoutCloseLocation:.75, breakoutVolumeRatio:1.25, maxRetestBars:3, retestToleranceAtr:.15, maxRetestDepthAtr:.25, retestBodyAtr:.20, retestCloseLocation:.65, confirmationBufferAtr:.05, maxExtensionAtr:1.10, sessionStart:7, sessionEnd:17 },
  { name:'balanced_ny', rangeLookback:12, minRangeAtr:.60, maxRangeAtr:2.40, breakoutAtr:.10, breakoutBodyAtr:.45, breakoutCloseLocation:.70, breakoutVolumeRatio:1.15, maxRetestBars:4, retestToleranceAtr:.20, maxRetestDepthAtr:.35, retestBodyAtr:.15, retestCloseLocation:.60, confirmationBufferAtr:.05, maxExtensionAtr:1.30, sessionStart:12, sessionEnd:20 },
  { name:'patient', rangeLookback:18, minRangeAtr:.50, maxRangeAtr:2.80, breakoutAtr:.15, breakoutBodyAtr:.50, breakoutCloseLocation:.75, breakoutVolumeRatio:1.20, maxRetestBars:5, retestToleranceAtr:.25, maxRetestDepthAtr:.40, retestBodyAtr:.15, retestCloseLocation:.60, confirmationBufferAtr:.05, maxExtensionAtr:1.20, sessionStart:7, sessionEnd:20 }
];

const IS_DAYS = 1095;
const OOS_DAYS = 730;
const IS_WARMUP_DAYS = 120;
const OOS_WARMUP_DAYS = 760;
const MIN_IS_TRADES = 20;
const MIN_IS_PF = 1.05;
const MIN_IS_EXPECTANCY_R = 0.05;
const MAX_IS_DD = 5;
const MIN_IS_POSITIVE_YEARS = 2;

async function loadBars() {
  const bytes = await fs.readFile(DATA_FILE);
  const parsed = JSON.parse(DATA_FILE.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
  if (!Array.isArray(parsed) || parsed.length < 200000) throw new Error('Invalid prepared GOLD V4 dataset');
  return parsed.map((b) => ({
    time:Number(b.time), open:Number(b.open), high:Number(b.high), low:Number(b.low), close:Number(b.close), volume:Number(b.volume)||0
  })).sort((a,b)=>a.time-b.time);
}

async function writeSlice(file, bars, start, end) {
  const rows=bars.filter((b)=>b.time>=start && b.time<=end);
  if(rows.length<100000) throw new Error('Walk-forward slice too small: '+rows.length);
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,gzipSync(JSON.stringify(rows),{level:6}));
  return rows.length;
}

function envFor(v) {
  return {
    GOLD_BACKTEST_INITIAL_EQUITY:'100000',
    GOLD_BACKTEST_RISK_PCT:'0.25',
    GOLD_BACKTEST_SPREAD_PRICE:'0.50',
    GOLD_BACKTEST_SLIPPAGE_PRICE:'0.05',
    GOLD_BACKTEST_MAX_DAILY_LOSS_PCT:'2',
    GOLD_BACKTEST_MAX_DRAWDOWN_PCT:'5',
    GOLD_BACKTEST_MAX_HOLD_BARS:'96',
    GOLD_BACKTEST_MAX_ENTRY_GAP_ATR:'0.50',
    GOLD_BACKTEST_MIN_EFFECTIVE_RR:'1.50',
    GOLD_RANGE_LOOKBACK:String(v.rangeLookback),
    GOLD_MIN_RANGE_ATR:String(v.minRangeAtr),
    GOLD_MAX_RANGE_ATR:String(v.maxRangeAtr),
    GOLD_BREAKOUT_ATR:String(v.breakoutAtr),
    GOLD_BREAKOUT_BODY_ATR:String(v.breakoutBodyAtr),
    GOLD_BREAKOUT_CLOSE_LOCATION:String(v.breakoutCloseLocation),
    GOLD_BREAKOUT_VOLUME_RATIO:String(v.breakoutVolumeRatio),
    GOLD_MAX_RETEST_BARS:String(v.maxRetestBars),
    GOLD_RETEST_TOLERANCE_ATR:String(v.retestToleranceAtr),
    GOLD_MAX_RETEST_DEPTH_ATR:String(v.maxRetestDepthAtr),
    GOLD_RETEST_BODY_ATR:String(v.retestBodyAtr),
    GOLD_RETEST_CLOSE_LOCATION:String(v.retestCloseLocation),
    GOLD_CONFIRMATION_BUFFER_ATR:String(v.confirmationBufferAtr),
    GOLD_MAX_EXTENSION_ATR:String(v.maxExtensionAtr),
    GOLD_SESSION_START_UTC:String(v.sessionStart),
    GOLD_SESSION_END_UTC:String(v.sessionEnd)
  };
}

async function runVariant(file, days, v, label) {
  const out=path.join(OUTPUT_DIR,label);
  await fs.mkdir(out,{recursive:true});
  const env={...process.env,...envFor(v),GOLD_BACKTEST_LOOKBACK_DAYS:String(days),GOLD_BACKTEST_DATA_FILE:file,GOLD_BACKTEST_OUTPUT_DIR:out};
  execFileSync(process.execPath,[path.join(ROOT,'scripts','backtest-gold-v4.mjs')],{cwd:ROOT,env,stdio:'pipe'});
  return JSON.parse(await fs.readFile(path.join(out,'gold_v4_backtest_report.json'),'utf8'));
}

function selectWinner(rows) {
  const eligible=rows.map((row)=>{
    const r=row.report.results?.conservative;
    if(!r) return {...row,eligible:false,reasons:['missing_conservative'],score:-Infinity};
    const s=r.summary;
    const reasons=[];
    if(s.trades<MIN_IS_TRADES) reasons.push('insufficient_trades');
    if(!Number.isFinite(s.profit_factor)||s.profit_factor<MIN_IS_PF) reasons.push('profit_factor');
    if(!Number.isFinite(s.expectancy_R)||s.expectancy_R<MIN_IS_EXPECTANCY_R) reasons.push('expectancy_R');
    if(!Number.isFinite(s.max_drawdown_pct)||s.max_drawdown_pct>MAX_IS_DD) reasons.push('max_drawdown');
    if(r.positiveYears<MIN_IS_POSITIVE_YEARS) reasons.push('positive_years');
    const eligibleFlag=reasons.length===0;
    return {
      ...row,
      eligible:eligibleFlag,
      reasons,
      score:eligibleFlag
        ? (r.qualityGate?.passed?100000:0)+s.profit_factor*100+s.expectancy_R*10-s.max_drawdown_pct
        : -Infinity
    };
  }).filter((x)=>x.eligible).sort((a,b)=>b.score-a.score);
  return eligible[0]||null;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  const bars=await loadBars();
  const latest=bars.at(-1).time;
  const oosStart=latest-OOS_DAYS*86400;
  const isStart=oosStart-IS_DAYS*86400;
  const isFile=path.join(OUTPUT_DIR,'is_data.json.gz');
  const oosFile=path.join(OUTPUT_DIR,'oos_data.json.gz');
  const isBars=await writeSlice(isFile,bars,isStart-IS_WARMUP_DAYS*86400,oosStart-1);
  const oosBars=await writeSlice(oosFile,bars,oosStart-OOS_WARMUP_DAYS*86400,latest+300);

  const inSample=[];
  for(const variant of VARIANTS) {
    const report=await runVariant(isFile,IS_DAYS,variant,'is-'+variant.name);
    inSample.push({variant:variant.name,report,conservative:report.results?.conservative?.summary??null});
  }

  const winner=selectWinner(inSample);
  let outOfSample=null;
  if(winner) {
    const variant=VARIANTS.find((v)=>v.name===winner.variant);
    const report=await runVariant(oosFile,OOS_DAYS,variant,'oos-selected-'+winner.variant);
    outOfSample={variant:winner.variant,report};
  }

  const result={
    version:'GOLD_V4',
    methodology:'fixed 3-year IS selection followed by fixed 2-year OOS validation',
    no_oos_tuning:true,
    source_data:{
      file:DATA_FILE,
      latest_utc:new Date((latest+300)*1000).toISOString(),
      is_start_utc:new Date(isStart*1000).toISOString(),
      is_end_utc:new Date((oosStart-1)*1000).toISOString(),
      oos_start_utc:new Date(oosStart*1000).toISOString(),
      oos_end_utc:new Date((latest+300)*1000).toISOString(),
      is_bars:isBars,oos_bars:oosBars
    },
    selection_thresholds:{
      min_is_trades:MIN_IS_TRADES,min_is_profit_factor:MIN_IS_PF,min_is_expectancy_R:MIN_IS_EXPECTANCY_R,
      max_is_drawdown_pct:MAX_IS_DD,min_is_positive_years:MIN_IS_POSITIVE_YEARS
    },
    selection_rule:'Eligible only when conservative-cost IS evidence passes all thresholds; among eligible variants prefer conservative quality-gate pass, then PF, then expectancy, then lower DD.',
    in_sample:inSample.map((x)=>({
      variant:x.variant,
      conservative:x.conservative,
      quality_gate:x.report.results?.conservative?.qualityGate??null,
      robust_across_costs:x.report.results?.robustAcrossCosts??false
    })),
    selected_variant:winner?.variant??null,
    out_of_sample:outOfSample?{
      variant:outOfSample.variant,
      conservative:outOfSample.report.results?.conservative??null,
      robust_across_costs:outOfSample.report.results?.robustAcrossCosts??false
    }:null,
    promotion_rule:'Research evidence only. Never enable live orders automatically.'
  };

  await fs.writeFile(path.join(OUTPUT_DIR,'gold_v4_walkforward_report.json'),JSON.stringify(result,null,2),'utf8');
  console.log(JSON.stringify({
    selected_variant:result.selected_variant,
    oos_robust_across_costs:result.out_of_sample?.robust_across_costs??false,
    oos_conservative:result.out_of_sample?.conservative?.summary??null
  },null,2));
}

main().catch((error)=>{console.error(error.stack||error);process.exit(1);});
