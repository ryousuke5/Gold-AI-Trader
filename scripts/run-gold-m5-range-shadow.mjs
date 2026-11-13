import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(process.env.GOLD_RANGE_SHADOW_SOURCE_DIR || path.join(ROOT, 'gold-v2-walkforward'));
const OUTPUT_DIR = path.resolve(process.env.GOLD_RANGE_SHADOW_OUTPUT_DIR || path.join(ROOT, 'gold-m5-range-shadow-output'));

const PERIODS = [
  { name: 'IS_3Y', file: 'is_data.json.gz', days: 1095 },
  { name: 'OOS_2Y', file: 'oos_data.json.gz', days: 730 }
];

function round(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function topEntries(object, limit = 10) {
  return Object.entries(object || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => ({ reason, count: Number(count) }));
}

async function runPeriod(period) {
  const dataFile = path.join(SOURCE_DIR, period.file);
  const outDir = path.join(OUTPUT_DIR, period.name);
  await fs.mkdir(outDir, { recursive: true });
  await fs.access(dataFile);

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
    GOLD_H1_TREND_MODE: 'strict',
    GOLD_RANGE_SHADOW_DIAGNOSTICS: 'true',
    GOLD_M5_GATE_SHADOW_DIAGNOSTICS: 'true'
  };
  delete env.GOLD_STRATEGY_JSON;

  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'backtest-gold-v2.mjs'), `--lookback-days=${period.days}`], {
    cwd: ROOT,
    env,
    stdio: 'pipe',
    maxBuffer: 30 * 1024 * 1024
  });

  const reportPath = path.join(outDir, 'gold_v2_backtest_report.json');
  const csvPath = path.join(outDir, 'gold_v2_range_shadow_baseline.csv');
  const m5GateCsvPath = path.join(outDir, 'gold_v2_m5_gate_shadow_baseline.csv');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const diag = report.results?.baseline?.range_shadow_diagnostics;
  const m5GateDiag = report.results?.baseline?.m5_gate_shadow_diagnostics;
  if (!diag?.enabled) throw new Error(`Range shadow diagnostics were not enabled for ${period.name}`);
  if (!m5GateDiag?.enabled) throw new Error(`M5 gate shadow diagnostics were not enabled for ${period.name}`);

  const originalCompressionRejects = Number(report.results?.baseline?.setup_wait_reasons?.compression_filter || 0);
  if (originalCompressionRejects !== Number(diag.compression_rejects)) {
    throw new Error(`Shadow count mismatch for ${period.name}: ${diag.compression_rejects} vs original ${originalCompressionRejects}`);
  }

  const csv = await fs.readFile(csvPath, 'utf8');
  const rowCount = Math.max(0, csv.trim().split(/\r?\n/).length - 1);
  if (rowCount !== Number(diag.compression_rejects)) {
    throw new Error(`CSV row count mismatch for ${period.name}: ${rowCount} vs ${diag.compression_rejects}`);
  }

  const expectedGateCounts = {
    impulse_body_filter: Number(report.results.baseline.setup_wait_reasons?.impulse_body_filter || 0),
    volume_expansion_filter: Number(report.results.baseline.setup_wait_reasons?.volume_expansion_filter || 0),
    breakout_trigger_filter: Number(report.results.baseline.setup_wait_reasons?.breakout_trigger_filter || 0)
  };
  let expectedGateRows = 0;
  for (const [gateName, expected] of Object.entries(expectedGateCounts)) {
    const actual = Number(m5GateDiag.gates?.[gateName]?.count || 0);
    if (actual !== expected) {
      throw new Error(`M5 gate shadow count mismatch for ${period.name} / ${gateName}: ${actual} vs ${expected}`);
    }
    expectedGateRows += expected;
  }
  const gateCsv = await fs.readFile(m5GateCsvPath, 'utf8');
  const gateRowCount = Math.max(0, gateCsv.trim().split(/\r?\n/).length - 1);
  if (gateRowCount !== expectedGateRows) {
    throw new Error(`M5 gate shadow CSV row count mismatch for ${period.name}: ${gateRowCount} vs ${expectedGateRows}`);
  }

  const summary = {
    period: period.name,
    days: period.days,
    evaluation_window_utc: {
      start: new Date((Date.parse(report.source_period.m5_last) - period.days * 86400 * 1000)).toISOString(),
      end_bar_open: report.source_period.m5_last,
      end_exclusive: new Date(Date.parse(report.source_period.m5_last) + 300 * 1000).toISOString()
    },
    prepared_file_first_bar_utc: report.source_period.m5_first,
    total_signals_evaluated: report.results.baseline.signals_evaluated,
    baseline_candidates: report.results.baseline.candidates,
    original_compression_rejects: originalCompressionRejects,
    range_shadow: {
      compression_rejects: diag.compression_rejects,
      downstream_rejections: diag.downstream_rejections,
      potential_candidates: diag.potential_candidates,
      potential_candidate_sides: diag.potential_candidate_sides,
      range_atr_summary: {
        count: diag.range_atr_summary?.count,
        mean: round(diag.range_atr_summary?.mean),
        median: round(diag.range_atr_summary?.median),
        p90: round(diag.range_atr_summary?.p90),
        min: round(diag.range_atr_summary?.min),
        max: round(diag.range_atr_summary?.max)
      },
      range_atr_bins: diag.range_atr_bins
    },
    m5_gate_shadow: {
      gates: Object.fromEntries(Object.entries(m5GateDiag.gates).map(([name, gate]) => [name, {
        count: gate.count,
        downstream_rejections: gate.downstream_rejections,
        potential_candidates: gate.potential_candidates,
        candidate_sides: gate.candidate_sides
      }])),
      detail_rows: gateRowCount
    },
    costs: report.cost_scenarios,
    report_file: path.relative(OUTPUT_DIR, reportPath),
    detail_csv: path.relative(OUTPUT_DIR, csvPath),
    detail_rows: rowCount,
    m5_gate_detail_csv: path.relative(OUTPUT_DIR, m5GateCsvPath)
  };

  await fs.copyFile(csvPath, path.join(OUTPUT_DIR, `gold_v2_range_shadow_${period.name}.csv`));
  await fs.copyFile(m5GateCsvPath, path.join(OUTPUT_DIR, `gold_v2_m5_gate_shadow_${period.name}.csv`));
  return summary;
}

