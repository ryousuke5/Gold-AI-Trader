import fs from 'node:fs/promises';
import path from 'node:path';

const inputRoot = path.resolve(process.env.EURUSD_SPREAD_ARTIFACT_DIR || 'eurusd-spread-sensitivity-artifacts');
const outputRoot = path.resolve(process.env.EURUSD_SPREAD_REPORT_DIR || 'eurusd-spread-sensitivity-report');

async function walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && entry.name === 'summary.json') files.push(full);
  }
  return files;
}

function fmt(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toFixed(digits);
}
function csv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

const summaryFiles = (await walk(inputRoot)).sort();
if (!summaryFiles.length) throw new Error('No summary.json artifacts found under ' + inputRoot);

const scenarios = [];
for (const file of summaryFiles) {
  const report = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!report.overall || !report.fixed_five_year_validation?.oos_period) {
    throw new Error('Incomplete backtest report: ' + file);
  }
  scenarios.push({
    file: path.relative(inputRoot, file),
    scenario: report.scenario?.name || path.basename(path.dirname(file)),
    type: report.scenario?.type || 'unspecified',
    assumedSpread: Number(report.execution?.spread_pips),
    gateLimit: Number(report.parameters?.maxSpreadPips),
    atrGateLimit: Number(report.parameters?.maxSpreadAtrPct),
    spreadGate: report.diagnostics?.spread_gate_breakdown || {},
    bars: Number(report.data?.bars) || 0,
    provenance: report.data?.provenance || null,
    overall: report.overall,
    is: report.fixed_five_year_validation.is_period,
    oos: report.fixed_five_year_validation.oos_period,
    recent365: report.recent_365_days,
    h1: report.diagnostics?.h1_trend_breakdown || {},
    h1Up: Number(report.diagnostics?.h1_up) || 0,
    h1Down: Number(report.diagnostics?.h1_down) || 0,
    h1Range: Number(report.diagnostics?.h1_range) || 0,
    waitReasons: report.diagnostics?.wait_reasons || {}
  });
}
scenarios.sort((a,b) =>
  a.type.localeCompare(b.type) ||
  a.assumedSpread - b.assumedSpread ||
  a.gateLimit - b.gateLimit
);
const provenanceHashes = new Set(scenarios.map(s => s.provenance?.sha256_gzip || 'missing'));
if (provenanceHashes.size !== 1 || provenanceHashes.has('missing')) {
  throw new Error('Backtest scenarios must share one validated dataset manifest and SHA-256: ' + [...provenanceHashes].join(', '));
}

const jsonOut = {
  generated_at: new Date().toISOString(),
  scenario_count: scenarios.length,
  historical_spread_data_available: false,
  dataset_provenance: scenarios[0]?.provenance || null,
  caveat: 'OHLCV replay uses constant assumed spread per scenario. It cannot reconstruct historical broker spread by timestamp. Treat results as cost sensitivity, not a reconstruction of historical XM execution.',
  scenarios
};
await fs.mkdir(outputRoot, { recursive: true });
await fs.writeFile(path.join(outputRoot, 'eurusd_spread_sensitivity.json'), JSON.stringify(jsonOut, null, 2) + '\n');

