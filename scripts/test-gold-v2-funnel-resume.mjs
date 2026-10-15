import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gold-v2-funnel-resume-'));

function priceAt(index) {
  return 2000 + 0.002 * index + 0.2 * Math.sin(index * 0.1) + 1.5 * Math.floor(index / 40) - 0.4 * Math.floor(index / 100);
}

function validateFunnel(diagnostics, tradesLength) {
  assert.equal(diagnostics.schema_version, 1, 'unsupported funnel schema');
  const waitCount = Object.values(diagnostics.setup_wait_reasons || {})
    .reduce((sum, count) => sum + Number(count || 0), 0);
  assert.equal(
    diagnostics.signals_evaluated,
    diagnostics.candidates + waitCount,
    'setup outcomes do not reconcile'
  );
  assert.equal(
    diagnostics.candidates,
    diagnostics.candidates_buy + diagnostics.candidates_sell + diagnostics.candidates_other,
    'candidate directions do not reconcile'
  );
  assert.equal(diagnostics.risk_gate_checks, diagnostics.candidates, 'risk-gate checks do not reconcile');
  assert.equal(
    diagnostics.candidates,
    diagnostics.risk_gate_blocked_candidates + diagnostics.risk_gate_passed,
    'risk-gate outcomes do not reconcile'
  );
  assert.equal(
    diagnostics.risk_gate_passed,
    diagnostics.rejected_next_bar_gap + diagnostics.trade_attempts,
    'next-bar gap and attempts do not reconcile'
  );
  assert.equal(
    diagnostics.trade_attempts,
    diagnostics.rejected_invalid_geometry
      + diagnostics.rejected_entry_gap
      + diagnostics.rejected_effective_rr
      + diagnostics.trades_accepted,
    'trade-attempt outcomes do not reconcile'
  );
  assert.equal(diagnostics.trades_accepted, tradesLength, 'accepted trade count does not match trade output');
}

function runBacktest(dataFile, outputDir, stopAfter) {
  const result = spawnSync(
    process.execPath,
    ['scripts/backtest-gold-v2-resumable.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GOLD_BACKTEST_DATA_FILE: dataFile,
        GOLD_BACKTEST_OUTPUT_DIR: outputDir,
        GOLD_BACKTEST_INITIAL_EQUITY: '100000',
        GOLD_TEST_STOP_AFTER_BARS: String(stopAfter),
        // Loosen only the synthetic-fixture thresholds so CI exercises the candidate branch.
        GOLD_SESSION_START_UTC: '0',
        GOLD_SESSION_END_UTC: '23',
        GOLD_MIN_RANGE_ATR: '0.1',
        GOLD_MAX_RANGE_ATR: '100',
        GOLD_BREAKOUT_ATR: '0.01',
        GOLD_MIN_BODY_ATR: '0.05',
        GOLD_MIN_CLOSE_LOCATION: '0.5',
        GOLD_MIN_VOLUME_RATIO: '0.1',
        GOLD_BUY_RSI_MIN: '1',
        GOLD_BUY_RSI_MAX: '99',
        GOLD_SELL_RSI_MIN: '1',
        GOLD_SELL_RSI_MAX: '99',
        GOLD_MAX_EXTENSION_ATR: '100',
        GOLD_MIN_STOP_ATR: '0.1',
        GOLD_MAX_STOP_ATR: '100',
        GOLD_MIN_H1_RSI_BUY: '1',
        GOLD_MAX_H1_RSI_BUY: '99',
        GOLD_MIN_H1_RSI_SELL: '1',
        GOLD_MAX_H1_RSI_SELL: '99',
        GOLD_BACKTEST_MIN_EFFECTIVE_RR: '0.5'
      }
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      'Backtest runner failed (exit ' + result.status + ').\n'
      + String(result.stdout || '').slice(-2000)
      + '\n'
      + String(result.stderr || '').slice(-4000)
    );
  }
  return result.stdout;
}

try {
  const dataFile = path.join(temp, 'synthetic-xauusd-m5.json');
  const outputDir = path.join(temp, 'output');
  const bars = [];
  const firstTime = Math.floor(Date.parse('2021-10-01T00:00:00Z') / 1000);
  const totalBars = 200100;

  for (let i = 0; i < totalBars; i++) {
    const previousClose = priceAt(i - 1);
    const close = priceAt(i);
    const open = i === 0 ? close : previousClose;
    const wick = 0.55 + (i % 7) * 0.015;
    bars.push({
      time: firstTime + i * 300,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      close,
      volume: 100 + (i % 11) * 9 + (i % 40 === 0 ? 300 : 0)
    });
  }

  await fs.writeFile(dataFile, JSON.stringify(bars));
  const pauseLog = runBacktest(dataFile, outputDir, 2500);
  assert.match(pauseLog, /PAUSED_FOR_TEST/, 'first run did not pause');
  const checkpointFile = path.join(outputDir, 'gold_v2_resume_checkpoint.json');
  const paused = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
  assert.equal(paused.status, 'PAUSED', 'paused checkpoint status is incorrect');
  assert.ok(paused.funnel_diagnostics?.bars_scanned > 0, 'paused checkpoint omitted funnel diagnostics');
  const beforeResumeBarsScanned = paused.funnel_diagnostics.bars_scanned;
  const beforeResumeSignals = paused.funnel_diagnostics.signals_evaluated;

  const completionLog = runBacktest(dataFile, outputDir, 0);
  assert.match(completionLog, /COMPLETE/, 'resumed run did not complete');
  const completed = JSON.parse(await fs.readFile(checkpointFile, 'utf8'));
  const trades = JSON.parse(await fs.readFile(path.join(outputDir, 'gold_v2_resumed_trades.json'), 'utf8'));
  const exportedDiagnostics = JSON.parse(
    await fs.readFile(path.join(outputDir, 'gold_v2_funnel_diagnostics.json'), 'utf8')
  );
  assert.equal(completed.status, 'COMPLETE', 'resumed checkpoint status is incorrect');
  assert.ok(completed.funnel_diagnostics.bars_scanned > beforeResumeBarsScanned, 'bar counts did not continue after resume');
  assert.ok(completed.funnel_diagnostics.signals_evaluated >= beforeResumeSignals, 'signal counts regressed after resume');
  assert.deepEqual(exportedDiagnostics, completed.funnel_diagnostics, 'exported diagnostics differ from checkpoint');
  assert.equal(completed.trades.length, trades.length, 'checkpoint/trade output count mismatch');
  validateFunnel(completed.funnel_diagnostics, trades.length);
  assert.ok(completed.funnel_diagnostics.candidates > 0, 'synthetic fixture did not exercise candidate diagnostics');
  assert.ok(completed.funnel_diagnostics.trade_attempts > 0, 'synthetic fixture did not exercise trade-attempt diagnostics');

  console.log('GOLD V2 FUNNEL RESUME SMOKE TEST PASS', JSON.stringify({
    rows: bars.length,
    bars_scanned: completed.funnel_diagnostics.bars_scanned,
    signals_evaluated: completed.funnel_diagnostics.signals_evaluated,
    candidates: completed.funnel_diagnostics.candidates,
    trades: trades.length
  }));
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
