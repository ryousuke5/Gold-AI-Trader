import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).filter(x => x.startsWith('--')).map(x => {
  const [k, ...rest] = x.slice(2).split('=');
  return [k, rest.join('=') || 'true'];
}));
const outputDir = path.resolve(args.get('output-dir') || process.env.GOLD_SELL_FOLLOWTHROUGH_OUTPUT_DIR || 'gold-backtest-output/sell-followthrough');
const dataFile = path.resolve(args.get('data-file') || process.env.GOLD_BACKTEST_DATA_FILE || '');
const engine = path.join(__dirname, 'backtest-gold-v2.mjs');
if (!dataFile) throw new Error('A prepared GOLD M5 dataset is required via GOLD_BACKTEST_DATA_FILE or --data-file.');
await fs.access(dataFile);
await fs.access(engine);
await fs.mkdir(outputDir, { recursive: true });

const variants = [
  { name: 'strict_h1', h1TrendMode: 'strict' },
  { name: 'h1_close_ema20_rsi_research', h1TrendMode: 'close_ema20_rsi' }
];

for (const variant of variants) {
  const variantDir = path.join(outputDir, variant.name);
  await fs.mkdir(variantDir, { recursive: true });
  const env = {
    ...process.env,
    GOLD_BACKTEST_DATA_FILE: dataFile,
    GOLD_BACKTEST_OUTPUT_DIR: variantDir,
    GOLD_H1_TREND_MODE: variant.h1TrendMode
  };
  delete env.GOLD_TEST_STOP_AFTER_BARS;
  const run = spawnSync(process.execPath, [engine], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  if (run.error) throw new Error(variant.name + ': engine failed to start: ' + run.error.message);
  if (run.status !== 0) {
    throw new Error(variant.name + ': engine exited ' + run.status + '\nSTDOUT:\n' + String(run.stdout).slice(-8000) + '\nSTDERR:\n' + String(run.stderr).slice(-8000));
  }
  console.log('SELL_FOLLOWTHROUGH_BACKTEST_PASS', JSON.stringify({
    variant: variant.name,
    h1_trend_mode: variant.h1TrendMode,
    output: variantDir
  }));
}

const bucketDefinitions = [
  {
    key: 'h1_price_vs_ema20_atr',
    label: '|H1 close - EMA20| / H1 ATR',
    feature: e => Math.abs(num(e.h1_at_signal?.close_vs_ema20_atr)),
    buckets: [
      { label: '<0.50', test: x => x < 0.50 },
      { label: '0.50–0.99', test: x => x >= 0.50 && x < 1.00 },
      { label: '≥1.00', test: x => x >= 1.00 }
    ]
  },
  {
    key: 'h1_ema20_ema50_separation_atr',
    label: '|H1 EMA20 - EMA50| / H1 ATR',
    feature: e => Math.abs(num(e.h1_at_signal?.ema20_vs_ema50_atr)),
    buckets: [
      { label: '<0.50', test: x => x < 0.50 },
      { label: '0.50–1.49', test: x => x >= 0.50 && x < 1.50 },
      { label: '≥1.50', test: x => x >= 1.50 }
    ]
  },
  {
    key: 'h1_ema50_ema200_separation_atr',
    label: '|H1 EMA50 - EMA200| / H1 ATR',
    feature: e => Math.abs(num(e.h1_at_signal?.ema50_vs_ema200_atr)),
    buckets: [
      { label: '<0.25', test: x => x < 0.25 },
      { label: '0.25–0.99', test: x => x >= 0.25 && x < 1.00 },
      { label: '≥1.00', test: x => x >= 1.00 }
    ]
  },
  {
    key: 'm5_breakout_atr',
    label: 'M5 breakout width / M5 ATR',
    feature: e => num(e.setup_diagnostics?.breakout_atr),
    buckets: [
      { label: '<0.15', test: x => x < 0.15 },
      { label: '0.15–0.249', test: x => x >= 0.15 && x < 0.25 },
      { label: '≥0.25', test: x => x >= 0.25 }
    ]
  },
  {
    key: 'm5_body_atr',
    label: 'M5 candle body / M5 ATR',
    feature: e => num(e.setup_diagnostics?.body_atr),
    buckets: [
      { label: '<0.60', test: x => x < 0.60 },
      { label: '0.60–0.799', test: x => x >= 0.60 && x < 0.80 },
      { label: '≥0.80', test: x => x >= 0.80 }
    ]
  },
  {
    key: 'm5_volume_ratio',
    label: 'M5 volume / recent average volume',
    feature: e => num(e.setup_diagnostics?.volume_ratio),
    buckets: [
      { label: '<1.15', test: x => x < 1.15 },
      { label: '1.15–1.349', test: x => x >= 1.15 && x < 1.35 },
      { label: '≥1.35', test: x => x >= 1.35 }
    ]
  },
  {
    key: 'utc_session',
    label: 'UTC signal hour',
    feature: e => num(e.hour_utc),
    buckets: [
      { label: '07–11 UTC', test: x => x >= 7 && x <= 11 },
      { label: '12–15 UTC', test: x => x >= 12 && x <= 15 },
      { label: '16–19 UTC', test: x => x >= 16 && x <= 19 },
      { label: '20–23 UTC', test: x => x >= 20 && x <= 23 },
      { label: '00–06 UTC', test: x => x >= 0 && x <= 6 }
    ]
  }
];

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function median(values) {
  const v = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!v.length) return null;
  const m = Math.floor(v.length/2);
  return v.length % 2 ? v[m] : (v[m-1] + v[m]) / 2;
}
function avg(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null;
}
function outcomeStats(events) {
  const actual = events.map(e=>e.actual_outcome).filter(Boolean);
  const shadow = events.map(e=>e.counterfactual_rr_only_outcome).filter(Boolean);
  const rs = actual.map(x=>num(x.net_r)).filter(Number.isFinite);
  const mfe = actual.map(x=>num(x.mfe_r)).filter(Number.isFinite);
  const mae = actual.map(x=>num(x.mae_r)).filter(Number.isFinite);
  const exits = Object.fromEntries(['STOP','TARGET','DATA_GAP','TIME'].map(k=>[k,actual.filter(x=>x.exit_reason===k).length]).filter(([,n])=>n>0));
  return {
    accepted_trade_n: actual.length,
    accepted_wins: actual.filter(x=>num(x.net_r)>0).length,
    accepted_losses: actual.filter(x=>num(x.net_r)<0).length,
    accepted_mean_net_R: avg(rs),
    accepted_median_net_R: median(rs),
    accepted_mean_MFE_R_before_exit: avg(mfe),
    accepted_mean_MAE_R_before_exit: avg(mae),
    accepted_exit_reasons: exits,
    RR_only_shadow_n: shadow.length,
    RR_only_shadow_mean_R: avg(shadow.map(x=>num(x.net_r)).filter(Number.isFinite))
  };
}
function horizonStats(events, horizonMinutes) {
  const rows = events.map(e=>e.forward_followthrough?.[String(horizonMinutes)]).filter(Boolean);
  const complete = rows.filter(x=>x.complete);
  const closeR = complete.map(x=>num(x.close_move_R)).filter(Number.isFinite);
  const mfeR = complete.map(x=>num(x.favourable_excursion_R)).filter(Number.isFinite);
  const maeR = complete.map(x=>num(x.adverse_excursion_R)).filter(Number.isFinite);
  const favourableCloses = complete.filter(x=>num(x.close_move_R)>0).length;
  const barriers = Object.fromEntries(['STOP','TARGET'].map(k=>[k,complete.filter(x=>x.first_barrier?.reason===k).length]).filter(([,n])=>n>0));
  return {
    horizon_minutes: horizonMinutes,
    n_candidates: events.length,
    n_complete_horizons: complete.length,
    mean_close_move_R: avg(closeR),
    median_close_move_R: median(closeR),
    pct_close_move_favourable: complete.length ? favourableCloses/complete.length*100 : null,
    mean_MFE_R_fixed_horizon: avg(mfeR),
    median_MFE_R_fixed_horizon: median(mfeR),
    mean_MAE_R_fixed_horizon: avg(maeR),
    median_MAE_R_fixed_horizon: median(maeR),
    first_barrier_counts_within_horizon: barriers
  };
}
function candidateFeatureRow(event, variant) {
  const h=event.h1_at_signal||{};
  const m=event.signal_bar||{};
  const d=event.setup_diagnostics||{};
  const actual=event.actual_outcome||{};
  const shadow=event.counterfactual_rr_only_outcome||{};
  const ft=event.forward_followthrough||{};
  const row={
    variant,
    h1_trend_mode: event.h1_trend_mode || null,
    signal_time_utc: event.signal_time_utc,
    year_utc: event.year_utc,
    period: event.period || null,
    side: event.side,
    hour_utc: event.hour_utc,
    h1_rsi14: h.rsi14,
    h1_close_vs_ema20_atr: h.close_vs_ema20_atr,
    h1_ema20_vs_ema50_atr: h.ema20_vs_ema50_atr,
    h1_ema50_vs_ema200_atr: h.ema50_vs_ema200_atr,
    strict_bear_stack: h.strict_bear_stack,
    m5_rsi14: m.rsi14,
    breakout_atr: d.breakout_atr,
    body_atr: d.body_atr,
    volume_ratio: d.volume_ratio,
    close_location: d.close_location,
    range_atr: d.range_atr,
    extension_atr: d.extension_atr,
    stop_atr: d.stop_atr,
    entry_gap_atr: event.entry_metrics?.entry_gap_atr ?? null,
    effective_rr: event.entry_metrics?.effective_rr ?? null,
    admission_decision: event.admission_decision,
    actual_exit_reason: actual.exit_reason ?? null,
    actual_net_r: actual.net_r ?? null,
    actual_mfe_r_before_exit: actual.mfe_r ?? null,
    actual_mae_r_before_exit: actual.mae_r ?? null,
    RR_only_shadow_exit_reason: shadow.exit_reason ?? null,
    RR_only_shadow_net_r: shadow.net_r ?? null
  };
  for (const minutes of [15,30,60,90,120]) {
    const x=ft[String(minutes)]||{};
    row[`close_move_${minutes}m_R`]=x.close_move_R ?? null;
    row[`MFE_${minutes}m_R`]=x.favourable_excursion_R ?? null;
    row[`MAE_${minutes}m_R`]=x.adverse_excursion_R ?? null;
    row[`first_barrier_${minutes}m`]=x.first_barrier?.reason ?? null;
    row[`complete_${minutes}m`]=x.complete ?? false;
  }
  return row;
}

