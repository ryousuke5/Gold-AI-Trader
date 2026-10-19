import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isSupportedEurUsdSymbol } from '../src/eurusd_symbol.js';

test('accepts plain EURUSD and XM suffix EURUSD# only', () => {
  assert.equal(isSupportedEurUsdSymbol('EURUSD'), true);
  assert.equal(isSupportedEurUsdSymbol('EURUSD#'), true);
  assert.equal(isSupportedEurUsdSymbol(' eurusd# '), true);
  assert.equal(isSupportedEurUsdSymbol('EURUSD.PRO'), false);
  assert.equal(isSupportedEurUsdSymbol('EURUSDmicro'), false);
  assert.equal(isSupportedEurUsdSymbol('GBPUSD'), false);
  assert.equal(isSupportedEurUsdSymbol('GOLD#'), false);
  assert.equal(isSupportedEurUsdSymbol(''), false);
  assert.equal(isSupportedEurUsdSymbol(null), false);
});

test('all EURUSD analysis/signal routes use suffix-aware symbol validation', async () => {
  const source = await readFile(new URL('../src/eurusd.js', import.meta.url), 'utf8');
  const guardedRoutes = source.match(/if \(!isSupportedEurUsdSymbol\(symbol\)\)/g) || [];
  assert.equal(guardedRoutes.length, 4, 'ai-test, signal, pullback-ai-test and pullback-signal must accept EURUSD#');
  assert.doesNotMatch(source, /symbol !== 'EURUSD'/, 'old exact-match guards must be removed');

  const executionRoute = source.slice(source.indexOf("app.post('/api/eurusd/execution-result'"));
  assert.match(executionRoute, /!isSupportedEurUsdSymbol\(signal\.symbol\)/, 'execution results must validate suffix-bearing signal symbols');
  assert.match(executionRoute, /symbol: String\(signal\.symbol\)/, 'saved order must retain broker-native symbol');
});

test('MT4 monitor forwards the broker-native chart symbol without stripping suffix', async () => {
  const source = await readFile(new URL('../mt4/EURUSDAIMonitorV13.mq4', import.meta.url), 'utf8');
  assert.match(source, /return Symbol\(\);/, 'blank SymbolName must use the chart symbol');
  assert.match(source, /StringFind\(sym, "EURUSD"\) >= 0/, 'EURUSD# must pass EA symbol recognition');
  assert.match(source, /JsonEscape\(sym\)/, 'payload must escape the actual symbol variable');
});
