import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSignalRows, summarizeTradeResultRows } from '../src/forward_monitor.js';

test('summarizeSignalRows counts candidate and decision distribution', () => {
  const result = summarizeSignalRows([
    { candidate: 'BUY', decision: 'BUY', created_at: '2026-10-08T00:00:00Z' },
    { candidate: 'WAIT', decision: 'WAIT', created_at: '2026-10-08T00:01:00Z' },
    { candidate: 'SELL', decision: 'WAIT', created_at: '2026-10-08T00:02:00Z' }
  ]);
  assert.deepEqual(result.candidate, { BUY: 1, SELL: 1, WAIT: 1 });
  assert.deepEqual(result.decision, { BUY: 1, SELL: 0, WAIT: 2 });
  assert.equal(result.latest_candidate, 'SELL');
  assert.equal(result.latest_decision, 'WAIT');
});

test('summarizeTradeResultRows computes PF expectancy and win rate', () => {
  const result = summarizeTradeResultRows([
    { result: 'WIN', r_multiple: 2 },
    { result: 'LOSS', r_multiple: -1 },
    { result: 'BREAKEVEN', r_multiple: 0 }
  ]);
  assert.equal(result.results_total, 3);
  assert.equal(result.wins, 1);
  assert.equal(result.losses, 1);
  assert.equal(result.breakeven, 1);
  assert.ok(Math.abs(result.win_rate_pct - (100 / 3)) < 1e-12);
  assert.equal(result.net_r, 1);
  assert.equal(result.profit_factor, 2);
  assert.equal(result.expectancy_r, 1 / 3);
});
