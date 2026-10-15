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
const outputDir = path.resolve(args.get('output-dir') || process.env.GOLD_RR_SENSITIVITY_OUTPUT_DIR || 'gold-backtest-output/rr-sensitivity');
const dataFile = path.resolve(args.get('data-file') || process.env.GOLD_BACKTEST_DATA_FILE || '');
const engine = path.join(__dirname, 'backtest-gold-v2.mjs');
const cases = [
  { floor: 1.30, name: 'rr-1-30' },
  { floor: 1.50, name: 'rr-1-50' },
  { floor: 1.70, name: 'rr-1-70' },
  { floor: 1.90, name: 'rr-1-90' }
];

if (!args.has('data-file') && !process.env.GOLD_BACKTEST_DATA_FILE) {
  throw new Error('A prepared dataset is required. Set GOLD_BACKTEST_DATA_FILE or --data-file.');
}
await fs.access(dataFile);
await fs.access(engine);
await fs.mkdir(outputDir, { recursive: true });

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

async function readTrades(file, floor, label, expectedCount) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  if (!lines[0]) throw new Error(label + ': trade CSV is empty');
  const headers = parseCsvLine(lines[0]);
  const rrIndex = headers.indexOf('effective_rr');
  if (rrIndex < 0) throw new Error(label + ': effective_rr column is missing');
  const rows = lines.slice(1).filter(Boolean).map(parseCsvLine);
  if (rows.length !== Number(expectedCount)) {
    throw new Error(label + ': CSV trade count ' + rows.length + ' differs from report count ' + expectedCount);
  }
  let missing = 0;
  let violations = 0;
  let minRR = null;
  for (const row of rows) {
    const rr = Number(row[rrIndex]);
    if (!Number.isFinite(rr)) {
      missing++;
      continue;
    }
    minRR = minRR === null ? rr : Math.min(minRR, rr);
    if (rr + 1e-9 < floor) violations++;
  }
  if (missing || violations) {
    throw new Error(label + ': RR integrity failed; missing=' + missing + ', below_floor=' + violations + ', floor=' + floor);
  }
  return { trades: rows.length, min_effective_rr: minRR, missing_rr: missing, floor_violations: violations };
}

function stable(value) {
  return JSON.stringify(value);
}

function requireSame(actual, expected, label) {
  if (stable(actual) !== stable(expected)) {
    throw new Error('Sensitivity variants do not share the same ' + label);
  }
}

function cleanAssumptions(assumptions) {
  const copy = { ...assumptions };
  delete copy.minimum_effective_reward_risk;
  return copy;
}

const rows = [];
let referenceReport = null;
let referenceConfig = null;