function markdown(results) {
  const lines = [
    '# GOLD V2 M5 Range ATR Shadow Diagnosis',
    '',
    '**Research-only diagnostic. The Range ATR gate is bypassed only in a second shadow evaluation of records already rejected by the normal gate. No real candidate, trade, risk ledger, or production parameter is changed.**',
    '',
    '## Fixed configuration',
    '',
    '- H1 mode: Strict',
    '- Range lookback: 12 M5 bars',
    '- Range ATR interval: 0.80–2.80',
    '- M5 body ATR: >=0.40',
    '- Volume ratio: >=1.10',
    '- Breakout distance: >=0.10 ATR',
    '- Close location: >=0.65 for BUY / <=0.35 for SELL',
    '- Session: UTC 07:00–20:00',
    '- Baseline cost: spread 0.50 / slippage 0.05',
    '- Conservative cost remains in the standard backtest report; this diagnostic is about signal filters, which are cost independent.',
    '',
    '## Summary',
    '',
    '| Period | Range rejects | Mean ATR | Median ATR | P90 ATR | Potential setups after bypass |',
    '|---|---:|---:|---:|---:|---:|'
  ];
  for (const r of results) {
    lines.push(`| ${r.period} | ${r.range_shadow.compression_rejects} | ${r.range_shadow.range_atr_summary.mean} | ${r.range_shadow.range_atr_summary.median} | ${r.range_shadow.range_atr_summary.p90} | ${r.range_shadow.potential_candidates} |`);
  }
  for (const r of results) {
    lines.push('', `## ${r.period}`, '', '### First downstream rejection after Range ATR bypass', '', '| Reason | Count |', '|---|---:|');
    for (const item of topEntries(r.range_shadow.downstream_rejections, 20)) lines.push(`| ${item.reason} | ${item.count} |`);
    lines.push('', '### Range ATR distribution', '', '| Band | Count |', '|---|---:|');
    for (const item of r.range_shadow.range_atr_bins || []) lines.push(`| ${item.band} | ${item.count} |`);
    lines.push('', '### One-gate-at-a-time M5 shadow', '', '| Original failed gate | Count | Potential setups after bypass | Next reasons |', '|---|---:|---:|---|');
    for (const [gateName, gate] of Object.entries(r.m5_gate_shadow.gates)) {
      const next = topEntries(gate.downstream_rejections, 4).map(x => `${x.reason}: ${x.count}`).join('; ');
      lines.push(`| ${gateName} | ${gate.count} | ${gate.potential_candidates} | ${next || 'none'} |`);
    }
    lines.push('', `Range detail rows: ${r.detail_csv} (${r.detail_rows} records)`, `M5 gate detail rows: ${r.m5_gate_detail_csv} (${r.m5_gate_shadow.detail_rows} records)`);
  }
  lines.push(
    '',
    '## Interpretation rules',
    '',
    '- These are bar-level filter evaluations, not independent trades or independent observations.',
    '- Each M5 gate shadow bypasses exactly one first-failing gate; all other thresholds remain unchanged.',
    '- A potential setup after a one-gate bypass is not an approved trade. Entry gap, portfolio overlap, daily loss, drawdown and execution safety still need separate evaluation.',
    '- Zero potential setups after a single-gate bypass means no single one of these gates alone explains a missed valid setup in this fixed sample.',
    '- The 2024–2026 OOS split has been consulted in prior research and is not a fresh blind holdout. Treat it as a repeated robustness check, not independent confirmation.',
    '- No threshold should be promoted based on these diagnostics alone. A future forward-paper sample is needed after any separately pre-registered research candidate.',
    '- Production remains GOLD V2 Strict, ANALYSIS, auto trading OFF, and real-order gate OFF.'
  );
  return lines.join('\n') + '\n';
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const results = [];
  for (const period of PERIODS) {
    console.log(`Range shadow: ${period.name}`);
    results.push(await runPeriod(period));
  }

  const output = {
    title: 'GOLD V2 M5 Range ATR Shadow Diagnosis',
    methodology: 'For every in-session Strict H1 setup rejected by compression_filter, re-run the same M5 rules with only the Range ATR interval bypassed; record the first subsequent rejection reason.',
    source_walkforward_run_id: process.env.GOLD_RANGE_SHADOW_SOURCE_RUN_ID || '43349812731',
    production_changed: false,
    no_actual_trades_created: true,
    production_settings: {
      strategy: 'GOLD V2 Strict',
      range_atr: '0.80-2.80',
      body_atr_min: 0.40,
      volume_ratio_min: 1.10,
      breakout_atr_min: 0.10,
      runtime_mode: 'ANALYSIS',
      auto_trading_enabled: false,
      real_order_gate: 'OFF'
    },
    results
  };
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m5_range_shadow_report.json'), JSON.stringify(output, null, 2));
  await fs.writeFile(path.join(OUTPUT_DIR, 'gold_m5_range_shadow_report.md'), markdown(results));
  console.log(JSON.stringify({
    periods: results.map(r => ({
      period: r.period,
      range_rejects: r.range_shadow.compression_rejects,
      range_bypass_downstream: r.range_shadow.downstream_rejections,
      range_bypass_candidates: r.range_shadow.potential_candidates,
      m5_gate_shadow: r.m5_gate_shadow.gates
    })),
    production_changed: false
  }, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
