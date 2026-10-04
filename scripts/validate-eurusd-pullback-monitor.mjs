import fs from 'node:fs/promises';

const file = process.argv[2] || 'mt4/EURUSDTrendPullbackMonitor.mq4';
const source = await fs.readFile(file, 'utf8');

const requiredTokens = [
  '#property strict',
  'EventSetTimer',
  'OnTimer',
  'BuildSignalPayload',
  'PostJson',
  'PERIOD_M15',
  'PERIOD_H1',
  'bar_time',
  'recent_m15',
  'recent_h1',
  'X-Gold-API-Key'
];

for (const token of requiredTokens) {
  if (!source.includes(token)) throw new Error('Missing required token: ' + token);
}

const forbiddenOrderTokens = [
  'OrderSend(',
  'OrderClose(',
  'OrderModify(',
  'OrderDelete(',
  'OrderCloseBy('
];

for (const token of forbiddenOrderTokens) {
  if (source.includes(token)) throw new Error('Order-execution token is forbidden in monitor EA: ' + token);
}

function scanStructure(text) {
  const stack = [];
  let i = 0;
  let state = 'code';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line_comment'; i += 2; continue; }
      if (ch === '/' && next === '*') { state = 'block_comment'; i += 2; continue; }
      if (ch === '"') { state = 'string'; i += 1; continue; }
      if ('({['.includes(ch)) stack.push(ch);
      if (')}]'.includes(ch)) {
        const open = stack.pop();
        const pairs = { ')': '(', ']': '[', '}': '{' };
        if (!open || open !== pairs[ch]) throw new Error('Mismatched structure near char ' + i);
      }
      i += 1;
      continue;
    }

    if (state === 'string') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '"') state = 'code';
      i += 1;
      continue;
    }

    if (state === 'line_comment') {
      if (ch === '\n') state = 'code';
      i += 1;
      continue;
    }

    if (state === 'block_comment') {
      if (ch === '*' && next === '/') { state = 'code'; i += 2; continue; }
      i += 1;
    }
  }

  if (state !== 'code') throw new Error('Unterminated comment/string');
  if (stack.length) throw new Error('Unclosed bracket: ' + stack[stack.length - 1]);
}

scanStructure(source);

for (const signature of [
  'string TrimText',
  'string TradeSymbol',
  'bool IsEurUsdSymbol',
  'string JsonEscape',
  'bool BuildSignalPayload',
  'bool PostJson',
  'void OnTimer',
  'int OnInit',
  'void OnDeinit'
]) {
  if (!source.includes(signature)) throw new Error('Missing required function signature: ' + signature);
}

console.log('MQL4 monitor static validation: PASS');
console.log('file:', file);
console.log('order execution API scan: PASS');
console.log('bracket/string structure scan: PASS');
