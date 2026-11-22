import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const probe = fs.readFileSync(new URL('../mt5/tools/FXTF_GOLD_EnvironmentProbe.mq5', import.meta.url), 'utf8');

test('FXTF environment probe is a one-shot read-only script', () => {
  assert.match(probe, /void OnStart\s*\(/);
  assert.match(probe, /read_only=true/);
  assert.match(probe, /trading_calls=none/);
  assert.match(probe, /network_calls=none/);
});

test('FXTF environment probe captures broker and symbol contract details', () => {
  for (const token of [
    'ACCOUNT_SERVER',
    'ACCOUNT_CURRENCY',
    'ACCOUNT_MARGIN_MODE',
    'TimeTradeServer()',
    'TimeGMT()',
    'SYMBOL_TRADE_CONTRACT_SIZE',
    'SYMBOL_TRADE_TICK_SIZE',
    'SYMBOL_TRADE_TICK_VALUE',
    'SYMBOL_VOLUME_MIN',
    'SYMBOL_VOLUME_STEP',
    'SYMBOL_VOLUME_MAX',
    'SYMBOL_SPREAD',
    'SYMBOL_SWAP_LONG',
    'SYMBOL_SWAP_SHORT',
    'SymbolInfoSessionTrade',
    'CopyRates'
  ]) assert.ok(probe.includes(token), 'missing probe field: ' + token);
});

test('FXTF environment probe contains no order or network API', () => {
  for (const forbidden of [
    'CTrade',
    'OrderSend(',
    'OrderClose(',
    'OrderModify(',
    'PositionOpen(',
    'PositionClose(',
    'WebRequest(',
    'SocketCreate(',
    'WebSocket'
  ]) assert.ok(!probe.includes(forbidden), 'forbidden API found: ' + forbidden);
});
