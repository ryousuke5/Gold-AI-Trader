import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUtcBarTimestamp } from '../src/market_time.js';

test('accepts recent UTC bar times', () => {
 const now = Date.parse('2026-10-09T12:50:05Z');
 const bar = Date.parse('2026-10-09T12:50:00Z') / 1000;
 assert.equal(validateUtcBarTimestamp(bar, { nowMs: now }).ok, true);
});
