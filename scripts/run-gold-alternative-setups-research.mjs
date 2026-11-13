import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(process.env.GOLD_ALT_SETUP_SOURCE_DIR || path.join(ROOT, 'gold-v2-walkforward'));
const OUTPUT_DIR = path.resolve(process.env.GOLD_ALT_SETUP_OUTPUT_DIR || path.join(ROOT, 'gold-alternative-setups-output'));

const PERIODS = [
  { name: 'IS_3Y', file: 'is_data.json.gz', days: 1095 },
  { name: 'OOS_2Y', file: 'oos_data.json.gz', days: 730 }
];

const VARIANTS = [
  { name: 'strict_breakout_v2', selector: 'breakout_v2', description: 'Production reference: H1 Strict + M5 compression/volume breakout', params: 'Existing GOLD V2 Strict parameters; unchanged' },
  { name: 'pullback_retest', selector: 'pullback_retest', description: 'H1 Strict + previous M5 candle EMA20 touch + current candle directional reconfirmation', params: 'EMA20 touch 0.15 ATR; pullback close tolerance 0.35 ATR; reconfirmation beyond prior candle extreme; extension <=1.5 ATR; SL 0.8-2.0 ATR; TP 2R' },
  { name: 'halfback_v1', selector: 'halfback_v1', description: 'H1 Strict + confirmed M5 impulse + 45-55% retracement + continuation reconfirmation', params: 'Confirmed swing 2 left/2 right; impulse 5-40 bars and >=1.5 ATR; retracement 45-55%; body >=0.25 ATR; SL 0.5-2.5 ATR; TP 2R' },
  { name: 'momentum_pullback_v1', selector: 'momentum_pullback_v1', description: 'H1 strict trend + measurable 3-bar H1 momentum + M5 EMA20 pullback + re-acceleration confirmation', params: 'H1 close momentum >=0.35 ATR over 3 bars; EMA20/EMA50 gap >=0.15 H1 ATR; M5 EMA20 touch 0.20 ATR; EMA50 penetration <=0.15 ATR; confirmation body >=0.30 ATR; close location BUY >=0.70 / SELL <=0.30; stop 0.60-1.50 ATR; target 2.50R' }
];

function round(value, digits = 4) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}
function safePf(value) {
  if (value === null || value === undefined) return null;
  if (value === Infinity) return 'Infinity';
  return round(value, 4);
}
function compactSummary(result) {
  const s = result?.summary || {};
  return {
    trades: Number(s.trades || 0), wins: Number(s.wins || 0), losses: Number(s.losses || 0),
    win_rate_pct: round(s.win_rate_pct, 2), profit_factor: safePf(s.profit_factor),
    expectancy_R: round(s.expectancy_R, 4), total_R: round(s.total_R, 4),
    net_profit: round(s.net_profit, 2), max_drawdown_pct: round(s.max_drawdown_pct, 4),
    stop_exits: Number(s.stop_exits || 0), target_exits: Number(s.target_exits || 0)
  };
}
function topReasons(reasons, limit = 8) {
  return Object.entries(reasons || {}).sort((a,b) => b[1] - a[1]).slice(0, limit)
    .map(([reason,count]) => ({reason,count:Number(count)}));
}

