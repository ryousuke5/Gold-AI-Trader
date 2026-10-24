import fs from 'node:fs/promises';

const file = 'mt4/XAUUSDTrendBreakoutEA_V1.mq4';
const source = await fs.readFile(file, 'utf8');

const required = [
  ['strict mode', /#property strict/],
  ['gold symbol guard', /IsGoldSymbol\s*\(/],
  ['completed M5 bar only', /iTime\(sym, SignalTimeframe, 1\)/],
  ['H1 EMA200 trend filter', /h1Ema200/],
  ['compression range filter', /MinRangeAtr/],
  ['breakout buffer', /BreakoutBufferAtr/],
  ['ATR stop sizing', /MinStopAtr/],
  ['2R target default', /TakeProfitR\s*=\s*2\.00/],
  ['risk percentage sizing', /RiskPercent/],
  ['daily loss guard', /MaxDailyLossPercent/],
  ['account drawdown guard', /MaxAccountDrawdownPercent/],
  ['spread guard', /MaxSpreadPrice/],
  ['one-position guard', /MaxOpenPositions/],
  ['entry drift guard', /MaxEntryDistanceAtr/],
  ['broker trade permission guard', /IsTradeAllowed\(\)/],
  ['broker stop level guard', /MODE_STOPLEVEL/],
  ['minimum-lot risk protection', /rawLots\s*<\s*minLot/],
  ['market order execution', /OrderSend\s*\(/],
  ['auto orders disabled by default', /input bool\s+AllowAutoOrders\s*=\s*false/]
];

const failures = required.filter(([, rx]) => !rx.test(source)).map(([name]) => name);

const forbidden = [
  ['WebRequest in core execution', /\bWebRequest\s*\(/],
  ['automatic live-on default', /AllowAutoOrders\s*=\s*true/]
];

const forbiddenHits = forbidden.filter(([, rx]) => rx.test(source)).map(([name]) => name);

if (failures.length || forbiddenHits.length) {
  console.error(JSON.stringify({ ok: false, failures, forbiddenHits }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  file,
  checks: required.length,
  note: 'Static safety gate passed. MT4 MetaEditor compilation must still be performed on the XM terminal before execution.'
}, null, 2));
