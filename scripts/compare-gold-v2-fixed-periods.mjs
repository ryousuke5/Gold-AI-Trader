import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-gold-v2-ai-replay-dataset.mjs');
const input = process.env.GOLD_BACKTEST_DATA_FILE;
if (!input) throw new Error('GOLD_BACKTEST_DATA_FILE is required (JSON or .json.gz OHLC bars)');

const inputPath = path.resolve(input);
const rawBytes = await fs.readFile(inputPath);
const text = inputPath.endsWith('.gz') ? gunzipSync(rawBytes).toString('utf8') : rawBytes.toString('utf8');
const parsed = JSON.parse(text);
if (!Array.isArray(parsed)) throw new Error('Backtest data must be a JSON array of M5 OHLC bars');
const bars = parsed.map((b) => ({
  time: Number(b.time), open: Number(b.open), high: Number(b.high),
  low: Number(b.low), close: Number(b.close), volume: Number(b.volume) || 0
})).filter((b) =>
  Number.isFinite(b.time) && b.open > 0 &&
  b.high >= b.low && b.high >= b.open && b.high >= b.close &&
  b.low <= b.open && b.low <= b.close
).sort((a, b) => a.time - b.time);
if (bars.length < 200000) throw new Error('Insufficient data: ' + bars.length + ' valid M5 bars; at least 200000 are required');

const endEpoch = Number(bars.at(-1).time) + 300;
const endDate = new Date(endEpoch * 1000);
const fiveYearStart = new Date(endDate);
fiveYearStart.setUTCFullYear(fiveYearStart.getUTCFullYear() - 5);
const fullStartEpoch = Math.floor(fiveYearStart.getTime() / 1000);
const recentStartEpoch = endEpoch - 730 * 86400;
const iso = (epoch) => new Date(epoch * 1000).toISOString();
const fullStart = iso(fullStartEpoch);
const recentStart = iso(recentStartEpoch);
const end = iso(endEpoch);

const root = path.resolve(process.env.GOLD_FIXED_COMPARE_OUTPUT_ROOT || 'gold-ai-fixed-period-comparisons');
const runId = process.env.GOLD_FIXED_COMPARE_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(root, runId);
await fs.mkdir(root, { recursive: true });
await fs.mkdir(runDir); // Never overwrite an earlier comparison run.
const fullDir = path.join(runDir, 'five-year');
const recentDir = path.join(runDir, 'latest-730-days');
await fs.mkdir(fullDir);
await fs.mkdir(recentDir);