const variantsData = [];
for (const variant of variants) {
  const variantDir=path.join(outputDir,variant.name);
  const report=JSON.parse(await fs.readFile(path.join(variantDir,'gold_v2_backtest_report.json'),'utf8'));
  const events=JSON.parse(await fs.readFile(path.join(variantDir,'gold_v2_candidate_events_baseline.json'),'utf8'));
  if (!Array.isArray(events)) throw new Error(variant.name+': candidate events must be an array');
  const baseline=report.results?.baseline;
  if (!baseline || events.length!==Number(baseline.candidates)) throw new Error(variant.name+': candidate count does not reconcile');
  const sells=events.filter(e=>e.side==='SELL');
  if (sells.some(e=>!e.forward_followthrough)) throw new Error(variant.name+': missing forward follow-through metrics');
  for (const e of events) e.h1_trend_mode=variant.h1TrendMode;
  variantsData.push({variant,report,events,sells});
}

const results=[];
const eventRows=[];
for (const item of variantsData) {
  const sells=item.sells;
  for (const e of sells) eventRows.push(candidateFeatureRow(e,item.variant.name));
  const groups=[];
  for (const def of bucketDefinitions) {
    for (const bucket of def.buckets) {
      const matched=sells.filter(e=>{
        const value=def.feature(e);
        return value!==null && bucket.test(value);
      });
      groups.push({
        feature_key:def.key,
        feature: def.label,
        bucket:bucket.label,
        candidate_n:matched.length,
        accepted_trade_n:matched.filter(e=>Boolean(e.actual_outcome)).length,
        h1_strict_bear_stack_n:matched.filter(e=>e.h1_at_signal?.strict_bear_stack).length,
        actual_outcomes:outcomeStats(matched),
        fixed_horizon_followthrough:Object.fromEntries([15,30,60,90,120].map(min=>[String(min),horizonStats(matched,min)])),
        candidate_signal_times_utc:matched.map(e=>e.signal_time_utc)
      });
    }
  }
  results.push({
    variant:item.variant.name,
    h1_trend_mode:item.variant.h1TrendMode,
    all_setup_candidates:item.events.length,
    sell_candidate_n:sells.length,
    accepted_sell_trades:sells.filter(e=>Boolean(e.actual_outcome)).length,
    rr_rejected_sell_candidates:sells.filter(e=>e.admission_decision==='REJECTED_EFFECTIVE_RR').length,
    sell_actual_outcomes:outcomeStats(sells),
    sell_fixed_horizon_followthrough:Object.fromEntries([15,30,60,90,120].map(min=>[String(min),horizonStats(sells,min)])),
    sell_feature_buckets:groups,
    sell_candidates:sells.map(e=>candidateFeatureRow(e,item.variant.name)),
    notes:[
      'H1 relaxed variant is research-only and is not the production strategy.',
      'Strict and relaxed variants share many signal times; do not combine them as independent samples.',
      'Fixed-horizon returns ignore simulated stop/target exits and are descriptive path measures, not tradable PnL.',
      'M5 OHLC does not reveal the exact sequence within a candle; stop-first is only an intrabar ambiguity convention.',
      'Feature buckets with n below 5 are descriptive only and must not be used to select a production rule.'
    ]
  });
}

