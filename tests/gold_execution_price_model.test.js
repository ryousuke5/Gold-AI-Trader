import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEntryFill,
  isStopTriggered,
  isTargetTriggered,
  calculateExpectedStopFill,
  calculateEffectiveRiskDistance,
  calculateExitFill
} from '../src/gold_execution_price_model.js';

const costs = { spread: 0.5, slippage: 0.1 };

test('BUY and SELL entries use executable quote sides', () => {
  assert.equal(calculateEntryFill({ side: 'BUY', bidOpen: 2500, ...costs }), 2500.6);
  assert.equal(calculateEntryFill({ side: 'SELL', bidOpen: 2500, ...costs }), 2499.9);
});

test('SELL stop and target triggers compare BID OHLC directly to BID-derived levels', () => {
  const stopBar = { open: 2500, high: 2501.1, low: 2499.6, close: 2500.8 };
  const targetBar = { open: 2500, high: 2500.4, low: 2498.8, close: 2499.1 };
  assert.equal(isStopTriggered({ side: 'SELL', bidBar: stopBar, stopLossBid: 2501 }), true);
  assert.equal(isTargetTriggered({ side: 'SELL', bidBar: targetBar, takeProfitBid: 2499 }), true);
  assert.equal(isStopTriggered({ side: 'SELL', bidBar: { ...stopBar, high: 2500.7 }, stopLossBid: 2501 }), false);
});

test('BUY and SELL stop fills include the correct exit quote and costs', () => {
  assert.equal(calculateExpectedStopFill({ side: 'BUY', stopLossBid: 2498, ...costs }), 2497.9);
  assert.equal(calculateExpectedStopFill({ side: 'SELL', stopLossBid: 2502, ...costs }), 2502.6);
  assert.equal(calculateExitFill({
    side: 'BUY', reason: 'STOP', bidBar: { open: 2500, close: 2500 }, levelBid: 2498, ...costs
  }), 2497.9);
  assert.equal(calculateExitFill({
    side: 'SELL', reason: 'STOP', bidBar: { open: 2500, close: 2500 }, levelBid: 2502, ...costs
  }), 2502.6);
});

test('effective risk distance includes all known entry and stop-exit costs', () => {
  const buyEntry = calculateEntryFill({ side: 'BUY', bidOpen: 2500, ...costs });
  const sellEntry = calculateEntryFill({ side: 'SELL', bidOpen: 2500, ...costs });
  const buyRisk = calculateEffectiveRiskDistance({
    side: 'BUY', entryFill: buyEntry, stopLossBid: 2498, ...costs
  });
  const sellRisk = calculateEffectiveRiskDistance({
    side: 'SELL', entryFill: sellEntry, stopLossBid: 2502, ...costs
  });
  assert.ok(Math.abs(buyRisk - 2.7) < 1e-9);
  assert.ok(Math.abs(sellRisk - 2.7) < 1e-9);
  // If the stop is touched without a gap, the realised loss is exactly -1R.
  const buyExit = calculateExitFill({
    side: 'BUY', reason: 'STOP', bidBar: { open: 2500, close: 2500 }, levelBid: 2498, ...costs
  });
  const sellExit = calculateExitFill({
    side: 'SELL', reason: 'STOP', bidBar: { open: 2500, close: 2500 }, levelBid: 2502, ...costs
  });
  assert.ok(Math.abs((buyExit - buyEntry) / buyRisk + 1) < 1e-9);
  assert.ok(Math.abs((sellEntry - sellExit) / sellRisk + 1) < 1e-9);
});

test('stop gaps fill adversely while target gaps receive price improvement before slippage', () => {
  assert.equal(calculateExitFill({
    side: 'BUY', reason: 'STOP', bidBar: { open: 2496, close: 2497 }, levelBid: 2498, ...costs
  }), 2495.9);
  assert.equal(calculateExitFill({
    side: 'SELL', reason: 'STOP', bidBar: { open: 2504, close: 2503 }, levelBid: 2502, ...costs
  }), 2504.6);
  assert.equal(calculateExitFill({
    side: 'BUY', reason: 'TARGET', bidBar: { open: 2504, close: 2503 }, levelBid: 2502, ...costs
  }), 2503.9);
  assert.equal(calculateExitFill({
    side: 'SELL', reason: 'TARGET', bidBar: { open: 2496, close: 2497 }, levelBid: 2498, ...costs
  }), 2496.6);
});

test('TIME and DATA_GAP exits convert BID close to the correct execution side', () => {
  const bidBar = { open: 2500, close: 2499 };
  assert.equal(calculateExitFill({ side: 'BUY', reason: 'TIME', bidBar, ...costs }), 2498.9);
  assert.equal(calculateExitFill({ side: 'SELL', reason: 'DATA_GAP', bidBar, ...costs }), 2499.6);
});

test('execution model rejects invalid side and negative costs', () => {
  assert.throws(() => calculateEntryFill({ side: 'FLAT', bidOpen: 2500 }), /side must be BUY or SELL/);
  assert.throws(() => calculateEntryFill({ side: 'BUY', bidOpen: 2500, spread: -0.1 }), /must be >= 0/);
});