async function runOne(period, variant) {
  const dataFile = path.join(SOURCE_DIR, period.file);
  const outDir = path.join(OUTPUT_DIR, period.name, variant.name);
  await fs.mkdir(outDir, { recursive: true });
  await fs.access(dataFile);

  const env = {
    ...process.env,
    GOLD_BACKTEST_DATA_FILE: dataFile,
    GOLD_BACKTEST_OUTPUT_DIR: outDir,
    GOLD_BACKTEST_LOOKBACK_DAYS: String(period.days),
    GOLD_BACKTEST_IS_ONLY: 'false',
    GOLD_BACKTEST_STRATEGY_VARIANT: variant.selector,
    GOLD_BACKTEST_INITIAL_EQUITY: '100000',
    GOLD_BACKTEST_RISK_PCT: '0.25',
    GOLD_BACKTEST_SPREAD_PRICE: '0.50',
    GOLD_BACKTEST_SLIPPAGE_PRICE: '0.05',
    GOLD_BACKTEST_MAX_DAILY_LOSS_PCT: '2',
    GOLD_BACKTEST_MAX_DRAWDOWN_PCT: '5',
    GOLD_BACKTEST_MAX_HOLD_BARS: '96',
    GOLD_BACKTEST_MAX_ENTRY_GAP_ATR: '0.50',
    GOLD_BACKTEST_SERVER_TIMEZONE: 'Europe/Nicosia',
    GOLD_RANGE_LOOKBACK: '12',
    GOLD_MIN_RANGE_ATR: '0.80',
    GOLD_MAX_RANGE_ATR: '2.80',
    GOLD_BREAKOUT_ATR: '0.10',
    GOLD_MIN_BODY_ATR: '0.40',
    GOLD_MIN_CLOSE_LOCATION: '0.65',
    GOLD_MIN_VOLUME_RATIO: '1.10',
    GOLD_BUY_RSI_MIN: '52',
    GOLD_BUY_RSI_MAX: '75',
    GOLD_SELL_RSI_MIN: '25',
    GOLD_SELL_RSI_MAX: '48',
    GOLD_MAX_EXTENSION_ATR: '1.50',
    GOLD_STOP_BUFFER_ATR: '0.15',
    GOLD_MIN_STOP_ATR: '0.80',
    GOLD_MAX_STOP_ATR: '2.00',
    GOLD_TAKE_PROFIT_R: '2.00',
    GOLD_MIN_H1_RSI_BUY: '50',
    GOLD_MAX_H1_RSI_BUY: '72',
    GOLD_MIN_H1_RSI_SELL: '28',
    GOLD_MAX_H1_RSI_SELL: '50',
    GOLD_SESSION_START_UTC: '7',
    GOLD_SESSION_END_UTC: '20',
    GOLD_H1_TREND_MODE: 'strict',
    GOLD_HALFBACK_SWING_LEFT_BARS: '2',
    GOLD_HALFBACK_SWING_RIGHT_BARS: '2',
    GOLD_HALFBACK_MIN_IMPULSE_BARS: '5',
    GOLD_HALFBACK_MAX_IMPULSE_BARS: '40',
    GOLD_HALFBACK_MIN_IMPULSE_ATR: '1.5',
    GOLD_HALFBACK_RETRACE_MIN: '0.45',
    GOLD_HALFBACK_RETRACE_MAX: '0.55',
    GOLD_HALFBACK_MIN_BODY_ATR: '0.25',
    GOLD_HALFBACK_MIN_H1_RSI_BUY: '50',
    GOLD_HALFBACK_MAX_H1_RSI_BUY: '72',
    GOLD_HALFBACK_MIN_H1_RSI_SELL: '28',
    GOLD_HALFBACK_MAX_H1_RSI_SELL: '50',
    GOLD_HALFBACK_MIN_CLOSE_LOCATION_BUY: '0.60',
    GOLD_HALFBACK_MAX_CLOSE_LOCATION_SELL: '0.40',
    GOLD_HALFBACK_STOP_BUFFER_ATR: '0.15',
    GOLD_HALFBACK_MIN_STOP_ATR: '0.50',
    GOLD_HALFBACK_MAX_STOP_ATR: '2.50',
    GOLD_HALFBACK_TAKE_PROFIT_R: '2.00',
    GOLD_HALFBACK_SESSION_START_UTC: '7',
    GOLD_HALFBACK_SESSION_END_UTC: '20',
    GOLD_MOMENTUM_PULLBACK_MIN_H1_MOMENTUM_ATR: '0.35',
    GOLD_MOMENTUM_PULLBACK_MIN_H1_EMA_GAP_ATR: '0.15',
    GOLD_MOMENTUM_PULLBACK_MIN_H1_RSI_BUY: '52',
    GOLD_MOMENTUM_PULLBACK_MAX_H1_RSI_BUY: '70',
    GOLD_MOMENTUM_PULLBACK_MIN_H1_RSI_SELL: '30',
    GOLD_MOMENTUM_PULLBACK_MAX_H1_RSI_SELL: '48',
    GOLD_MOMENTUM_PULLBACK_TOUCH_ATR: '0.20',
    GOLD_MOMENTUM_PULLBACK_MAX_EMA50_PENETRATION_ATR: '0.15',
    GOLD_MOMENTUM_PULLBACK_MIN_M5_RSI_BUY: '52',
    GOLD_MOMENTUM_PULLBACK_MAX_M5_RSI_BUY: '70',
    GOLD_MOMENTUM_PULLBACK_MIN_M5_RSI_SELL: '30',
    GOLD_MOMENTUM_PULLBACK_MAX_M5_RSI_SELL: '48',
    GOLD_MOMENTUM_PULLBACK_MIN_BODY_ATR: '0.30',
    GOLD_MOMENTUM_PULLBACK_MIN_CLOSE_LOCATION_BUY: '0.70',
    GOLD_MOMENTUM_PULLBACK_MAX_CLOSE_LOCATION_SELL: '0.30',
    GOLD_MOMENTUM_PULLBACK_CONFIRM_BREAKOUT_ATR: '0.05',
    GOLD_MOMENTUM_PULLBACK_MAX_EXTENSION_ATR: '1.00',
    GOLD_MOMENTUM_PULLBACK_STOP_BUFFER_ATR: '0.10',
    GOLD_MOMENTUM_PULLBACK_MIN_STOP_ATR: '0.60',
    GOLD_MOMENTUM_PULLBACK_MAX_STOP_ATR: '1.50',
    GOLD_MOMENTUM_PULLBACK_TAKE_PROFIT_R: '2.50',
    GOLD_MOMENTUM_PULLBACK_SESSION_START_UTC: '7',
    GOLD_MOMENTUM_PULLBACK_SESSION_END_UTC: '20'
  };
  delete env.GOLD_STRATEGY_JSON;

  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'backtest-gold-v2.mjs'), `--lookback-days=${period.days}`], {
    cwd: ROOT, env, stdio: 'pipe', maxBuffer: 30 * 1024 * 1024
  });

  const prefix = variant.selector === 'halfback_v1' ? 'gold_halfback_v1'
    : variant.selector === 'momentum_pullback_v1' ? 'gold_momentum_pullback_v1' : 'gold_v2';
  const reportPath = path.join(outDir, prefix + '_backtest_report.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  if (report.strategy_variant !== variant.selector) throw new Error(`Strategy selector mismatch: expected ${variant.selector}, got ${report.strategy_variant}`);
  const baseline = report.results?.baseline;
  const conservative = report.results?.conservative;
  if (!baseline || !conservative) throw new Error(`Missing cost scenario for ${period.name}/${variant.name}`);

  return {
    period: period.name, period_days: period.days, variant: variant.name, selector: variant.selector,
    description: variant.description, fixed_parameters: variant.params, evaluation_window: report.test_period,
    baseline: compactSummary(baseline), conservative: compactSummary(conservative),
    baseline_candidates: Number(baseline.candidates || 0), conservative_candidates: Number(conservative.candidates || 0),
    baseline_candidates_buy: Number(baseline.candidates_buy || 0), baseline_candidates_sell: Number(baseline.candidates_sell || 0),
    baseline_wait_reasons: baseline.setup_wait_reasons || {}, conservative_wait_reasons: conservative.setup_wait_reasons || {},
    baseline_quality_gate: baseline.qualityGate?.passed === true, conservative_quality_gate: conservative.qualityGate?.passed === true,
    baseline_report_file: path.relative(OUTPUT_DIR, reportPath),
    baseline_trades_csv: path.relative(OUTPUT_DIR, path.join(outDir, prefix + '_trades_baseline.csv')),
    conservative_trades_csv: path.relative(OUTPUT_DIR, path.join(outDir, prefix + '_trades_conservative.csv'))
  };
}

