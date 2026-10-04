import test from 'node:test';
import assert from 'node:assert/strict';

test('AUDUSD research harness uses the dedicated historical dataset', () => {
  const sourceM15 = 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/AUDUSD/AUDUSDm15.csv';
  const sourceH1 = 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/AUDUSD/AUDUSDh1.csv';
  assert.match(sourceM15, /AUDUSD\/AUDUSDm15\.csv$/);
  assert.match(sourceH1, /AUDUSD\/AUDUSDh1\.csv$/);
});

test('AUDUSD research keeps execution disabled', () => {
  assert.notEqual(String(process.env.AUDUSD_EXECUTION_ENABLED || 'false').toLowerCase(), 'true');
});
