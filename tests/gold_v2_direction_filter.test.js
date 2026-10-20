import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedResearchSide, normalizeResearchSideFilter } from '../scripts/backtest-gold-v2.mjs';

test('research side filter defaults to BOTH and normalizes case', () => {
  assert.equal(normalizeResearchSideFilter(), 'BOTH');
  assert.equal(normalizeResearchSideFilter('buy'), 'BUY');
  assert.equal(normalizeResearchSideFilter(' sell '), 'SELL');
});

test('BOTH keeps both trade directions', () => {
  assert.equal(isAllowedResearchSide('BUY', 'BOTH'), true);
  assert.equal(isAllowedResearchSide('SELL', 'BOTH'), true);
});

test('BUY and SELL filters only keep the selected side', () => {
  assert.equal(isAllowedResearchSide('BUY', 'BUY'), true);
  assert.equal(isAllowedResearchSide('SELL', 'BUY'), false);
  assert.equal(isAllowedResearchSide('SELL', 'SELL'), true);
  assert.equal(isAllowedResearchSide('BUY', 'SELL'), false);
});

test('invalid research side filter fails closed', () => {
  assert.throws(() => normalizeResearchSideFilter('LONG'), /Use BOTH, BUY, or SELL/);
});