const strictSells=variantsData.find(x=>x.variant.name==='strict_h1').sells;
const relaxedSells=variantsData.find(x=>x.variant.name==='h1_close_ema20_rsi_research').sells;
const result={
  generated_at:new Date().toISOString(),
  research_only:true,
  live_trading_settings_changed:false,
  instrument:'XAUUSD',
  source_period:variantsData[0].report.source_period,
  data_rows:variantsData[0].report.data_quality?.rows,
  server_timezone:variantsData[0].report.server_timezone,
  fixed_conditions:'Same five-year prepared data, strategy thresholds, entry/exit model, costs and risk settings; only H1 trend gate mode differs between variants.',
  horizons_minutes:[15,30,60,90,120],
  sell_candidate_counts:{strict_h1:strictSells.length,h1_close_ema20_rsi_research:relaxedSells.length},
  caveats:[
    'Three strict SELL trades are too few to estimate durable signal quality.',
    'The H1 relaxed experiment increases sample size but changes the gate being tested; its results must not be pooled with strict-mode results.',
    'Fixed-window path measures continue after a simulated barrier may have been touched and are not realistic post-exit trade PnL.',
    'The UTC-hour, body, breakout, volume and trend buckets are diagnostic slices, not proof of causality.',
    'Do not change live parameters from this report without larger out-of-sample validation.'
  ],
  variants:results
};
await fs.writeFile(path.join(outputDir,'gold_v2_sell_followthrough_study.json'),JSON.stringify(result,null,2));

