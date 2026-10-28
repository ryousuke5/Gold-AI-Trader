import test from 'node:test';
import assert from 'node:assert/strict';
import { isolateIsWindow } from '../src/gold_backtest_split.js';

function minuteBars(days) {
  const start = Date.parse('2020-01-01T00:00:00Z') / 1000;
  const count = days * 24 * 12;
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * 300,
    open: 2000,
    high: 2001,
    low: 1999,
    close: 2000.5,
    volume: 10
  }));
}

test('IS-only split includes only candles that fully close by the fixed cutoff', () => {
  const source = minuteBars(4);
  const result = isolateIsWindow(source, { oosDays: 2, barSeconds: 300, minBars: 100 });
  assert.equal(result.sourceRows, 4 * 24 * 12);
  assert.equal(result.isRows, 2 * 24 * 12);
  assert.equal(result.oosRowsExcluded, 2 * 24 * 12);
  assert.equal(result.bars.at(-1).time + 300, result.isEndTime);
  assert.ok(result.bars.every((bar) => bar.time + 300 <= result.isEndTime));
  assert.equal(result.fullDataEndTime - result.isEndTime, 2 * 86400);
});

test('IS-only split rejects unsorted timestamps and insufficient IS coverage', () => {
  const source = minuteBars(4);
  assert.throws(() => isolateIsWindow([source[1], source[0]], { oosDays: 1, minBars: 1 }), /strictly increasing/);
  assert.throws(() => isolateIsWindow(source, { oosDays: 3, minBars: 2000 }), /Insufficient IS bars/);
});
