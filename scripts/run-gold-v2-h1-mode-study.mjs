import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'scripts/backtest-gold-v2.mjs');
const DATA_FILE = process.env.GOLD_BACKTEST_DATA_FILE;
const OUT_DIR = path.resolve(process.env.GOLD_H1_MODE_STUDY_OUTPUT_DIR || path.join(ROOT, 'gold-h1-mode-study'));
const INITIAL_EQUITY = Number(process.env.GOLD_BACKTEST_INITIAL_EQUITY || 100000);
const RISK_PCT = Number(process.env.GOLD_BACKTEST_RISK_PCT || 0.25);
const MODES = [
  { id: 'strict', label: 'strict EMA20/50/200 stack', env: 'strict' },
  { id: 'close_ema20_rsi', label: 'close vs EMA20 + H1 RSI (research-only stack ablation)', env: 'close_ema20_rsi' }
];
const WINDOWS = [
  { id: 'five_year', days: 1825, role: 'full historical baseline' },
  { id: 'recent_730d', days: 730, role: 'separately reset recent-window validation' }
];
const COSTS = ['baseline', 'conservative'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function summarize(mode, window, cost, report, gapReport) {
  const legacyResult = report.results?.[cost];
  const aware = gapReport.costs?.[cost]?.xm_account_schedule_aware;
  assert(legacyResult, `Missing standard result: ${mode.id}/${window.id}/${cost}`);
  assert(aware, `Missing XM-aware outcome: ${mode.id}/${window.id}/${cost}`);

  const summary = aware.summary;
  const diagnostics = legacyResult.funnel_diagnostics || {};
  const valid = aware.censored !== true && gapReport.costs[cost].comparison_valid === true;
  return {
    mode: mode.id,
    mode_label: mode.label,
    window: window.id,
    window_days: window.days,
    window_role: window.role,
    cost_model: cost,
    summary_valid_for_full_window: valid,
    invalidation_reason: aware.censor_detail
      ? 'The XM schedule-aware portfolio encountered an unverified data gap and was censored.'
      : null,
    gap_policy: 'xm_account_schedule_aware',
    trades: Number(summary.trades || 0),
    wins: Number(summary.wins || 0),
    losses: Number(summary.losses || 0),
    win_rate_pct: finite(summary.win_rate_pct),
    net_profit: finite(summary.net_profit),
    return_pct: finite(summary.return_pct),
    profit_factor: finite(summary.profit_factor),
    expectancy_R: finite(summary.expectancy_R),
    total_R: finite(summary.total_R),
    max_drawdown_pct: finite(summary.max_drawdown_pct),
    candidates: Number(legacyResult.candidates || 0),
    candidates_buy: Number(legacyResult.candidates_buy || 0),
    candidates_sell: Number(legacyResult.candidates_sell || 0),
    signals_evaluated: Number(legacyResult.signals_evaluated || 0),
    risk_gate_blocked_candidates: Number(diagnostics.risk_gate_blocked_candidates || 0),
    rejected_effective_rr: Number(diagnostics.rejected_effective_rr || 0),
    rejected_entry_gap: Number(diagnostics.rejected_entry_gap || 0),
    unverified_gap_censor: aware.censor_detail || null,
    quality_gate_passed: valid ? Boolean(aware.quality_gate?.passed) : false
  };
}

function qualityGate(row) {
  return Boolean(row.summary_valid_for_full_window &&
    row.trades >= 30 &&
    row.profit_factor !== null && row.profit_factor >= 1.15 &&
    row.expectancy_R !== null && row.expectancy_R >= 0.05 &&
    row.max_drawdown_pct !== null && row.max_drawdown_pct <= 5);
}

function fmt(v, digits = 3) {
  return v === null || v === undefined ? 'n/a' : Number(v).toFixed(digits);
}

async function runOne(mode, window) {
  const outputDir = path.join(OUT_DIR, window.id, mode.id);
  await fs.mkdir(outputDir, { recursive: true });
  const env = {
    ...process.env,
    GOLD_BACKTEST_DATA_FILE: DATA_FILE,
    GOLD_BACKTEST_OUTPUT_DIR: outputDir,
    GOLD_BACKTEST_LOOKBACK_DAYS: String(window.days),
    GOLD_BACKTEST_INITIAL_EQUITY: String(INITIAL_EQUITY),
    GOLD_BACKTEST_RISK_PCT: String(RISK_PCT),
    GOLD_BACKTEST_SERVER_TIMEZONE: 'Europe/Nicosia',
    GOLD_H1_TREND_MODE: mode.env,
    GOLD_H1_MODE_STUDY_RUN: 'true'
  };
  delete env.GOLD_STRATEGY_JSON;
  const execution = spawnSync(process.execPath, [ENGINE], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 30 * 60 * 1000
  });
  if (execution.stdout) process.stdout.write(execution.stdout);
  if (execution.stderr) process.stderr.write(execution.stderr);
  if (execution.error) throw execution.error;
  assert(execution.status === 0, `Backtest failed mode=${mode.id} window=${window.id} status=${execution.status}`);

  const report = await readJson(path.join(outputDir, 'gold_v2_backtest_report.json'));
  const gapReport = await readJson(path.join(outputDir, 'gap-policy-comparison', 'gold_v2_gap_policy_comparison.json'));
  const outputRows = COSTS.map((cost) => summarize(mode, window, cost, report, gapReport));
  return {
    mode: mode.id,
    mode_label: mode.label,
    window: { ...window, data_start_utc: report.source_period.m5_first, data_end_utc: report.source_period.m5_last },
    strategy_parameters: report.strategy_parameters,
    data: report.data_quality,
    candidate_funnel_baseline: {
      signals_evaluated: report.results.baseline.signals_evaluated,
      candidates: report.results.baseline.candidates,
      candidates_buy: report.results.baseline.candidates_buy,
      candidates_sell: report.results.baseline.candidates_sell,
      funnel_diagnostics: report.results.baseline.funnel_diagnostics
    },
    rows: outputRows,
    raw_report_path: path.relative(ROOT, path.join(outputDir, 'gold_v2_backtest_report.json')),
    gap_report_path: path.relative(ROOT, path.join(outputDir, 'gap-policy-comparison', 'gold_v2_gap_policy_comparison.json'))
  };
}