function build(label, start, outputDir) {
  console.log(JSON.stringify({ phase: 'build-start', label, start_utc: start, end_utc_exclusive: end, output_dir: outputDir }));
  const env = {
    ...process.env,
    GOLD_BACKTEST_START_UTC: start,
    GOLD_BACKTEST_END_UTC: end,
    GOLD_AI_REPLAY_OUTPUT_DIR: outputDir
  };
  // This entry point always makes a fresh, isolated output/checkpoint for each period.
  delete env.GOLD_AI_REPLAY_BUILD_STOP_AFTER_CANDIDATES;
  const result = spawnSync(process.execPath, [builder], { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(label + ' dataset build failed with exit code ' + result.status);
}

build('five-year', fullStart, fullDir);
build('latest-730-days', recentStart, recentDir);

async function readLines(file) {
  const value = await fs.readFile(file, 'utf8');
  return value.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
async function readRun(dir) {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  const rows = await readLines(path.join(dir, 'gold_v2_ai_replay_dataset.jsonl'));
  return { manifest, rows };
}
const fiveYear = await readRun(fullDir);
const recent = await readRun(recentDir);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
function same(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
if (fiveYear.manifest.source_data.content_sha256 !== recent.manifest.source_data.content_sha256) {
  throw new Error('Source fingerprint mismatch: periods must use the exact same OHLC source');
}
for (const key of ['config', 'strategy', 'execution_policy']) {
  if (!same(fiveYear.manifest[key], recent.manifest[key])) {
    throw new Error('Fixed setting mismatch between periods: ' + key);
  }
}
if (fiveYear.manifest.period.end_epoch_seconds !== recent.manifest.period.end_epoch_seconds) {
  throw new Error('Period end mismatch; comparisons must share the same exclusive end');
}

function selectNonOverlappingTrades(rows) {
  const sorted = rows
    .filter((row) => row.execution?.eligible === true)
    .sort((a, b) => Number(a.asof_time) - Number(b.asof_time));
  const selected = [];
  let availableAt = -Infinity;
  for (const row of sorted) {
    if (Number(row.asof_time) < availableAt) continue;
    selected.push(row);
    availableAt = Number(row.execution.exit_time) + 300;
  }
  return selected;
}
function summarize(run) {
  const rows = run.rows;
  const eligible = rows.filter((row) => row.execution?.eligible === true);
  const trades = selectNonOverlappingTrades(rows);
  const rs = trades.map((row) => Number(row.execution.net_r)).filter(Number.isFinite);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(losses.reduce((sum, r) => sum + r, 0));
  let equity = 0, peak = 0, maxDrawdown = 0, lossStreak = 0, maxLossStreak = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    if (r < 0) {
      lossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      lossStreak = 0;
    }
  }
  const start = Number(run.manifest.period.start_epoch_seconds);
  const end = Number(run.manifest.period.end_epoch_seconds);
  const periodWeeks = Math.max(0, (end - start) / (7 * 86400));
  const holdMinutes = trades
    .map((row) => (Number(row.execution.exit_time) - Number(row.asof_time)) / 60)
    .filter(Number.isFinite);
  return {
    period_start_utc: run.manifest.period.start_utc,
    period_end_utc_exclusive: run.manifest.period.end_utc,
    period_days: (end - start) / 86400,
    signal_candidates: rows.length,
    execution_filter_passed_candidates: eligible.length,
    execution_filter_rejected_candidates: rows.length - eligible.length,
    selected_non_overlapping_trades: rs.length,
    win_count: wins.length,
    loss_count: losses.length,
    breakeven_count: rs.length - wins.length - losses.length,
    win_rate_pct: rs.length ? 100 * wins.length / rs.length : 0,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : null,
    profit_factor_unbounded_if_no_losses: grossWin > 0 && grossLoss === 0,
    expectancy_r: rs.length ? rs.reduce((sum, r) => sum + r, 0) / rs.length : 0,
    net_r: rs.reduce((sum, r) => sum + r, 0),
    max_drawdown_r: maxDrawdown,
    max_consecutive_losses: maxLossStreak,
    trades_per_week: periodWeeks ? rs.length / periodWeeks : 0,
    net_r_per_week: periodWeeks ? rs.reduce((sum, r) => sum + r, 0) / periodWeeks : 0,
    average_hold_minutes: holdMinutes.length ? holdMinutes.reduce((sum, v) => sum + v, 0) / holdMinutes.length : null,
    source_sha256: run.manifest.source_data.content_sha256,
    fixed_costs_and_execution: run.manifest.config,
    fixed_m5_and_h1_strategy_conditions: run.manifest.strategy,
    xm_data_gap_policy: run.manifest.execution_policy
  };
}

const fiveYearStats = summarize(fiveYear);
const recentStats = summarize(recent);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  run_id: runId,
  methodology: {
    strategy_changed_between_runs: false,
    stop_loss_take_profit_changed_between_runs: false,
    spread_slippage_and_execution_filters_changed_between_runs: false,
    xm_market_pause_handling_changed_between_runs: false,
    ai_environment_filter_applied: false,
    source_data_identical: true,
    indicator_warmup: 'Indicators are calculated from the complete shared source series; only candidate timestamps are window-filtered. This keeps recent-window warm-up identical to the five-year run.',
    window_semantics: 'Start inclusive, end exclusive; both periods share the same data-derived end timestamp.',
    comparability_note: 'Total net R, total trade count, and maximum drawdown depend on the window length. Compare expectancy, profit factor, win rate, trades per week, and net R per week alongside raw totals.',
    trade_selection: 'Eligible trades sorted chronologically; a new trade is skipped while the prior selected trade remains open.'
  },
  configuration_check: {
    source_fingerprint_equal: true,
    strategy_config_equal: same(fiveYear.manifest.strategy, recent.manifest.strategy),
    execution_config_equal: same(fiveYear.manifest.config, recent.manifest.config),
    xm_data_gap_policy_equal: same(fiveYear.manifest.execution_policy, recent.manifest.execution_policy)
  },
  five_year: fiveYearStats,
  latest_730_days: recentStats,
  difference_recent_minus_five_year: {
    signal_candidates: recentStats.signal_candidates - fiveYearStats.signal_candidates,
    selected_non_overlapping_trades: recentStats.selected_non_overlapping_trades - fiveYearStats.selected_non_overlapping_trades,
    win_rate_pct: recentStats.win_rate_pct - fiveYearStats.win_rate_pct,
    profit_factor: recentStats.profit_factor === null || fiveYearStats.profit_factor === null ? null : recentStats.profit_factor - fiveYearStats.profit_factor,
    expectancy_r: recentStats.expectancy_r - fiveYearStats.expectancy_r,
    net_r: recentStats.net_r - fiveYearStats.net_r,
    net_r_per_week: recentStats.net_r_per_week - fiveYearStats.net_r_per_week,
    max_drawdown_r: recentStats.max_drawdown_r - fiveYearStats.max_drawdown_r,
    trades_per_week: recentStats.trades_per_week - fiveYearStats.trades_per_week
  },
  artifacts: {
    five_year_manifest: path.join(fullDir, 'manifest.json'),
    five_year_dataset: path.join(fullDir, 'gold_v2_ai_replay_dataset.jsonl'),
    latest_730_days_manifest: path.join(recentDir, 'manifest.json'),
    latest_730_days_dataset: path.join(recentDir, 'gold_v2_ai_replay_dataset.jsonl'),
    report: path.join(runDir, 'comparison_report.json')
  }
};
await fs.writeFile(path.join(runDir, 'comparison_report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
