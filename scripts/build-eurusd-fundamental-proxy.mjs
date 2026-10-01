import fs from 'node:fs/promises';

const input=process.env.MACRO_INPUT || 'backtest-output/eurusd_macro_daily.csv';
const output=process.env.FUNDAMENTAL_MASK_OUTPUT || 'backtest-output/eurusd_fundamental_proxy_mask.csv';

function parseCsv(text){
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean);
  const header=lines[0].split(',');
  return lines.slice(1).map(line=>{
    const cells=line.split(','), row={};
    header.forEach((h,i)=>row[h]=cells[i]);
    return row;
  });
}
function classify(row){
  const d20=Number(row.policy_diff_change_20d);
  const level=Number(row.usd_minus_eur_policy_rate);
  let bias='NEUTRAL', confidence=0.60;
  if (d20 <= -0.25) { bias='BULLISH_EURUSD'; confidence=0.75; }
  else if (d20 <= -0.10 && level <= 1.50) { bias='BULLISH_EURUSD'; confidence=0.68; }
  else if (d20 >= 0.25) { bias='BEARISH_EURUSD'; confidence=0.75; }
  else if (d20 >= 0.10 && level >= 1.50) { bias='BEARISH_EURUSD'; confidence=0.68; }
  return {bias,confidence};
}
async function main(){
  const rows=parseCsv(await fs.readFile(input,'utf8'));
  if(rows.length<300) throw new Error('Not enough macro rows: '+rows.length);
  const out=['timestamp,bias,confidence,freshness,event_risk_next_24h'];
  for(const row of rows){
    const c=classify(row);
    out.push([row.timestamp,c.bias,c.confidence.toFixed(4),'CURRENT',row.event_risk_next_24h].join(','));
  }
  await fs.writeFile(output,out.join('\n')+'\n');
  console.log('Proxy fundamental rows:',rows.length);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
