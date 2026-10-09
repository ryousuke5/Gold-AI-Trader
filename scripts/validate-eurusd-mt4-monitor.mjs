import fs from 'node:fs/promises';

const files = ['mt4/EURUSDAIMonitor.mq4', 'mt4/EURUSDAIMonitorV12.mq4', 'mt4/EURUSDAIMonitorV13.mq4'];
const sources = await Promise.all(files.map(async (file) => ({
  file,
  source: await fs.readFile(file, 'utf8')
})));

const requiredTokens = [
  '#property strict',
  'EventSetTimer',
  'OnTimer',
  'currentClosedBarOpen + 900 + MaxRetryMinutes * 60',
  'BuildSignalPayload',
  'PostJson',
  'PERIOD_M15',
  'PERIOD_H1',
  'bar_time',
  'recent_m15',
  'recent_h1',
  'X-Gold-API-Key',
  'WeekendGapMetrics',
  'OldestOpenPositionAgeSeconds',
  'json += "\\"safety\\":{"',
  'weekend_gap_atr',
  'oldest_position_age_seconds'
];

for (const { file, source } of sources) {
  for (const token of requiredTokens) {
    if (!source.includes(token)) {
      throw new Error(file + ': Missing required token: ' + token);
    }
  }
}

const forbiddenOrderTokens = [
  'OrderSend(',
  'OrderClose(',
  'OrderModify(',
  'OrderDelete(',
  'OrderCloseBy('
];

for (const { file, source } of sources) {
  for (const token of forbiddenOrderTokens) {
    if (source.includes(token)) {
      throw new Error(file + ': Order-execution token is forbidden in monitor EA: ' + token);
    }
  }
}

for (const { file, source } of sources) {
if (!source.includes('StringReplace(value, "\\\"", "\\\\\\"");')) {
  throw new Error(file + ': JsonEscape quote escaping line is missing or malformed');
}
if (!source.includes('bool ProbeHealth()') || !source.includes('startup connectivity test passed.') || !/sending the current completed M15 bar immediately(?: \(startup bypass\))?\./.test(source)) {
  throw new Error(file + ': startup health probe/immediate send is missing');
}
}

function scanStructure(text) {
  const stack = [];
  let i = 0;
  let line = 1;
  let state = 'code';

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '\n') line++;

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line_comment';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block_comment';
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = 'string';
        i++;
        continue;
      }
      if ('({['.includes(ch)) stack.push({ ch, line });
      if (')}]'.includes(ch)) {
        const open = stack.pop();
        if (!open) throw new Error('Unexpected closing ' + ch + ' at line ' + line);
        const pairs = { ')': '(', ']': '[', '}': '{' };
        if (open.ch !== pairs[ch]) {
          throw new Error('Mismatched ' + open.ch + ' / ' + ch + ' at line ' + line);
        }
      }
      i++;
      continue;
    }

    if (state === 'string') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') state = 'code';
      i++;
      continue;
    }

    if (state === 'line_comment') {
      if (ch === '\n') state = 'code';
      i++;
      continue;
    }

    if (state === 'block_comment') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i++;
    }
  }

  if (state === 'string') throw new Error('Unterminated string literal');
  if (state === 'block_comment') throw new Error('Unterminated block comment');
  if (stack.length) {
    const last = stack[stack.length - 1];
    throw new Error('Unclosed ' + last.ch + ' at line ' + last.line);
  }
}

for (const { file, source } of sources) scanStructure(source);

const functions = [
  'string TrimText',
  'string TradeSymbol',
  'bool IsEurUsdSymbol',
  'string NormalizeBaseUrl',
  'string JsonEscape',
  'bool BuildSignalPayload',
  'bool SendCurrentBar',
  'bool PostJson',
  'void OnTimer',
  'int OnInit',
  'void OnDeinit'
];

for (const { file, source } of sources) {
  for (const signature of functions) {
    if (!source.includes(signature)) {
      throw new Error(file + ': Missing required function signature: ' + signature);
    }
  }
}

console.log('MQL4 EURUSD monitor static validation: PASS');
console.log('Order execution API scan: PASS');
console.log('Bracket/string structure scan: PASS');

for (const { file, source } of sources) {
const accountObjectCount = (source.match(/json \+= "\\"account\\":\{/g) || []).length;
if (accountObjectCount !== 1) {
  throw new Error('Expected exactly one account JSON object, found: ' + accountObjectCount);
}

const safetyObjectCount = (source.match(/json \+= "\\"safety\\":\{/g) || []).length;
if (safetyObjectCount !== 1) {
  throw new Error(file + ': Expected exactly one safety JSON object, found: ' + safetyObjectCount);
}
}

