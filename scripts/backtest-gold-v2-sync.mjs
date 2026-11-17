import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadGoldBacktestSummary } from '../src/gold_backtest_summary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const backtestScript = path.join(__dirname, 'backtest-gold-v2.mjs');
const strategyVariant = String(process.env.GOLD_BACKTEST_STRATEGY_VARIANT || 'breakout_v2').trim().toLowerCase();
const outputPrefix = strategyVariant === 'halfback_v1' ? 'gold_halfback_v1' : 'gold_v2';
const outputDir = process.env.GOLD_BACKTEST_OUTPUT_DIR
  ? path.resolve(process.env.GOLD_BACKTEST_OUTPUT_DIR)
  : path.join(repoRoot, 'gold-backtest-output');

function runBacktest() {
  const result = spawnSync(process.execPath, [backtestScript, ...process.argv.slice(2)], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error('Backtest process terminated by signal: ' + result.signal);
  if (result.status !== 0) throw new Error('Backtest process exited with code ' + result.status);
}

async function main() {
  runBacktest();

  if (String(process.env.GOLD_BACKTEST_AUTO_UPLOAD || '').toLowerCase() !== 'true') {
    console.log('[GOLD BACKTEST UPLOAD] skipped; set GOLD_BACKTEST_AUTO_UPLOAD=true to enable summary-only upload');
    return;
  }

  const reportPath = path.join(outputDir, outputPrefix + '_backtest_report.json');
  const reportText = await fs.readFile(reportPath, 'utf8');
  const report = JSON.parse(reportText);
  const result = await uploadGoldBacktestSummary(report, {
    baseUrl: process.env.GOLD_BACKTEST_API_URL,
    apiKey: process.env.GOLD_API_KEY
  });
  console.log('[GOLD BACKTEST UPLOAD] ' + JSON.stringify(result));
}

main().catch(error => {
  console.error('[GOLD BACKTEST SYNC FAILED]', error?.message || error);
  process.exitCode = 1;
});
