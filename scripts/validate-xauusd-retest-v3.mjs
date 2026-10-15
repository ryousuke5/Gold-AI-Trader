import fs from 'node:fs/promises';

const file='mt4/XAUUSDTrendRetestEA_V3.mq4';
const source=await fs.readFile(file,'utf8');

const checks=[
 ['strict mode',/#property strict/],
 ['V3 version',/#property version\s+"3\.0"/],
 ['gold symbol guard',/IsGoldSymbol\s*\(/],
 ['completed M5 confirmation',/iTime\(sym, SignalTimeframe, 1\)/],
 ['flexible retest window',/oldestRetestShift/],
 ['breakout window',/breakoutShift <= retestShift \+ MaxRetestBars/],
 ['range filter',/MinRangeAtr/],
 ['breakout filter',/BreakoutAtr/],
 ['retest tolerance',/RetestToleranceAtr/],
 ['path invalidation',/MaxPenetrationAtr/],
 ['reclaim confirmation',/confirmationClose > level \+ ConfirmBufferAtr/],
 ['ATR stop',/StopBufferAtr/],
 ['SELL stop accounts for Bid-to-Ask spread',/retestHigh\s*\+\s*spread\s*\+\s*StopBufferAtr\s*\*\s*m5Atr/],
 ['broker stop guard uses executable-side Bid/Ask',/return bid - stop > required && target - bid > required[\s\S]*return stop - ask > required && ask - target > required/],
 ['risk sizing',/CalculateLots/],
 ['daily loss guard',/MaxDailyLossPercent/],
 ['account drawdown guard',/MaxAccountDrawdownPercent/],
 ['spread guard',/MaxSpreadPrice/],
 ['broker stop guard',/MODE_STOPLEVEL/],
 ['terminal trade permission',/IsTradeAllowed\(\)/],
 ['one position guard',/MaxOpenPositions/],
 ['restart state',/ProcessedBarKey/],
 ['close-time cooldown',/LastTradeCloseTime/],
 ['max-hold manager',/ManageOpenPositions/],
 ['JST session conversion',/XmServerUtcOffsetHours/],
 ['live order execution',/OrderSend\s*\(/],
 ['orders off by default',/AllowAutoOrders\s*=\s*false/]
];
const signatures = [...source.matchAll(/^(?:int|bool|double|void|string|datetime)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/gm)]
  .map((match) => `${match[1]}(${match[2].replace(/\s+/g, ' ').trim()})`);
const seen = new Set();
const duplicateSignatures = [];
for (const signature of signatures) {
  if (seen.has(signature)) duplicateSignatures.push(signature);
  seen.add(signature);
}
const failures=checks.filter(([,rx])=>!rx.test(source)).map(([name])=>name);
if(duplicateSignatures.length) failures.push(`duplicate function signatures: ${[...new Set(duplicateSignatures)].join(', ')}`);
if(failures.length){console.error(JSON.stringify({ok:false,failures},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,file,checks:checks.length,uniqueFunctionSignatures:signatures.length},null,2));
