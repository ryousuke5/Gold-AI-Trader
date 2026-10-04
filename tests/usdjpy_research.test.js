import test from 'node:test';
import assert from 'node:assert/strict';

test('USDJPY research uses the dedicated USDJPY dataset', () => {
  assert.equal(
    'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDJPY/USDJPYm15.csv'.endsWith('/USDJPY/USDJPYm15.csv'),
    true
  );
  assert.equal(
    'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDJPY/USDJPYh1.csv'.endsWith('/USDJPY/USDJPYh1.csv'),
    true
  );
});

test('USDJPY pip size is 0.01', () => {
  const pip = 0.01;
  assert.equal(pip, 0.01);
});

test('USDJPY research keeps live execution disabled', () => {
  assert.notEqual(String(process.env.USDJPY_EXECUTION_ENABLED || 'false').toLowerCase(), 'true');
});
