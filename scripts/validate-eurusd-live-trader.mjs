import fs from 'node:fs/promises';

const file = 'mt4/EURUSDLiveTrader.mq4';
const source = await fs.readFile(file, 'utf8');

const requiredTokens = [
  '#property strict',
  'AllowAutoOrders = false',
  'OrderSend(',
  'OrderClose(',
  'RunServerSafetyCheck',
  'WeekendGapMetrics',
  'LocalNewOrderSafetyAllowed',
  'OldestManagedPositionAgeSeconds',
  '/api/eurusd/signal',
  '/api/eurusd/safety-check',
  '/api/eurusd/execution-result',
  'order_allowed',
  'server_safety_force_close',
  'local_weekend_force_close',
  'execution_price_deviation',
  'MagicNumber'
];

for (const token of requiredTokens) {
  if (!source.includes(token)) throw new Error('Missing required executor token: ' + token);
}

const forbiddenUnsafePatterns = [
  'AllowAutoOrders = true',
  'EnableTrading = true',
  'EURUSD_EXECUTION_ENABLED = true'
];

for (const token of forbiddenUnsafePatterns) {
  if (source.includes(token)) throw new Error('Unsafe default pattern found: ' + token);
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

  if (state !== 'code') throw new Error('Unterminated lexical state: ' + state);
  if (stack.length) {
    const last = stack[stack.length - 1];
    throw new Error('Unclosed ' + last.ch + ' at line ' + last.line);
  }
}

scanStructure(source);

const functionNames = [
  'bool IsValidApiConfiguration',
  'bool SymbolReady',
  'bool CloseManagedPositions',
  'bool LocalNewOrderSafetyAllowed',
  'bool RunServerSafetyCheck',
  'bool ReportExecutionResult',
  'bool ExecuteApprovedSignal',
  'void OnTimer',
  'int OnInit',
  'void OnDeinit'
];

for (const signature of functionNames) {
  if (!source.includes(signature)) throw new Error('Missing executor function: ' + signature);
}

const gateIndex = source.indexOf('if(!JsonHasTrue(response, "order_allowed"))');
const localGateIndex = source.indexOf('if(!LocalNewOrderSafetyAllowed(sym))');
const orderIndex = source.indexOf('int ticket = OrderSend(');

if (gateIndex < 0 || localGateIndex < 0 || orderIndex < 0) {
  throw new Error('Could not locate dual order gates and OrderSend.');
}

if (!(gateIndex < orderIndex && localGateIndex < orderIndex)) {
  throw new Error('OrderSend must occur after both server and local gates.');
}

const autoOffIndex = source.indexOf('input bool   AllowAutoOrders = false;');
if (autoOffIndex < 0) throw new Error('Auto-order safety default is not OFF.');

console.log('MQL4 EURUSD live executor static validation: PASS');
console.log('Dual server/local order gates: PASS');
console.log('Auto-order default OFF: PASS');
console.log('Order parsing/idempotent reporting hooks: PASS');
