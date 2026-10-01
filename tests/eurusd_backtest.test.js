import test from 'node:test';
import assert from 'node:assert/strict';

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    prev = prev === null ? values[i] : alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function floorLot(raw, minLot = 0.01, maxLot = 100, lotStep = 0.01) {
  if (!(raw > 0)) return 0;
  const stepped = Math.floor((raw + 1e-12) / lotStep) * lotStep;
  if (stepped < minLot - 1e-12) return 0;
  return Math.min(maxLot, Number(stepped.toFixed(8)));
}

test('EMA initializes deterministically and converges', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.equal(out[0], 1);
  assert.ok(out[4] > 4);
  assert.ok(out[4] < 5);
});

test('EURUSD risk lot sizing floors to broker lot step', () => {
  const riskCash = 250;
  const stopDistance = 0.0010;
  const rawLots = riskCash / (stopDistance * 100000);
  assert.equal(floorLot(rawLots, 0.01, 100, 0.01), 2.5);
  assert.equal(floorLot(0.004, 0.01, 100, 0.01), 0);
});
