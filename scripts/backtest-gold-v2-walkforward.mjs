import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = process.env.GOLD_BACKTEST_DATA_FILE || path.join(ROOT, 'gold-xauusd-data', 'xauusd-m5.json.gz');
const OUTPUT_DIR = process.env.GOLD_WALKFORWARD_OUTPUT_DIR || path.join(ROOT, 'gold-walkforward-output');

const VARIANTS = [
  { name:'baseline', rangeLookback:12, minRangeAtr:.80, maxRangeAtr:2.80, breakoutAtr:.10, bodyAtr:.40, closeLocation:.65, volumeRatio:1.10, sessionStart:7, sessionEnd:20 },
  { name:'strict', rangeLookback:12, minRangeAtr:.80, maxRangeAtr:2.50, breakoutAtr:.15, bodyAtr:.50, closeLocation:.70, volumeRatio:1.25, sessionStart:7, sessionEnd:17 },
  { name:'loose', rangeLookback:18, minRangeAtr:.60, maxRangeAtr:3.50, breakoutAtr:.05, bodyAtr:.30, closeLocation:.60, volumeRatio:1.05, sessionStart:7, sessionEnd:22 },
  { name:'ny_focus', rangeLookback:12, minRangeAtr:.80, maxRangeAtr:2.80, breakoutAtr:.10, bodyAtr:.40, closeLocation:.65, volumeRatio:1.10, sessionStart:12, sessionEnd:20 }
];

