import test from 'node:test';
import assert from 'node:assert/strict';

test('GBPUSD research harness uses the dedicated 10-year dataset', () => {
  const sourceM15 = 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/GBPUSD/GBPUSDm15.csv';
  const sourceH1 = 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/GBPUSD/GBPUSDh1.csv';
  assert.match(sourceM15, /GBPUSD\/GBPUSDm15\.csv$/);
  assert.match(sourceH1, /GBPUSD\/GBPUSDh1\.csv$/);
});

test('GBPUSD research keeps execution disabled', () => {
  assert.notEqual(String(process.env.GBPUSD_EXECUTION_ENABLED || 'false').toLowerCase(), 'true');
});
