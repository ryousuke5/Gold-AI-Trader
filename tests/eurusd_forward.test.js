import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBarExit, settlementR, summarizeEurUsdForwardTrades } from '../src/eurusd_forward.js';

test('BUY trade takes stop first when both stop and target are hit in one bar', () => {
  const trade = { side: 'BUY', entry: 1.1000, stop_loss: 1.0990, take_profit: 1.1020 };
  const bar = { high: 1.1030, low: 1.0985 };
  const exit = chooseBarExit(trade, bar);
  assert.deepEqual(exit, { price: 1.0990, reason: 'SL_FIRST_ASSUMPTION' });
  assert.equal(settlementR('BUY', 1.1000, 1.0990, exit.price), -1);
});

test('SELL trade takes target when only target is hit', () => {
  const trade = { side: 'SELL', entry: 1.1000, stop_loss: 1.1010, take_profit: 1.0980 };
  const bar = { high: 1.1005, low: 1.0975 };
  const exit = chooseBarExit(trade, bar);
  assert.deepEqual(exit, { price: 1.0980, reason: 'TAKE_PROFIT' });
  assert.equal(settlementR('SELL', 1.1000, 1.1010, exit.price), 2);
});

test('forward summary computes PF, expectancy and max drawdown in R', () => {
  const rows = [
    { status: 'WIN', r_multiple: 2, opened_at: '2026-01-01T00:00:00Z', exit_at: '2026-01-02T00:00:00Z' },
    { status: 'LOSS', r_multiple: -1, opened_at: '2026-01-03T00:00:00Z', exit_at: '2026-01-04T00:00:00Z' },
    { status: 'WIN', r_multiple: 1, opened_at: '2026-01-05T00:00:00Z', exit_at: '2026-01-06T00:00:00Z' }
  ];
  const summary = summarizeEurUsdForwardTrades(rows);
  assert.equal(summary.closed_trades, 3);
  assert.equal(summary.win_rate_pct, 66.66666666666666);
  assert.equal(summary.net_r, 2);
  assert.equal(summary.profit_factor, 3);
  assert.equal(summary.expectancy_r, 2 / 3);
  assert.equal(summary.max_drawdown_r, 1);
});