async function main() {
  assert(DATA_FILE, 'GOLD_BACKTEST_DATA_FILE is required; use the validated prepared five-year M5 dataset.');
  await fs.access(DATA_FILE);
  await fs.mkdir(OUT_DIR, { recursive: true });

  const runs = [];
  for (const window of WINDOWS) {
    for (const mode of MODES) {
      console.log(`\n=== H1 mode study: ${mode.id}, ${window.id} (${window.days} days) ===`);
      runs.push(await runOne(mode, window));
    }
  }

  const rows = runs.flatMap((run) => run.rows);
  const baselineRows = rows.filter((row) => row.cost_model === 'baseline');
  const byKey = new Map(baselineRows.map((row) => [row.window + '|' + row.mode, row]));
  const comparisons = WINDOWS.map((window) => {
    const strict = byKey.get(window.id + '|strict');
    const ablation = byKey.get(window.id + '|close_ema20_rsi');
    return {
      window: window.id,
      days: window.days,
      comparison_valid: Boolean(strict?.summary_valid_for_full_window && ablation?.summary_valid_for_full_window),
      strict: strict ? {
        trades: strict.trades, candidates: strict.candidates,
        profit_factor: strict.profit_factor, expectancy_R: strict.expectancy_R,
        return_pct: strict.return_pct, max_drawdown_pct: strict.max_drawdown_pct,
        quality_gate_5y: window.id === 'five_year' ? qualityGate(strict) : null
      } : null,
      close_ema20_rsi: ablation ? {
        trades: ablation.trades, candidates: ablation.candidates,
        profit_factor: ablation.profit_factor, expectancy_R: ablation.expectancy_R,
        return_pct: ablation.return_pct, max_drawdown_pct: ablation.max_drawdown_pct,
        quality_gate_5y: window.id === 'five_year' ? qualityGate(ablation) : null
      } : null
    };
  });

  const result = {
    status: 'RESEARCH_ONLY_FIXED_ONE_FACTOR_COMPARISON',
    generated_at: new Date().toISOString(),
    no_production_changes: true,
    real_orders_enabled: false,
    render_deployment_performed: false,
    data_source: {
      provider: 'Dukascopy Historical Data Feed',
      instrument: 'XAUUSD',
      timeframe: 'M5',
      note: 'Same prepared dataset for all four runs; this is not XM native quote data.'
    },
    frozen_factor: {
      only_factor: 'H1 trend classification mode',
      strict: 'H1 close/EMA20 confirmation plus EMA20/EMA50/EMA200 ordered stack plus existing H1 RSI band',
      research_ablation: 'H1 close vs EMA20 plus the same existing H1 RSI band; remove only EMA stack requirement',
      other_parameters: 'All M5 filters, RR admission, SL/TP, session, risk, costs, timezone and XM-aware gap policy held fixed.',
      holdout_policy: 'The recent 730-day window is separately rerun with initial equity and risk state reset while using the full historic bars only for causal indicator warm-up. The recent window will be considered inspected after this study and must not be reused as unseen holdout for subsequent variations.',
      no_threshold_sweep: true
    },
    metrics: rows,
    comparisons,
    interpretation_guardrails: [
      'An unverified data gap makes the affected schedule-aware window partial/invalid; never interpret its partial PF or expectancy as a full-window result.',
      'More candidates alone is not evidence of quality. Compare expectancy, PF, drawdown, trade count, and baseline versus conservative costs.',
      'The alternative is an ablation study, not a recommended production configuration. No live configuration is changed by this script.'
    ]
  };

  await fs.writeFile(path.join(OUT_DIR, 'gold-v2-h1-mode-study.json'), JSON.stringify(result, null, 2));
  const md = [
    '# GOLD V2 H1 trend-mode one-factor study',
    '',
    'Research only. Real orders remain OFF; no Render deployment or production configuration change was made.',
    '',
    'Factor under test: strict H1 EMA20/50/200 stack versus a pre-existing research-only mode that keeps H1 close/EMA20 and the same RSI band but removes the ordered-stack requirement. M5 filters, entry/SL/TP, effective RR, session, risk and modeled costs are held fixed.',
    '',
    '## Results (XM scheduled-gap-aware portfolio policy)',
    '',
    '| Window | Mode | Cost | Valid complete window? | Trades | Candidates | PF | Expectancy (R) | Return | Max DD |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map((row) => `| ${row.window} | ${row.mode} | ${row.cost_model} | ${row.summary_valid_for_full_window} | ${row.trades} | ${row.candidates} | ${fmt(row.profit_factor)} | ${fmt(row.expectancy_R)} | ${fmt(row.return_pct, 3)}% | ${fmt(row.max_drawdown_pct, 3)}% |`),
    '',
    '## One-factor comparison',
    '',
    ...comparisons.flatMap((c) => [
      `### ${c.window} (${c.days} days)`,
      '',
      `- Complete valid comparison: **${c.comparison_valid}**`,
      `- Strict: trades=${c.strict?.trades ?? 'n/a'}, PF=${fmt(c.strict?.profit_factor)}, expectancy=${fmt(c.strict?.expectancy_R)}R`,
      `- H1 stack ablation: trades=${c.close_ema20_rsi?.trades ?? 'n/a'}, PF=${fmt(c.close_ema20_rsi?.profit_factor)}, expectancy=${fmt(c.close_ema20_rsi?.expectancy_R)}R`,
      ''
    ]),
    '## Interpretation limits',
    '',
    '- The most recent 730-day window is inspected as part of this experiment. It is no longer an untouched holdout for any follow-up variant.',
    '- If any row is censored at an unverified data gap, its partial metrics are not a five-year or full-window portfolio result.',
    '- These bars come from Dukascopy, not the XM MT4 account stream; spread/slippage and gap execution remain model assumptions.',
    '- Do not promote a mode solely because it increases candidate or trade count. The existing five-year quality gate still requires at least 30 trades, PF >= 1.15, expectancy >= 0.05R and max drawdown <= 5%, plus the existing recent-activity and positive-year checks.',
    '- No threshold search and no production update are part of this study.'
  ].join('\n');
  await fs.writeFile(path.join(OUT_DIR, 'gold-v2-h1-mode-study.md'), md);

  console.log('\n=== H1 MODE STUDY SUMMARY ===');
  console.log(JSON.stringify(comparisons, null, 2));
}

main().catch((error) => {
  console.error('GOLD V2 H1 MODE STUDY FAILED:', error?.stack || error);
  process.exitCode = 1;
});
