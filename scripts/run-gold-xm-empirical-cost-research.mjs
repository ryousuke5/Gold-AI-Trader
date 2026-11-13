import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SOURCE_DIR=path.resolve(process.env.GOLD_XM_COST_SOURCE_DIR||path.join(ROOT,'gold-v2-walkforward'));
const OUTPUT_DIR=path.resolve(process.env.GOLD_XM_COST_OUTPUT_DIR||path.join(ROOT,'gold-xm-empirical-cost-output'));
const PROFILE_FILE=path.join(ROOT,'data','gold_xm_empirical_spread_profile_20261113.json');
const PERIODS=[
  {name:'IS_3Y',file:'is_data.json.gz',days:1095},
  {name:'OOS_2Y',file:'oos_data.json.gz',days:730}
];
const VARIANTS=[
  {name:'strict_breakout_v2',selector:'breakout_v2'},
  {name:'momentum_pullback_v1',selector:'momentum_pullback_v1'}
];

function round(value,digits=4){
  const n=Number(value);
  return Number.isFinite(n)?Number(n.toFixed(digits)):null;
}
function safePf(value){
  if(value===null||value===undefined)return null;
  if(value===Infinity)return 'Infinity';
  return round(value,4);
}
function compact(summary){
  const s=summary||{};
  return {
    trades:Number(s.trades||0),wins:Number(s.wins||0),losses:Number(s.losses||0),
    win_rate_pct:round(s.win_rate_pct,2),profit_factor:safePf(s.profit_factor),
    expectancy_R:round(s.expectancy_R,4),total_R:round(s.total_R,4),
    max_drawdown_pct:round(s.max_drawdown_pct,4),
    stop_exits:Number(s.stop_exits||0),target_exits:Number(s.target_exits||0)
  };
}
function scenarioSummary(report,scenario){
  const r=report.results?.[scenario];
  if(!r)throw new Error('Missing scenario '+scenario);
  return {
    metrics:compact(r.summary),
    candidates:Number(r.candidates||0),
    rejected_spread_gate:Number(r.rejected_spread_gate||0),
    by_side:r.summary?.by_side||null,
    annual:r.annual||[]
  };
}
function buildMarkdown(results){
  const names=['baseline','conservative','xm_demo_p50','xm_demo_p90','xm_demo_p95_stress','xm_real_p90'];
  const lines=[
    '# GOLD XM Empirical Spread Cost Replay',
    '',
    '**Research-only. No strategy, EA, Render, Supabase or production settings were changed.**',
    '',
    '## Method',
    '',
    '- Source bars: fixed Walk-Forward artifact 43349812731; IS 3Y and previously consulted OOS 2Y are reported separately.',
    '- Strategies: unchanged GOLD V2 Strict reference and unchanged Momentum Pullback V1 research candidate.',
    '- Empirical hourly spread profiles are built from the October-November 2026 XM GOLD# quote log, partitioned by account_server and deduplicated.',
    '- Backtest UTC timestamps are converted to Europe/Nicosia server-local hour, preserving DST.',
    '- Entry and exit each use their own hour-specific empirical spread percentile.',
    '- Slippage remains an assumption (0.05 per side except P95 stress at 0.10); commission, swap and financing remain unmodeled.',
    '- An empirical entry spread estimate above 0.50 price units is rejected by a research-only spread gate.',
    '- OOS was viewed previously and is not a fresh blind holdout or a tuning set.',
    '',
    '## Results by scenario',
    ''
  ];
  for(const name of names){
    lines.push('### '+name,'','| Strategy | Period | Trades | Win % | PF | Expectancy R | Max DD % | Candidates | Spread-gate rejects |','|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for(const r of results){
      const s=r.scenarios[name];
      lines.push(`| ${r.variant} | ${r.period} | ${s.metrics.trades} | ${s.metrics.win_rate_pct??'NA'} | ${s.metrics.profit_factor??'NA'} | ${s.metrics.expectancy_R??'NA'} | ${s.metrics.max_drawdown_pct??'NA'} | ${s.candidates} | ${s.rejected_spread_gate} |`);
    }
    lines.push('');
  }
  lines.push(
    '## Interpretation guardrails','',
    '- The empirical model replaces the fixed spread assumption with recent account-server/hour percentiles; it does not reconstruct exact 2021-2026 XM quotes.',
    '- Demo and Real profile samples are non-overlapping calendar periods, so their strategy-result differences are not a controlled comparison of account types.',
    '- P50/P90/P95 are cost scenarios, not guaranteed spreads or fill prices.',
    '- Slippage, commission and swap must be measured/verified before this can be considered an all-in cost model.',
    '- A passing backtest cannot authorize order execution. Production remains ANALYSIS, auto trading OFF, real-order gate OFF, MT4 AllowAutoOrders OFF.'
  );
  return lines.join('\n')+'\n';
}
async function main(){
  await fs.mkdir(OUTPUT_DIR,{recursive:true});
  await fs.access(PROFILE_FILE);
  const rows=[];
  for(const period of PERIODS){
    const dataFile=path.join(SOURCE_DIR,period.file);
    await fs.access(dataFile);
    for(const variant of VARIANTS){
      console.log('XM empirical cost replay',variant.name,period.name);
      const outDir=path.join(OUTPUT_DIR,period.name,variant.name);
      await fs.mkdir(outDir,{recursive:true});
      const env={
        ...process.env,
        GOLD_BACKTEST_DATA_FILE:dataFile,
        GOLD_BACKTEST_OUTPUT_DIR:outDir,
        GOLD_BACKTEST_LOOKBACK_DAYS:String(period.days),
        GOLD_BACKTEST_IS_ONLY:'false',
        GOLD_BACKTEST_STRATEGY_VARIANT:variant.selector,
        GOLD_BACKTEST_INITIAL_EQUITY:'100000',
        GOLD_BACKTEST_RISK_PCT:'0.25',
        GOLD_BACKTEST_SPREAD_PRICE:'0.50',
        GOLD_BACKTEST_SLIPPAGE_PRICE:'0.05',
        GOLD_BACKTEST_SPREAD_GATE_PRICE:'0.50',
        GOLD_BACKTEST_SPREAD_PROFILE_FILE:PROFILE_FILE,
        GOLD_BACKTEST_INCLUDE_XM_EMPIRICAL_SCENARIOS:'true',
        GOLD_BACKTEST_MAX_DAILY_LOSS_PCT:'2',
        GOLD_BACKTEST_MAX_DRAWDOWN_PCT:'5',
        GOLD_BACKTEST_MAX_HOLD_BARS:'96',
        GOLD_BACKTEST_MAX_ENTRY_GAP_ATR:'0.50',
        GOLD_BACKTEST_SERVER_TIMEZONE:'Europe/Nicosia'
      };
      delete env.GOLD_STRATEGY_JSON;
      execFileSync(process.execPath,[path.join(ROOT,'scripts','backtest-gold-v2.mjs'),`--lookback-days=${period.days}`],{
        cwd:ROOT,env,stdio:'pipe',maxBuffer:30*1024*1024
      });
      const prefix=variant.selector==='momentum_pullback_v1'?'gold_momentum_pullback_v1':'gold_v2';
      const reportPath=path.join(outDir,prefix+'_backtest_report.json');
      const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
      if(report.strategy_variant!==variant.selector)throw new Error('Strategy selector mismatch');
      const scenarios={};
      for(const name of ['baseline','conservative','xm_demo_p50','xm_demo_p90','xm_demo_p95_stress','xm_real_p90']){
        scenarios[name]=scenarioSummary(report,name);
      }
      rows.push({
        period:period.name,variant:variant.name,selector:variant.selector,
        test_period:report.test_period,cost_model_limitations:report.cost_model_limitations,
        scenarios,
        report_file:path.relative(OUTPUT_DIR,reportPath)
      });
    }
  }
  const output={
    title:'GOLD XM empirical spread cost replay',
    source_walkforward_run_id:'43349812731',
    profile_file:'data/gold_xm_empirical_spread_profile_20261113.json',
    oos_previously_consulted:true,fresh_blind_oos:false,production_changed:false,
    production_state:{mode:'ANALYSIS',auto_trading_enabled:false,real_order_gate:'OFF',mt4_allow_auto_orders:'OFF'},
    results:rows
  };
  await fs.writeFile(path.join(OUTPUT_DIR,'gold_xm_empirical_cost_report.json'),JSON.stringify(output,null,2));
  await fs.writeFile(path.join(OUTPUT_DIR,'gold_xm_empirical_cost_report.md'),buildMarkdown(rows));
  console.log(JSON.stringify({completed:rows.length,scenarios:6,production_changed:false,report:'gold_xm_empirical_cost_report.md'},null,2));
}
main().catch(error=>{console.error(error?.stack||error);process.exit(1);});
