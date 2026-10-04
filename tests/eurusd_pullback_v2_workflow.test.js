import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('EURUSD Pullback V2 workflow passes the parameter names consumed by the backtester', () => {
  const workflow = fs.readFileSync('.github/workflows/eurusd-pullback-v2-backtest.yml', 'utf8');
  const script = fs.readFileSync('scripts/backtest-eurusd-pullback-v2.mjs', 'utf8');

  const required = [
    'PULLBACK_BACKTEST_V2_MIN_RETRACE_RATIO',
    'PULLBACK_BACKTEST_V2_MAX_RETRACE_RATIO',
    'PULLBACK_BACKTEST_V2_MIN_BODY_ATR',
    'PULLBACK_BACKTEST_V2_MIN_CLOSE_LOCATION',
    'PULLBACK_BACKTEST_V2_MIN_H1_AGREEMENT',
    'PULLBACK_BACKTEST_V2_TAKE_PROFIT_R'
  ];

  for (const name of required) {
    assert.match(script, new RegExp('process\\.env\\.' + name + '\\b'), name + ' must be consumed by the backtester');
    assert.match(workflow, new RegExp(name + ':'), name + ' must be supplied by the workflow');
  }

  assert.doesNotMatch(
    workflow,
    /PULLBACK_BACKTEST_MIN_RETRACE_RATIO:|PULLBACK_BACKTEST_MAX_RETRACE_RATIO:/,
    'workflow must not use the legacy V1 retrace variable names for V2'
  );
});