const headers = [
  'scenario','type','assumed_spread_pips','max_spread_gate_pips','max_spread_atr_gate_pct','bars',
  'overall_trades','overall_pf','overall_expectancy_r','overall_net_r','overall_max_dd_r',
  'is_trades','is_pf','is_expectancy_r','is_net_r','is_max_dd_r',
  'oos_trades','oos_pf','oos_expectancy_r','oos_net_r','oos_max_dd_r',
  'recent365_trades','pips_gate_failed_bars','pips_gate_failed_pct','atr_gate_failed_bars','atr_gate_failed_pct','both_spread_gates_failed_bars','pips_only_failed_bars','atr_only_failed_bars','passed_both_spread_gates_bars','spread_atr_pct_median','spread_atr_pct_p90','spread_atr_pct_p95',
  'h1_up_bars','h1_down_bars','h1_range_bars',
  'bullish_ema_stack_bars','bearish_ema_stack_bars','mixed_ema_stack_bars',
  'bullish_stack_rejected_by_close','bearish_stack_rejected_by_close','h1_trend_not_clear_waits',
  'spread_filter_failed_waits'
];
const rows = scenarios.map(s => [
  s.scenario,s.type,s.assumedSpread,s.gateLimit,s.atrGateLimit,s.bars,
  s.overall.trades,s.overall.profit_factor,s.overall.expectancy_r,s.overall.net_r,s.overall.max_drawdown_r,
  s.is.trades,s.is.profit_factor,s.is.expectancy_r,s.is.net_r,s.is.max_drawdown_r,
  s.oos.trades,s.oos.profit_factor,s.oos.expectancy_r,s.oos.net_r,s.oos.max_drawdown_r,
  s.recent365.trades,
  s.spreadGate.pips_gate_failed_bars,s.spreadGate.pips_gate_failed_pct,s.spreadGate.atr_gate_failed_bars,s.spreadGate.atr_gate_failed_pct,s.spreadGate.both_gates_failed_bars,s.spreadGate.pips_only_failed_bars,s.spreadGate.atr_only_failed_bars,s.spreadGate.passed_both_gates_bars,s.spreadGate.spread_atr_pct_distribution?.median,s.spreadGate.spread_atr_pct_distribution?.p90,s.spreadGate.spread_atr_pct_distribution?.p95,
  s.h1Up,s.h1Down,s.h1Range,
  s.h1.bullish_ema_stack,s.h1.bearish_ema_stack,s.h1.mixed_ema_stack,
  s.h1.bullish_stack_rejected_by_close,s.h1.bearish_stack_rejected_by_close,
  s.waitReasons.h1_trend_not_clear || 0,s.waitReasons.spread_filter_failed || 0
]);
await fs.writeFile(path.join(outputRoot, 'eurusd_spread_sensitivity.csv'),
  [headers.map(csv).join(','), ...rows.map(row => row.map(csv).join(','))].join('\n') + '\n');