for (const item of cases) {
  const variantDir = path.join(outputDir, item.name);
  await fs.mkdir(variantDir, { recursive: true });
  const childEnv = {
    ...process.env,
    GOLD_BACKTEST_DATA_FILE: dataFile,
    GOLD_BACKTEST_OUTPUT_DIR: variantDir,
    GOLD_BACKTEST_MIN_EFFECTIVE_RR: String(item.floor)
  };
  delete childEnv.GOLD_TEST_STOP_AFTER_BARS;
  const run = spawnSync(process.execPath, [engine], {
    cwd: repoRoot,
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (run.error) throw new Error(item.name + ': engine failed to start: ' + run.error.message);
  if (run.status !== 0) {
    throw new Error(item.name + ': engine exited ' + run.status + '\nSTDOUT:\n' + String(run.stdout).slice(-6000) + '\nSTDERR:\n' + String(run.stderr).slice(-6000));
  }

  const reportPath = path.join(variantDir, 'gold_v2_backtest_report.json');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const actualFloor = Number(report.assumptions?.minimum_effective_reward_risk);
  if (!Number.isFinite(actualFloor) || Math.abs(actualFloor - item.floor) > 1e-9) {
    throw new Error(item.name + ': report does not record the requested RR floor');
  }

  const config = {
    strategy_parameters: report.strategy_parameters,
    data_quality: report.data_quality,
    source_period: report.source_period,
    server_timezone: report.server_timezone,
    cost_scenarios: report.cost_scenarios,
    fixed_assumptions: cleanAssumptions(report.assumptions)
  };
  if (referenceConfig === null) {
    referenceReport = report;
    referenceConfig = config;
  } else {
    for (const key of Object.keys(config)) requireSame(config[key], referenceConfig[key], key);
  }

  const baseline = report.results?.baseline;
  const conservative = report.results?.conservative;
  if (!baseline?.summary || !conservative?.summary) {
    throw new Error(item.name + ': baseline or conservative summary is missing');
  }

  const baselineIntegrity = await readTrades(
    path.join(variantDir, 'gold_v2_trades_baseline.csv'),
    item.floor,
    item.name + ' baseline',
    baseline.summary.trades
  );
  const conservativeIntegrity = await readTrades(
    path.join(variantDir, 'gold_v2_trades_conservative.csv'),
    item.floor,
    item.name + ' conservative',
    conservative.summary.trades
  );

  rows.push({
    rr_floor: item.floor,
    variant: item.name,
    five_year_trades: baseline.summary.trades,
    five_year_wins: baseline.summary.wins,
    five_year_losses: baseline.summary.losses,
    five_year_pf: baseline.summary.profit_factor,
    five_year_expectancy_R: baseline.summary.expectancy_R,
    five_year_return_pct: baseline.summary.return_pct,
    five_year_maxDD_pct: baseline.summary.max_drawdown_pct,
    is1095_trades: baseline.is1095.trades,
    is1095_pf: baseline.is1095.profit_factor,
    is1095_expectancy_R: baseline.is1095.expectancy_R,
    oos730_trades: baseline.oos730.trades,
    oos730_pf: baseline.oos730.profit_factor,
    oos730_expectancy_R: baseline.oos730.expectancy_R,
    recent365_trades: baseline.recent365.trades,
    recent365_pf: baseline.recent365.profit_factor,
    recent365_expectancy_R: baseline.recent365.expectancy_R,
    conservative_trades: conservative.summary.trades,
    conservative_pf: conservative.summary.profit_factor,
    conservative_expectancy_R: conservative.summary.expectancy_R,
    conservative_maxDD_pct: conservative.summary.max_drawdown_pct,
    candidates: baseline.candidates,
    rejected_effective_rr: baseline.rejected_effective_rr,
    baseline_min_effective_rr: baselineIntegrity.min_effective_rr,
    baseline_rr_floor_violations: baselineIntegrity.floor_violations,
    conservative_min_effective_rr: conservativeIntegrity.min_effective_rr,
    conservative_rr_floor_violations: conservativeIntegrity.floor_violations,
    quality_gate_passed: Boolean(baseline.qualityGate?.passed)
  });

  console.log('RR_SENSITIVITY_VARIANT_PASS', JSON.stringify({
    floor: item.floor,
    trades_5y: baseline.summary.trades,
    pf_5y: baseline.summary.profit_factor,
    expectancy_R_5y: baseline.summary.expectancy_R,
    trades_oos730: baseline.oos730.trades,
    pf_oos730: baseline.oos730.profit_factor,
    expectancy_R_oos730: baseline.oos730.expectancy_R,
    conservative_trades: conservative.summary.trades,
    conservative_expectancy_R: conservative.summary.expectancy_R,
    baseline_rr_violations: baselineIntegrity.floor_violations,
    conservative_rr_violations: conservativeIntegrity.floor_violations,
    quality_gate_passed: Boolean(baseline.qualityGate?.passed)
  }));
}

const result = {
  generated_at: new Date().toISOString(),
  research_only: true,
  production_settings_changed: false,
  experiment: {
    independent_variable: 'minimum_effective_reward_risk',
    tested_values: cases.map(x => x.floor),
    fixed_conditions: 'Same prepared dataset, strategy filters, timezone, entry/exit model, risk sizing, daily/drawdown limits, baseline costs and conservative costs. Only the minimum effective RR admission floor varies.',
    periods: {
      full: 'Full prepared five-year dataset',
      is1095: 'First 1,095 days before the OOS window',
      oos730: 'Last 730 days of the prepared dataset',
      recent365: 'Last 365 days of the prepared dataset'
    },
    conservative_costs: 'Spread is at least 0.75 and slippage is at least 0.10 in price units.',
    caveat: 'This sensitivity is descriptive only. With low trade counts, do not pick a production threshold or infer durable profitability from these results.'
  },
  dataset: {
    instrument: referenceReport.instrument,
    source_period: referenceReport.source_period,
    rows: referenceReport.data_quality?.rows,
    timezone: referenceReport.server_timezone,
    data_source: referenceReport.data_source
  },
  fixed_strategy_parameters: referenceReport.strategy_parameters,
  fixed_assumptions: cleanAssumptions(referenceReport.assumptions),
  fixed_cost_scenarios: referenceReport.cost_scenarios,
  results: rows
};

await fs.writeFile(path.join(outputDir, 'gold_v2_rr_sensitivity.json'), JSON.stringify(result, null, 2));

const fields = Object.keys(rows[0]);
const csvEscape = value => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};
const csv = [fields.join(','), ...rows.map(row => fields.map(field => csvEscape(row[field])).join(','))].join('\n') + '\n';
await fs.writeFile(path.join(outputDir, 'gold_v2_rr_sensitivity.csv'), csv);

const f = value => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'N/A';
  return Number(value).toFixed(3);
};
const markdown = [
  '# GOLD V2 effective-RR sensitivity (research only)',
  '',
  '**Production settings were not changed.** The only independent variable is the minimum effective risk/reward floor. The dataset, timezone, strategy filters, execution assumptions, risk sizing and cost scenarios are held fixed.',
  '',
  '- Full period: prepared five-year XAUUSD M5 dataset.',
  '- IS: first 1,095 days before OOS; OOS: last 730 days; recent: last 365 days.',
  '- Conservative costs: spread at least 0.75 and slippage at least 0.10 in price units.',
  '- All returned trades must have an effective RR at or above their requested floor.',
  '- A low number of trades is not evidence of robustness. This experiment does not authorize a production threshold change.',
  '',
  '| RR floor | 5y trades | 5y PF | 5y Exp (R) | 5y MaxDD % | IS trades | IS Exp (R) | OOS trades | OOS PF | OOS Exp (R) | Recent365 trades | Conservative PF | Conservative Exp (R) | Quality gate |',
  '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|'
];
for (const row of rows) {
  markdown.push('| ' + [
    f(row.rr_floor, 2),
    f(row.five_year_trades, 0),
    f(row.five_year_pf),
    f(row.five_year_expectancy_R),
    f(row.five_year_maxDD_pct),
    f(row.is1095_trades, 0),
    f(row.is1095_expectancy_R),
    f(row.oos730_trades, 0),
    f(row.oos730_pf),
    f(row.oos730_expectancy_R),
    f(row.recent365_trades, 0),
    f(row.conservative_pf),
    f(row.conservative_expectancy_R),
    row.quality_gate_passed ? 'PASS' : 'FAIL'
  ].join(' | ') + ' |');
}
markdown.push('', '## Rejection and integrity diagnostics', '', '| RR floor | 5y candidates | Rejected by RR floor | Baseline floor violations | Conservative floor violations |', '|---:|---:|---:|---:|---:|');
for (const row of rows) {
  markdown.push('| ' + [
    f(row.rr_floor, 2),
    f(row.candidates, 0),
    f(row.rejected_effective_rr, 0),
    f(row.baseline_rr_floor_violations, 0),
    f(row.conservative_rr_floor_violations, 0)
  ].join(' | ') + ' |');
}
markdown.push('', '## Interpretation guardrails', '', '1. No threshold is promoted to production by this report.', '2. If all variants have very few trades, investigate candidate scarcity and filter distributions before tuning thresholds.', '3. If IS and OOS results disagree, treat the threshold as unstable rather than selecting the most attractive full-period PF.', '');
await fs.writeFile(path.join(outputDir, 'gold_v2_rr_sensitivity.md'), markdown.join('\n'));

console.log('GOLD V2 RR SENSITIVITY PASS', JSON.stringify({
  floors_tested: rows.map(row => row.rr_floor),
  variants: rows.length,
  source_rows: result.dataset.rows,
  source_period: result.dataset.source_period,
  output: outputDir,
  json: path.join(outputDir, 'gold_v2_rr_sensitivity.json'),
  csv: path.join(outputDir, 'gold_v2_rr_sensitivity.csv'),
  markdown: path.join(outputDir, 'gold_v2_rr_sensitivity.md')
}));