const csvFields=Object.keys(eventRows[0]||{variant:''});
const csvEscape=value=>{
  if(value===null||value===undefined)return '';
  const s=typeof value==='object'?JSON.stringify(value):String(value);
  return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;
};
await fs.writeFile(path.join(outputDir,'gold_v2_sell_followthrough_candidates.csv'),
  [csvFields.join(','),...eventRows.map(r=>csvFields.map(k=>csvEscape(r[k])).join(','))].join('\n')+'\n');

const f=value=>value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toFixed(3);
const markdown=[
  '# GOLD SELL breakout follow-through study',
  '',
  '**Research only. No production settings changed.** Same five-year XAUUSD M5 dataset and all assumptions are held constant, except the H1 trend-gate mode in the explicitly labelled research variant.',
  '',
  'Fixed-horizon path measures cover 15, 30, 60, 90 and 120 minutes after modeled entry. They measure future M5 OHLC price path even when a simulated stop/target would already have exited; they are not tradable PnL.',
  '',
  '| H1 mode | SELL candidates | accepted SELL trades | mean actual net R | mean MFE R before actual exit | mean MAE R before actual exit | mean close-move R at 30m | at 60m | at 120m | 60m favourable-close % |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
];
for(const v of results){
  markdown.push('| '+[
    v.variant,
    v.sell_candidate_n,
    v.accepted_sell_trades,
    f(v.sell_actual_outcomes.accepted_mean_net_R),
    f(v.sell_actual_outcomes.accepted_mean_MFE_R_before_exit),
    f(v.sell_actual_outcomes.accepted_mean_MAE_R_before_exit),
    f(v.sell_fixed_horizon_followthrough['30'].mean_close_move_R),
    f(v.sell_fixed_horizon_followthrough['60'].mean_close_move_R),
    f(v.sell_fixed_horizon_followthrough['120'].mean_close_move_R),
    f(v.sell_fixed_horizon_followthrough['60'].pct_close_move_favourable)
  ].join(' | ')+' |');
}
for(const v of results){
  markdown.push('', '## '+v.variant+' — individual SELL candidates', '',
    '| UTC signal | H1 close−EMA20 / ATR | EMA20−50 / ATR | EMA50−200 / ATR | breakout ATR | body ATR | volume ratio | UTC hour | RR | Decision | Actual R | MFE before exit R | 15m close R | 30m close R | 60m close R | 120m close R |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|');
  for(const e of v.sell_candidates){
    markdown.push('| '+[
      e.signal_time_utc,
      f(e.h1_close_vs_ema20_atr),f(e.h1_ema20_vs_ema50_atr),f(e.h1_ema50_vs_ema200_atr),
      f(e.breakout_atr),f(e.body_atr),f(e.volume_ratio),e.hour_utc,f(e.effective_rr),
      e.admission_decision,f(e.actual_net_r),f(e.actual_mfe_r_before_exit),
      f(e['close_move_15m_R']),f(e['close_move_30m_R']),f(e['close_move_60m_R']),f(e['close_move_120m_R'])
    ].join(' | ')+' |');
  }
  markdown.push('', '### Feature bucket summaries', '',
    '| Feature | Bucket | n SELL candidates | accepted trades | 30m mean close R | 60m mean close R | 60m mean MFE R | 60m mean MAE R | 60m favourable-close % | 60m first STOP | 60m first TARGET |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for(const g of v.sell_feature_buckets){
    const h30=g.fixed_horizon_followthrough['30'];
    const h60=g.fixed_horizon_followthrough['60'];
    markdown.push('| '+[
      g.feature,g.bucket,g.candidate_n,g.accepted_trade_n,
      f(h30.mean_close_move_R),f(h60.mean_close_move_R),f(h60.mean_MFE_R_fixed_horizon),f(h60.mean_MAE_R_fixed_horizon),
      f(h60.pct_close_move_favourable),h60.first_barrier_counts_within_horizon.STOP||0,h60.first_barrier_counts_within_horizon.TARGET||0
    ].join(' | ')+' |');
  }
}
markdown.push('', '## Interpretation guardrails','',
  '- The strict strategy only provides three SELL observations in five years; the relaxed H1 variant has a larger but still small sample and is not independent of the strict subset.',
  '- Empty buckets mean no observed SELL candidates, not good or bad performance.',
  '- Do not choose bins based on their observed outcome after seeing the data; thresholds here are fixed diagnostic buckets only.',
  '- First barrier assumes STOP takes precedence if a single candle touches both stop and target. This convention cannot determine true intrabar ordering.',
  '- The next research step should increase diagnostic coverage of near-miss events and then validate any hypothesis on an untouched out-of-sample period.',
  '');
await fs.writeFile(path.join(outputDir,'gold_v2_sell_followthrough_study.md'),markdown.join('\n'));

console.log('GOLD V2 SELL FOLLOWTHROUGH STUDY PASS',JSON.stringify({
  output:outputDir,
  variants:results.map(v=>({variant:v.variant,sell_candidates:v.sell_candidate_n,accepted_sell_trades:v.accepted_sell_trades})),
  csv:path.join(outputDir,'gold_v2_sell_followthrough_candidates.csv'),
  report:path.join(outputDir,'gold_v2_sell_followthrough_study.md')
}));
