import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('EURUSD Pullback V3 workflow wiring matches backtester parameters',()=>{
  const workflow=fs.readFileSync('.github/workflows/eurusd-pullback-v3-backtest.yml','utf8');
  const script=fs.readFileSync('scripts/backtest-eurusd-pullback-v3.mjs','utf8');
  const names=[
    'PULLBACK_BACKTEST_V3_MIN_RETRACE_RATIO',
    'PULLBACK_BACKTEST_V3_MAX_RETRACE_RATIO',
    'PULLBACK_BACKTEST_V3_MIN_IMPULSE_ATR',
    'PULLBACK_BACKTEST_V3_MIN_PULLBACK_ATR',
    'PULLBACK_BACKTEST_V3_MIN_H1_AGREEMENT',
    'PULLBACK_BACKTEST_V3_BREAK_BUFFER_ATR',
    'PULLBACK_BACKTEST_V3_HOLD_BUFFER_ATR',
    'PULLBACK_BACKTEST_V3_TAKE_PROFIT_R'
  ];
  for(const name of names){
    assert.match(script,new RegExp('process\\.env\\.'+name+'\\b'),name+' must be consumed by V3 backtester');
    assert.match(workflow,new RegExp(name+':'),name+' must be supplied by V3 workflow');
  }
});
