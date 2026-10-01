import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = {
  start: process.env.MACRO_START || '2019-01-01',
  end: process.env.MACRO_END || '2022-03-04',
  output: process.env.MACRO_OUTPUT || path.resolve(__dirname, '../backtest-output/eurusd_macro_daily.csv')
};
const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Gold-AI-Trader-macro-replay/1.0' } });
  if (!res.ok) throw new Error('Download failed ' + res.status + ': ' + url);
  return await res.text();
}
function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map(x => x.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h,i) => row[h] = cells[i]);
    return row;
  });
}
function toDateKey(date){ return date.toISOString().slice(0,10); }
function shiftDate(key,days){ const d=new Date(key+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return toDateKey(d); }
function seriesMap(rows,key){
  const m=new Map();
  for(const r of rows){
    const d=r.observation_date||r.date;
    const v=Number(r[key]);
    if(d && Number.isFinite(v)) m.set(d,v);
  }
  return m;
}
function dateRange(start,end){
  const out=[]; const d=new Date(start+'T00:00:00Z'); const e=new Date(end+'T00:00:00Z');
  while(d<=e){ out.push(toDateKey(d)); d.setUTCDate(d.getUTCDate()+1); }
  return out;
}
const FOMC_DATES = new Set([
  '2020-01-29','2020-03-03','2020-03-15','2020-04-29','2020-06-10','2020-07-29','2020-09-16','2020-11-05','2020-12-16',
  '2021-01-27','2021-03-17','2021-04-28','2021-06-16','2021-07-28','2021-09-22','2021-11-03','2021-12-15',
  '2022-01-26','2022-03-16'
]);
const ECB_DATES = new Set([
  '2020-01-23','2020-03-12','2020-04-30','2020-06-04','2020-07-16','2020-09-10','2020-10-29','2020-12-10',
  '2021-01-21','2021-03-11','2021-04-22','2021-06-10','2021-07-22','2021-09-09','2021-10-28','2021-12-16',
  '2022-02-03','2022-03-10'
]);

async function main(){
  const url = FRED + '?id=DFF,ECBDFR&cosd=' + CONFIG.start + '&coed=' + CONFIG.end;
  const rows = parseCsv(await fetchText(url));
  const dff=seriesMap(rows,'dff'), ecb=seriesMap(rows,'ecbdfr');
  const out=[], history=[];
  for(const date of dateRange(CONFIG.start,CONFIG.end)){
    const prev=shiftDate(date,-1);
    const prior5=shiftDate(date,-6);
    const prior20=shiftDate(date,-21);
    if(dff.has(prev)) history.dff=dff.get(prev); if(ecb.has(prev)) history.ecb=ecb.get(prev);
    if(!Number.isFinite(history.dff)||!Number.isFinite(history.ecb)) continue;
    const diff=history.dff-history.ecb;
    const prior5Diff=(Number.isFinite(dff.get(prior5))&&Number.isFinite(ecb.get(prior5))) ? dff.get(prior5)-ecb.get(prior5) : diff;
    const prior20Diff=(Number.isFinite(dff.get(prior20))&&Number.isFinite(ecb.get(prior20))) ? dff.get(prior20)-ecb.get(prior20) : diff;
    out.push({
      timestamp: date+'T00:00:00Z',
      fed_funds: history.dff.toFixed(4),
      ecb_deposit: history.ecb.toFixed(4),
      usd_minus_eur_policy_rate: diff.toFixed(4),
      policy_diff_change_5d: (diff-prior5Diff).toFixed(4),
      policy_diff_change_20d: (diff-prior20Diff).toFixed(4),
      fomc_event_next_24h: FOMC_DATES.has(date)?'YES':'NO',
      ecb_event_next_24h: ECB_DATES.has(date)?'YES':'NO',
      event_risk_next_24h: (FOMC_DATES.has(date)||ECB_DATES.has(date))?'HIGH':'LOW'
    });
  }
  if(out.length<300) throw new Error('Macro snapshot unexpectedly short: '+out.length);
  await fs.mkdir(path.dirname(CONFIG.output),{recursive:true});
  const headers=Object.keys(out[0]);
  const csv=[headers.join(','),...out.map(r=>headers.map(h=>r[h]).join(','))].join('\n')+'\n';
  await fs.writeFile(CONFIG.output,csv);
  console.log('Macro snapshots:',out.length);
  console.log('Range:',out[0].timestamp,'->',out[out.length-1].timestamp);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
