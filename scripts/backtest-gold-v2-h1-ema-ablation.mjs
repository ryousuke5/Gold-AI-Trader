import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(process.env.GOLD_H1_ABLATION_SOURCE_DIR || path.join(ROOT, 'gold-v2-walkforward'));
const OUTPUT_DIR = path.resolve(process.env.GOLD_H1_ABLATION_OUTPUT_DIR || path.join(ROOT, 'gold-h1-ema-ablation-output'));

const VARIANTS = [
  { name: 'A_strict', mode: 'strict', description: 'Keep EMA20/EMA50 and EMA50/EMA200 ordering' },
  { name: 'B_keep_ema20_ema50', mode: 'keep_ema20_ema50', description: 'Keep EMA20/EMA50 ordering; remove EMA50/EMA200 ordering' },
  { name: 'C_keep_ema50_ema200', mode: 'keep_ema50_ema200', description: 'Keep EMA50/EMA200 ordering; remove EMA20/EMA50 ordering' },
  { name: 'D_close_ema20_rsi', mode: 'close_ema20_rsi', description: 'Remove both EMA ordering requirements; retain close-vs-EMA20 and H1 RSI' }
];

const PERIODS = [
  { name: 'IS_3Y', file: 'is_data.json.gz', days: 1095 },
  { name: 'OOS_2Y', file: 'oos_data.json.gz', days: 730 }
];

function round(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function summarizeCost(result) {
  const s = result?.summary || {};
  return {
    trades: Number(s.trades || 0),
    wins: Number(s.wins || 0),
    losses: Number(s.losses || 0),
    win_rate_pct: round(s.win_rate_pct, 2),
    profit_factor: round(s.profit_factor, 4),
    expectancy_R: round(s.expectancy_R, 4),
    total_R: round(s.total_R, 4),
    max_drawdown_pct: round(s.max_drawdown_pct, 4),
    net_profit: round(s.net_profit, 2),
    candidates: Number(result?.candidates || 0),
    candidates_buy: Number(result?.candidates_buy || 0),
    candidates_sell: Number(result?.candidates_sell || 0),
    signals_evaluated: Number(result?.signals_evaluated || 0),
    wait_reasons: result?.setup_wait_reasons || {},
    risk_gate_blocks: result?.risk_gate_blocks || {}
  };
}

function passesIsScreen(conservative, positiveYears) {
  return Boolean(
    conservative.trades >= 20 &&
    conservative.profit_factor !== null &&
    conservative.profit_factor >= 1.05 &&
    conservative.expectancy_R !== null &&
    conservative.expectancy_R >= 0.05 &&
    conservative.max_drawdown_pct !== null &&
    conservative.max_drawdown_pct <= 5 &&
    positiveYears >= 2
  );
}

async function inspectData(file, expectedDays) {
  const bytes = await fs.readFile(file);
  const rows = JSON.parse(gunzipSync(bytes).toString('utf8'));
  if (!Array.isArray(rows) || rows.length < 200000) {
    throw new Error(`Invalid or insufficient prepared dataset: ${file} (${rows?.length ?? 'not-array'} rows)`);
  }
  const first = Number(rows[0].time);
  const last = Number(rows.at(-1).time);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    throw new Error(`Invalid time bounds in ${file}`);
  }
  return {
    file: path.basename(file),
    rows: rows.length,
    first_bar_utc: new Date(first * 1000).toISOString(),
    last_bar_open_utc: new Date(last * 1000).toISOString(),
    evaluation_days: expectedDays
  };
}

async function runVariant(period, variant) {
  const dataFile = path.join(SOURCE_DIR, period.file);
  const outDir = path.join(OUTPUT_DIR, period.name, variant.name);
  await fs.mkdir(outDir, { recursive: true });

  const env = {
    ...process.env,
    GOLD_BACKTEST_DATA_FILE: dataFile,
    GOLD_BACKTEST_OUTPUT_DIR: outDir,
    GOLD_BACKTEST_LOOKBACK_DAYS: String(period.days),
    GOLD_BACKTEST_IS_ONLY: 'false',
    GOLD_BACKTEST_STRATEGY_VARIANT: 'breakout_v2',
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
    GOLD_SESSION_START_UTC: '7',
    GOLD_SESSION_END_UTC: '20',
    GOLD_H1_TREND_MODE: variant.mode
  };
  delete env.GOLD_STRATEGY_JSON;

  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'backtest-gold-v2.mjs'), `--lookback-days=${period.days}`], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024
  });

  const reportPath = path.join(outDir, 'gold_v2_backtest_report.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const appliedMode = report.strategy_parameters?.h1TrendMode || 'strict';
  if (appliedMode !== variant.mode) {
    throw new Error(`H1 mode mismatch for ${variant.name}: requested ${variant.mode}, backtester applied ${appliedMode}`);
  }
  const baseline = summarizeCost(report.results?.baseline);
  const conservative = summarizeCost(report.results?.conservative);
  const positiveYears = Number(report.results?.conservative?.positiveYears || 0);

  return {
    variant: variant.name,
    h1_mode: variant.mode,
    description: variant.description,
    period: period.name,
    days: period.days,
    baseline,
    conservative,
    conservative_positive_years: positiveYears,
    conservative_is_screen_pass: period.name === 'IS_3Y' ? passesIsScreen(conservative, positiveYears) : null,
    output_report: path.relative(OUTPUT_DIR, reportPath)
  };
}

