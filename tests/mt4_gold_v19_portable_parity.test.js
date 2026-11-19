import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const baseline = fs.readFileSync(new URL('../mt4/source-baselines/GoldAITraderV19_UserProvided_2026-11-20.mq4', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../mt4/portable/GoldAITraderV19_Portable.mq4', import.meta.url), 'utf8');
const modulePaths = [
  '../mt4/portable/include/GoldV19_Common.mqh',
  '../mt4/portable/include/GoldV19_MarketData.mqh',
  '../mt4/portable/include/GoldV19_Time.mqh',
  '../mt4/portable/include/GoldV19_MarketSafety.mqh',
  '../mt4/portable/include/GoldV19_Payload.mqh',
  '../mt4/portable/include/GoldV19_Http.mqh',
  '../mt4/portable/include/GoldV19_Flow.mqh'
];
const modules = modulePaths.map((path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const portable = [entry, ...modules].join('\n');

function findFunctionEnd(source, openIndex) {
  let depth = 0;
  let state = 'code';
  let escaped = false;
  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (state === 'string' || state === 'char') {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if ((state === 'string' && char === '"') || (state === 'char' && char === "'")) state = 'code';
      continue;
    }
    if (state === 'line') { if (char === '\n') state = 'code'; continue; }
    if (state === 'block') { if (char === '*' && next === '/') { state = 'code'; i++; } continue; }
    if (char === '/' && next === '/') { state = 'line'; i++; continue; }
    if (char === '/' && next === '*') { state = 'block'; i++; continue; }
    if (char === '"') { state = 'string'; continue; }
    if (char === "'") { state = 'char'; continue; }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('Unclosed function body');
}

function functionBody(source, name) {
  const signature = new RegExp(
    '^(?:string|bool|int|double|void|datetime|long|uint|ulong)\\s+' +
    name + '\\s*\\([^;]*?\\)\\s*\\{',
    'm'
  );
  const match = signature.exec(source);
  assert.ok(match, 'missing function definition: ' + name);
  const open = match.index + match[0].lastIndexOf('{');
  return source.slice(match.index, findFunctionEnd(source, open)).trim();
}

const expectedFunctions = [
  'TrimText', 'TradeSymbol', 'IsGoldSymbol', 'JsonEscape', 'JsonNumber',
  'IsValidApiConfiguration', 'SymbolReady', 'OpenPositions', 'DailyRealizedPnl',
  'PeakEquity', 'GetServerUtcOffsetSeconds', 'ServerTimeUtcEpochJson',
  'MarketSafetyKey', 'LoadMarketSafetyState', 'SaveMarketSafetyState',
  'UpdateMarketSafety', 'BuildSignalPayload', 'PostJson',
  'BuildSafetyHeartbeatPayload', 'IsStaleBarTimeRejection', 'OnTimer',
  'OnInit', 'OnDeinit', 'OnTick'
];

test('portable shadow entrypoint includes all modules in dependency order', () => {
  const includes = [
    'GoldV19_Common.mqh',
    'GoldV19_MarketData.mqh',
    'GoldV19_Time.mqh',
    'GoldV19_MarketSafety.mqh',
    'GoldV19_Payload.mqh',
    'GoldV19_Http.mqh',
    'GoldV19_Flow.mqh'
  ];
  let previousIndex = -1;
  for (const file of includes) {
    const marker = '#include "include/' + file + '"';
    const currentIndex = entry.indexOf(marker);
    assert.ok(currentIndex > previousIndex, 'include missing or out of order: ' + file);
    previousIndex = currentIndex;
  }
  assert.match(entry, /AllowAutoOrders\s*=\s*false/);
  assert.match(entry, /portable research shadow build/);
});

test('supplied V19 baseline preserves the original startup-bar handling', () => {
  assert.doesNotMatch(baseline, /startup_current_completed_M5_bar_skipped/);
  assert.doesNotMatch(entry, /startup_current_completed_M5_bar_skipped/);
  assert.match(baseline, /if\(closedBar == g_lastClosedM5Bar\)/);
});

test('all 24 original V19 functions are preserved verbatim exactly once', () => {
  for (const name of expectedFunctions) {
    const body = functionBody(baseline, name);
    assert.equal(portable.split(body).length - 1, 1, 'function changed or duplicated: ' + name);
  }
});

test('portable shadow build remains monitor-only with no order execution', () => {
  assert.doesNotMatch(portable, /\bOrderSend\s*\(/);
  assert.doesNotMatch(portable, /\bOrderClose\s*\(/);
  assert.doesNotMatch(portable, /\bOrderModify\s*\(/);
  assert.doesNotMatch(portable, /\bCTrade\b/);
  assert.match(entry, /input bool\s+AllowAutoOrders\s*=\s*false;/);
});