const md = [
  '# EURUSD Spread Sensitivity and H1 Trend Diagnostics',
  '',
  'Generated: ' + jsonOut.generated_at,
  '',
  '> Important limitation: The replay source is M15 OHLCV and does not contain historical bid/ask spreads. Each scenario applies a constant assumed spread to both the setup gate and simulated costs (except cost-only scenarios, whose pips gate is set at 2.50). This is a sensitivity analysis, not actual historical spread replay.',
  '',
  '## Dataset provenance',
  '',
  '| Field | Value |',
  '|---|---|',
  '| Source type | ' + String(scenarios[0].provenance.source_type || 'unknown') + ' |',
  '| Source run | ' + String(scenarios[0].provenance.source_run_id ?? 'fresh provider fetch') + ' |',
  '| Validated at UTC | ' + String(scenarios[0].provenance.validated_at_utc || 'unknown') + ' |',
  '| First bar | ' + String(scenarios[0].provenance.first_bar_open_utc || 'unknown') + ' |',
  '| Last bar close | ' + String(scenarios[0].provenance.last_bar_close_utc || 'unknown') + ' |',
  '| Bars / coverage | ' + String(scenarios[0].provenance.bars) + ' / ' + fmt(scenarios[0].provenance.coverage_pct, 2) + '% |',
  '| SHA-256 | ' + String(scenarios[0].provenance.sha256_gzip || 'missing') + ' |',
  '',
  '## Scenario comparison',
  '',
  '| Scenario | Type | Assumed spread | Pips gate | Trades (all) | PF (all) | Expectancy (all) | IS trades | IS PF | IS expectancy | OOS trades | OOS PF | OOS expectancy | OOS max DD |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...scenarios.map(s => '| ' + s.scenario + ' | ' + s.type + ' | ' + fmt(s.assumedSpread,2) + ' | ' + fmt(s.gateLimit,2) + ' | ' + s.overall.trades + ' | ' + fmt(s.overall.profit_factor,2) + ' | ' + fmt(s.overall.expectancy_r,3) + ' R | ' + s.is.trades + ' | ' + fmt(s.is.profit_factor,2) + ' | ' + fmt(s.is.expectancy_r,3) + ' R | ' + s.oos.trades + ' | ' + fmt(s.oos.profit_factor,2) + ' | ' + fmt(s.oos.expectancy_r,3) + ' R | ' + fmt(s.oos.max_drawdown_r,2) + ' R |'),
  '',
  '## Spread gate decomposition',
  '',
  '| Scenario | Pips limit | ATR limit | Pips fail | ATR fail | Both fail | Pips-only fail | ATR-only fail | Pass both | ATR% median | ATR% P90 | ATR% P95 |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...scenarios.map(s => '| ' + s.scenario + ' | ' + fmt(s.spreadGate.pips_limit_pips,2) + ' | ' + fmt(s.spreadGate.atr_limit_pct,1) + '% | ' + (s.spreadGate.pips_gate_failed_bars ?? '—') + ' (' + fmt(s.spreadGate.pips_gate_failed_pct,1) + '%) | ' + (s.spreadGate.atr_gate_failed_bars ?? '—') + ' (' + fmt(s.spreadGate.atr_gate_failed_pct,1) + '%) | ' + (s.spreadGate.both_gates_failed_bars ?? '—') + ' | ' + (s.spreadGate.pips_only_failed_bars ?? '—') + ' | ' + (s.spreadGate.atr_only_failed_bars ?? '—') + ' | ' + (s.spreadGate.passed_both_gates_bars ?? '—') + ' (' + fmt(s.spreadGate.passed_both_gates_pct,1) + '%) | ' + fmt(s.spreadGate.spread_atr_pct_distribution?.median,1) + '% | ' + fmt(s.spreadGate.spread_atr_pct_distribution?.p90,1) + '% | ' + fmt(s.spreadGate.spread_atr_pct_distribution?.p95,1) + '% |'),
  '',
  'Interpretation: the pips gate and spread/ATR gate are independent. Relaxing the pips ceiling cannot admit a bar where spread/ATR still exceeds its limit. Compare these counts under the 2.0-pip assumptions before changing any production settings.',
  '',
  '## H1 trend diagnosis',
  '',
  '| Scenario | UP | DOWN | RANGE / unclear | Bull stack but close rejected | Bear stack but close rejected | Mixed EMA order | H1 WAIT reasons | Spread WAIT reasons |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...scenarios.map(s => '| ' + s.scenario + ' | ' + s.h1Up + ' | ' + s.h1Down + ' | ' + s.h1Range + ' | ' + (s.h1.bullish_stack_rejected_by_close || 0) + ' | ' + (s.h1.bearish_stack_rejected_by_close || 0) + ' | ' + (s.h1.mixed_ema_stack || 0) + ' | ' + (s.waitReasons.h1_trend_not_clear || 0) + ' | ' + (s.waitReasons.spread_filter_failed || 0) + ' |'),
  '',
  '## Reading the results',
  '',
  '- Compare the OOS columns before considering any strategy change. In-sample results do not qualify a strategy for production.',
  '- cost-* scenarios keep the pips gate loose at 2.50 pips to focus on the effect of assumed execution costs; the spread-to-target economic filter still applies.',
  '- gate-* scenarios hold assumed spread at 2.00 pips and vary only the max-spread threshold. A threshold below the assumed spread should block every candidate and is a safety-control check, not a realistic performance estimate.',
  '- Historical H1 counters explain why the exact UP/DOWN condition rejects H1 bars: mixed EMA stack vs EMA-stack present but the H1 close is on the wrong side of EMA20.',
  '- Do not loosen production gates or enable real execution from this report alone.'
].join('\n');
await fs.writeFile(path.join(outputRoot, 'eurusd_spread_sensitivity.md'), md + '\n');

console.log(JSON.stringify({
  outputRoot,
  scenario_count: scenarios.length,
  files: [
    'eurusd_spread_sensitivity.json',
    'eurusd_spread_sensitivity.csv',
    'eurusd_spread_sensitivity.md'
  ]
}, null, 2));