async function loadBars(file) {
  const bytes = await fs.readFile(file);
  const parsed = JSON.parse(file.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
  if (!Array.isArray(parsed) || parsed.length < 100000) throw new Error('Invalid/insufficient prepared GOLD data');
  return parsed.map(b => ({
    time:Number(b.time), open:Number(b.open), high:Number(b.high), low:Number(b.low), close:Number(b.close), volume:Number(b.volume)||0
  })).sort((a,b)=>a.time-b.time);
}

async function writeSlice(file, bars, start, end) {
  const slice = bars.filter(b => b.time >= start && b.time <= end);
  if (slice.length < 50000) throw new Error('Slice too small: '+slice.length);
  await fs.mkdir(path.dirname(file), {recursive:true});
  await fs.writeFile(file, gzipSync(JSON.stringify(slice), { level: 6 }));
  return slice.length;
}

function variantEnv(v) {
  return {
    GOLD_RANGE_LOOKBACK:String(v.rangeLookback),
    GOLD_MIN_RANGE_ATR:String(v.minRangeAtr),
    GOLD_MAX_RANGE_ATR:String(v.maxRangeAtr),
    GOLD_BREAKOUT_ATR:String(v.breakoutAtr),
    GOLD_MIN_BODY_ATR:String(v.bodyAtr),
    GOLD_MIN_CLOSE_LOCATION:String(v.closeLocation),
    GOLD_MIN_VOLUME_RATIO:String(v.volumeRatio),
    GOLD_SESSION_START_UTC:String(v.sessionStart),
    GOLD_SESSION_END_UTC:String(v.sessionEnd),
    GOLD_BACKTEST_INITIAL_EQUITY:'100000',
    GOLD_BACKTEST_RISK_PCT:'0.25',
    GOLD_BACKTEST_SPREAD_PRICE:'0.50',
    GOLD_BACKTEST_SLIPPAGE_PRICE:'0.05',
    GOLD_BACKTEST_MAX_DAILY_LOSS_PCT:'2',
    GOLD_BACKTEST_MAX_DRAWDOWN_PCT:'5',
    GOLD_BACKTEST_MAX_HOLD_BARS:'96',
    GOLD_BACKTEST_MAX_ENTRY_GAP_ATR:'0.50'
  };
}

async function runBacktest(sliceFile, days, v, outDir) {
  const env = {...process.env, ...variantEnv(v), GOLD_BACKTEST_DATA_FILE:sliceFile, GOLD_BACKTEST_OUTPUT_DIR:outDir};
  execFileSync(process.execPath, [path.join(ROOT,'scripts','backtest-gold-v2.mjs'), '--lookback-days='+days], {
    cwd:ROOT, env, stdio:'pipe'
  });
  const report = JSON.parse(await fs.readFile(path.join(outDir,'gold_v2_backtest_report.json'),'utf8'));
  return report;
}

function selectIsWinner(reports) {
  const ranked = reports.map(r => {
    const c = r.results?.conservative;
    if (!c) return {...r, selected:false, rankScore:-Infinity};
    const s = c.summary;
    const q = c.qualityGate?.passed ? 1 : 0;
    const enough = s.trades >= 20 ? 1 : 0;
    const pf = Number.isFinite(Number(s.profit_factor)) ? Number(s.profit_factor) : -Infinity;
    const exp = Number.isFinite(Number(s.expectancy_R)) ? Number(s.expectancy_R) : -Infinity;
    const dd = Number(s.max_drawdown_pct);
    const score = q*100000 + enough*10000 + pf*100 + exp*10 - dd;
    return {...r, selected:false, rankScore:score};
  }).sort((a,b)=>b.rankScore-a.rankScore);
  return ranked[0] || null;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  const bars = await loadBars(DATA_FILE);
  const latest = bars[bars.length-1].time;
  const oosDays = 730;
  const isDays = 1095;
  const oosStart = latest - oosDays*86400;
  const isStart = oosStart - isDays*86400;
  const isWarmup = 120*86400;
  const oosWarmup = 760*86400;

  const isFile = path.join(OUTPUT_DIR,'is_data.json.gz');
  const oosFile = path.join(OUTPUT_DIR,'oos_data.json.gz');
  const isBars = await writeSlice(isFile, bars, isStart-isWarmup, oosStart-1);
  const oosBars = await writeSlice(oosFile, bars, oosStart-oosWarmup, latest+300);

  const isReports=[];
  for(const v of VARIANTS){
    const out=path.join(OUTPUT_DIR,'is-'+v.name);
    await fs.mkdir(out,{recursive:true});
    const report=await runBacktest(isFile,isDays,v,out);
    isReports.push({variant:v.name,results:report.results});
  }
  const winner=selectIsWinner(isReports);
  const winnerVariant=VARIANTS.find(v=>v.name===winner?.variant);
  let oos=null;
  if(winnerVariant){
    const out=path.join(OUTPUT_DIR,'oos-selected-'+winnerVariant.name);
    await fs.mkdir(out,{recursive:true});
    const report=await runBacktest(oosFile,oosDays,winnerVariant,out);
    oos={variant:winnerVariant.name,results:report.results};
  }

  const result={
    methodology:'fixed 3-year in-sample selection followed by fixed 2-year out-of-sample evaluation',
    no_oos_tuning:true,
    source_data:{
      file:DATA_FILE,
      latest_utc:new Date(latest*1000).toISOString(),
      is_start_utc:new Date(isStart*1000).toISOString(),
      is_end_utc:new Date((oosStart-1)*1000).toISOString(),
      oos_start_utc:new Date(oosStart*1000).toISOString(),
      oos_end_utc:new Date((latest+300)*1000).toISOString(),
      is_bars:isBars,
      oos_bars:oosBars
    },
    selection_rule:'prefer conservative-cost quality gate pass, then sufficient trades, then PF, then expectancy, then lower max DD',
    in_sample:isReports,
    selected_variant:winner?.variant||null,
    selected_variant_rank_score:winner?.rankScore??null,
    out_of_sample:oos,
    promotion_rule:'OOS result is research evidence only; no automatic live/demo promotion'
  };
  await fs.writeFile(path.join(OUTPUT_DIR,'gold_v2_walkforward_report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({
    selected_variant:result.selected_variant,
    is_conservative_quality_gate:winner?.results?.conservative?.qualityGate?.passed??false,
    oos_conservative_quality_gate:oos?.results?.conservative?.qualityGate?.passed??false,
    oos_trades:oos?.results?.conservative?.summary?.trades??0,
    oos_pf:oos?.results?.conservative?.summary?.profit_factor??null,
    oos_expectancy_R:oos?.results?.conservative?.summary?.expectancy_R??null,
    oos_max_dd_pct:oos?.results?.conservative?.summary?.max_drawdown_pct??null
  },null,2));
}

main().catch((error)=>{ console.error(error.stack||error); process.exit(1); });
