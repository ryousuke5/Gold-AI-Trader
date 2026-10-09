import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eurusd-spread-smoke-'));
try {
  const bars = [];
  const count = 10000;
  let previousClose = 1.1000;
  const firstTime = Math.floor(Date.now() / 1000) - count * 900;
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
  const outputPath = path.join(root, 'output');
  await fs.writeFile(dataPath, gzipSync(JSON.stringify(bars)));

  execFileSync(process.execPath, ['scripts/backtest-eurusd-legacy-core.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      LEGACY_CORE_DATA_FILE: dataPath,
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
  console.log('EURUSD SPREAD SENSITIVITY SYNTHETIC SMOKE PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
