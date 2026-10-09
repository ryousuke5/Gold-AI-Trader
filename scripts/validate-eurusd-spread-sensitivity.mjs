import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eurusd-spread-smoke-'));
try {
  const bars = [];
  const count = 10000;
  let previousClose = 1.1000;
  const firstTime = Math.floor(Math.floor(Date.now() / 1000) / 900) * 900 - count * 900;
  for (let i = 0; i < count; i++) {
    const open = previousClose;
    const drift = Math.sin(i / 47) * 0.000045 + Math.sin(i / 311) * 0.000015;
    const close = open + drift;
    const wick = 0.00010 + (i % 7) * 0.000005;
    bars.push({
      time: firstTime + i * 900,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      volume: 80 + (i % 17) * 3
    });
    previousClose = close;
  }

  const dataPath = path.join(root, 'eurusd-m15.json.gz');
  const manifestPath = path.join(root, 'dataset-manifest.json');
  const outputPath = path.join(root, 'output');
  const compressed = gzipSync(JSON.stringify(bars));
  await fs.writeFile(dataPath, compressed);
  await fs.writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    source_type: 'synthetic-smoke',
    source_run_id: null,
    validated_at_utc: new Date().toISOString(),
    requested_lookback_days: 3650,
    bars: bars.length,
    estimated_weekday_bars: bars.length,
    coverage_pct: 100,
    first_bar_open_utc: new Date(bars[0].time * 1000).toISOString(),
    last_bar_close_utc: new Date((bars.at(-1).time + 900) * 1000).toISOString(),
    first_gap_days: 0,
    last_bar_age_days: 0,
    sha256_gzip: createHash('sha256').update(compressed).digest('hex'),
    limit_note: 'synthetic test dataset only'
  }, null, 2));

  execFileSync(process.execPath, ['scripts/backtest-eurusd-legacy-core.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      LEGACY_CORE_DATA_FILE: dataPath,
      LEGACY_CORE_DATASET_MANIFEST: manifestPath,
      LEGACY_CORE_OUTPUT_DIR: outputPath,
      LEGACY_CORE_SCENARIO_NAME: 'validation-smoke',
      LEGACY_CORE_SCENARIO_TYPE: 'smoke',
      LEGACY_CORE_SPREAD_PIPS: '2.0',
      LEGACY_CORE_MAX_SPREAD_PIPS: '1.2',
      LEGACY_CORE_SLIPPAGE_PIPS: '0.1'
    }
  });

  const report = JSON.parse(await fs.readFile(path.join(outputPath, 'summary.json'), 'utf8'));
  assert.equal(report.scenario.name, 'validation-smoke');
  assert.equal(report.scenario.type, 'smoke');
  assert.equal(report.data.spread_history_available, false);
  assert.equal(report.data.provenance.source_type, 'synthetic-smoke');
  assert.equal(report.data.provenance.sha256_gzip, createHash('sha256').update(compressed).digest('hex'));
  assert.equal(report.execution.spread_pips, 2);
  assert.equal(report.parameters.maxSpreadPips, 1.2);
  assert.ok(report.diagnostics.evaluated > 0, 'synthetic replay should evaluate at least one bar');
  assert.ok(report.diagnostics.h1_trend_breakdown, 'H1 trend breakdown should be present');
  for (const key of [
    'bullish_ema_stack',
    'bearish_ema_stack',
    'mixed_ema_stack',
    'bullish_stack_rejected_by_close',
    'bearish_stack_rejected_by_close'
  ]) {
    assert.ok(Number.isFinite(report.diagnostics.h1_trend_breakdown[key]), 'missing H1 metric: ' + key);
  }
  assert.ok(report.diagnostics.wait_reasons.spread_filter_failed > 0,
    '2.0 pip assumed spread should fail the 1.2 pip gate');
  assert.ok(report.fixed_five_year_validation?.is_period, 'fixed IS period must be included');
  assert.ok(report.fixed_five_year_validation?.oos_period, 'fixed OOS period must be included');

  // Exercise the same artifact aggregator used by CI and verify provenance survives end-to-end.
  const artifactRoot = path.join(root, 'artifacts');
  const scenarioArtifact = path.join(artifactRoot, 'eurusd-spread-validation-smoke');
  const aggregateOutput = path.join(root, 'aggregate');
  await fs.mkdir(scenarioArtifact, { recursive: true });
  await fs.copyFile(path.join(outputPath, 'summary.json'), path.join(scenarioArtifact, 'summary.json'));
  execFileSync(process.execPath, ['scripts/aggregate-eurusd-spread-sensitivity.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      EURUSD_SPREAD_ARTIFACT_DIR: artifactRoot,
      EURUSD_SPREAD_REPORT_DIR: aggregateOutput
    }
  });
  const aggregate = JSON.parse(await fs.readFile(path.join(aggregateOutput, 'eurusd_spread_sensitivity.json'), 'utf8'));
  assert.equal(aggregate.scenario_count, 1);
  assert.equal(aggregate.dataset_provenance.source_type, 'synthetic-smoke');
  assert.equal(aggregate.dataset_provenance.sha256_gzip, report.data.provenance.sha256_gzip);
  const markdown = await fs.readFile(path.join(aggregateOutput, 'eurusd_spread_sensitivity.md'), 'utf8');
  assert.match(markdown, /Dataset provenance/);
  console.log('EURUSD SPREAD SENSITIVITY + AGGREGATION SYNTHETIC SMOKE PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