function buildMarkdown(rows) {
  const lines = [
    '# GOLD V2 vs Trend Momentum Pullback Entry Structures',
    '',
    '**Research-only exploratory comparison. No production configuration is changed. No strategy is automatically selected or promoted.**',
    '',
    '## Method',
    '',
    '- Same prepared XAUUSD M5 source split from Walk-Forward run 43349812731.',
    '- IS 3 years and OOS 2 years evaluated separately.',
    '- H1 trend remains Strict for every strategy.',
    '- Same initial equity, risk per trade, max daily loss, drawdown cap, max hold, entry-gap rule, session, baseline and conservative costs.',
    '- All alternate strategy parameters are fixed to their documented defaults before the run; no parameter search or OOS tuning.',
    '- Momentum Pullback V1 explicitly requires H1 directional momentum and EMA separation, then waits for an M5 EMA20 pullback and directional re-acceleration; it targets 2.5R with a structure-based stop.',
    '- The OOS period has already been consulted in earlier research. This is a repeated robustness check, not a fresh blind holdout.',
    '',
    '## Conservative-cost results',
    '',
    '| Strategy | Period | Trades | Win % | PF | Expectancy R | Max DD % | Candidates | Quality gate |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|'
  ];
  for (const r of rows) {
    const s = r.conservative;
    lines.push(`| ${r.variant} | ${r.period} | ${s.trades} | ${s.win_rate_pct ?? 'NA'} | ${s.profit_factor ?? 'NA'} | ${s.expectancy_R ?? 'NA'} | ${s.max_drawdown_pct ?? 'NA'} | ${r.conservative_candidates} | ${r.conservative_quality_gate ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', '## Baseline-cost results', '', '| Strategy | Period | Trades | Win % | PF | Expectancy R | Max DD % | Candidates |', '|---|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    const s = r.baseline;
    lines.push(`| ${r.variant} | ${r.period} | ${s.trades} | ${s.win_rate_pct ?? 'NA'} | ${s.profit_factor ?? 'NA'} | ${s.expectancy_R ?? 'NA'} | ${s.max_drawdown_pct ?? 'NA'} | ${r.baseline_candidates} |`);
  }
  for (const r of rows) {
    lines.push('', `## ${r.variant} / ${r.period}`, '', '**Most frequent first rejection reasons**', '', '| Reason | Count |', '|---|---:|');
    for (const item of topReasons(r.baseline_wait_reasons, 10)) lines.push(`| ${item.reason} | ${item.count} |`);
    lines.push('', `Detailed report: ${r.baseline_report_file}`);
  }
  lines.push(
    '',
    '## Guardrails and interpretation',
    '',
    '- Bar-level candidates are not executed trades. Actual trade counts are shown separately.',
    '- Very low trade counts make PF and expectancy highly unstable; never judge performance without sample size.',
    '- A zero or negative IS/OOS expectancy is not a promotion signal, even when PF is undefined or Infinity due to tiny samples.',
    '- Neither alternate is a production patch; main, Render, MT4 and Supabase settings are untouched.',
    '- If an alternate appears promising, require a newly frozen future forward-paper sample before further promotion discussion.',
    '- Current production remains GOLD V2 Strict, ANALYSIS, auto trading OFF, and real-order gate OFF.'
  );
  return lines.join('\n') + '\n';
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  for (const period of PERIODS) await fs.access(path.join(SOURCE_DIR, period.file));
  const rows = [];
  for (const period of PERIODS) {
    for (const variant of VARIANTS) {
      console.log(`Running ${variant.name} / ${period.name}`);
      rows.push(await runOne(period, variant));
    }
  }
  const output = {
    title: 'GOLD V2 vs Trend Momentum Pullback Entry Structures',
    methodology: 'Fixed IS/OOS exploratory comparison of production Strict breakout reference and three research-only entry structures, including a pre-registered H1 momentum + M5 pullback/re-acceleration hypothesis',
    source_walkforward_run_id: process.env.GOLD_ALT_SETUP_SOURCE_RUN_ID || '43349812731',
    fresh_blind_oos: false, oos_previously_consulted: true, automatic_strategy_selection: false, production_changed: false,
    production_settings: {
      strategy: 'GOLD V2 Strict', range_atr: '0.80-2.80', risk_pct: 0.25, spread_limit_price: 0.50,
      runtime_mode: 'ANALYSIS', auto_trading_enabled: false, real_order_gate: 'OFF'
    },
    periods: PERIODS, variants: VARIANTS, results: rows
  };
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_alternative_setups_report.json'), JSON.stringify(output, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_alternative_setups_report.md'), buildMarkdown(rows));
  console.log(JSON.stringify({
    completed: rows.length,
    is_results: rows.filter(r => r.period === 'IS_3Y').map(r => ({
      variant:r.variant, trades:r.conservative.trades, pf:r.conservative.profit_factor,
      expectancy_R:r.conservative.expectancy_R, candidates:r.conservative_candidates
    })),
    oos_results: rows.filter(r => r.period === 'OOS_2Y').map(r => ({
      variant:r.variant, trades:r.conservative.trades, pf:r.conservative.profit_factor,
      expectancy_R:r.conservative.expectancy_R, candidates:r.conservative_candidates
    })),
    fresh_blind_oos: false, production_changed: false
  }, null, 2));
}

main().catch(error => { console.error(error?.stack || error); process.exit(1); });
