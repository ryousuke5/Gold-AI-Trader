import fs from 'node:fs/promises';

const file = 'mt4/XAUUSDTrendRetestEA_V2.mq4';
const source = await fs.readFile(file, 'utf8');

const checks = [
  ['strict mode', /#property strict/],
  ['V2 version', /#property version\s+"2\.0"/],
  ['gold symbol guard', /IsGoldSymbol\s*\(/],
  ['completed M5 confirmation bar', /iTime\(sym, SignalTimeframe, 1\)/],
  ['prior retest bar', /const int retestShift = 2/],
  ['breakout lookback window', /breakoutShift <= MaxRetestBars \+ 2/],
  ['range filter', /MinRangeAtr/],
  ['breakout buffer', /BreakoutAtr/],
  ['retest tolerance', /RetestToleranceAtr/],
  ['retest invalidation', /MaxPenetrationAtr/],
  ['confirmation filter', /ConfirmBodyAtr/],
  ['ATR stop', /StopBufferAtr/],
  ['risk sizing', /CalculateLots/],
  ['daily loss guard', /MaxDailyLossPercent/],
  ['account drawdown guard', /MaxAccountDrawdownPercent/],
  ['spread guard', /MaxSpreadPrice/],
  ['broker stop guard', /MODE_STOPLEVEL/],
  ['terminal trade permission', /IsTradeAllowed\(\)/],
  ['one position guard', /MaxOpenPositions/],
  ['restart-safe processed bar state', /ProcessedBarKey/],
  ['restart-safe trade history', /LastTradeCloseTime/],
  ['JST session conversion', /XmServerUtcOffsetHours/],
  ['live order execution', /OrderSend\s*\(/],
  ['orders off by default', /input bool\s+AllowAutoOrders\s*=\s*false/]
];

const failures = checks.filter(([, rx]) => !rx.test(source)).map(([name]) => name);
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  file,
  checks: checks.length,
  note: 'Static contract passed. MetaEditor compilation on the target XM MT4 terminal is still required before demo execution.'
}, null, 2));