function toMarkdown(report) {
  const lines = [
    '# GOLD V2 H1 EMA Component Ablation',
    '',
    '**Research-only. No production configuration is changed. No variant is automatically selected or promoted.**',
    '',
    `Source Walk-Forward run: ${report.source_walkforward_run_id}`,
    `Data periods: IS ${report.periods.IS_3Y.first_bar_utc} to ${report.periods.IS_3Y.last_bar_open_utc}; OOS ${report.periods.OOS_2Y.first_bar_utc} to ${report.periods.OOS_2Y.last_bar_open_utc}`,
    '',
    'All variants use identical M5 rules, session (UTC 07–20), risk (0.25%), and transaction costs. Baseline costs: spread 0.50 / slippage 0.05. Conservative costs: spread 0.75 / slippage 0.10.',
    '',
    '## Conservative-cost comparison',
    '',
    '| Variant | Period | Trades | PF | Exp (R) | Max DD % | Candidates | IS screen |',
    '|---|---|---:|---:|---:|---:|---:|---|'
  ];
  for (const row of report.results) {
    const m = row.conservative;
    lines.push(`| ${row.variant} | ${row.period} | ${m.trades} | ${m.profit_factor ?? 'NA'} | ${m.expectancy_R ?? 'NA'} | ${m.max_drawdown_pct ?? 'NA'} | ${m.candidates} | ${row.conservative_is_screen_pass === null ? 'Evaluation only' : row.conservative_is_screen_pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push(
    '',
    '## Interpretation guardrails',
    '',
    '- The four H1 modes were fixed before looking at OOS results.',
    '- OOS is an evaluation set only; it is not used to select a variant or adjust thresholds.',
    '- An IS screen pass is only a research eligibility check, not evidence of live readiness.',
    '- Low trade counts make PF and expectancy unstable; report trade counts beside every metric.',
    '- If no variant has sufficient IS sample and conservative-cost performance, keep GOLD V2 Strict unchanged and collect more forward evidence.',
    '',
    '## First rejection reasons',
    ''
  );
  for (const row of report.results) {
    const reasons = Object.entries(row.conservative.wait_reasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => `${name}: ${count}`)
      .join('; ');
    lines.push(`- **${row.variant} / ${row.period}:** ${reasons || 'none'}`);
  }
  return lines.join('\n') + '\n';
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const periodData = {};
  for (const period of PERIODS) {
    periodData[period.name] = await inspectData(path.join(SOURCE_DIR, period.file), period.days);
  }

  const results = [];
  for (const period of PERIODS) {
    for (const variant of VARIANTS) {
      console.log(`Running ${variant.name} / ${period.name}`);
      results.push(await runVariant(period, variant));
    }
  }

  const report = {
    title: 'GOLD V2 H1 EMA Component Ablation',
    methodology: 'Pre-registered four-mode H1 component ablation; separate fixed 3-year IS and 2-year OOS evaluation',
    source_walkforward_run_id: process.env.GOLD_H1_ABLATION_SOURCE_RUN_ID || '43349812731',
    no_oos_tuning: true,
    automatic_variant_selection: false,
    production_changed: false,
    production_settings: {
      strategy: 'GOLD V2 Strict',
      range_atr: '0.80-2.80',
      risk_pct: 0.25,
      spread_limit_price: 0.50,
      runtime_mode: 'ANALYSIS',
      auto_trading_enabled: false,
      real_order_gate: 'OFF'
    },
    periods: periodData,
    variants: VARIANTS,
    results
  };

  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_h1_ema_ablation_report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_h1_ema_ablation_report.md'), toMarkdown(report));
  console.log(JSON.stringify({
    completed: results.length,
    variants: VARIANTS.map(v => v.name),
    periods: PERIODS.map(p => p.name),
    is_eligible_variants: results.filter(r => r.period === 'IS_3Y' && r.conservative_is_screen_pass).map(r => r.variant),
    oos_used_for_selection: false
  }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
