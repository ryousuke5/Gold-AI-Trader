import test from 'node:test';
import assert from 'node:assert/strict';
import { eurUsdLiveTradingApproved } from '../src/eurusd.js';

test('EURUSD live trading approval is locked by default', () => {
  const previous = process.env.EURUSD_LIVE_TRADING_APPROVED;
  delete process.env.EURUSD_LIVE_TRADING_APPROVED;
  try {
    assert.equal(eurUsdLiveTradingApproved(), false);
  } finally {
    if (previous === undefined) delete process.env.EURUSD_LIVE_TRADING_APPROVED;
    else process.env.EURUSD_LIVE_TRADING_APPROVED = previous;
  }
});

test('EURUSD live trading approval requires explicit true', () => {
  const previous = process.env.EURUSD_LIVE_TRADING_APPROVED;
  process.env.EURUSD_LIVE_TRADING_APPROVED = 'true';
  try {
    assert.equal(eurUsdLiveTradingApproved(), true);
    process.env.EURUSD_LIVE_TRADING_APPROVED = 'false';
    assert.equal(eurUsdLiveTradingApproved(), false);
  } finally {
    if (previous === undefined) delete process.env.EURUSD_LIVE_TRADING_APPROVED;
    else process.env.EURUSD_LIVE_TRADING_APPROVED = previous;
  }
});
