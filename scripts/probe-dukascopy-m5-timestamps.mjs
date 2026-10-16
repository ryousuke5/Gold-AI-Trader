import { writeFile } from 'node:fs/promises';

const mod = await import('dukascopy-node');
const getHistoricalRates = mod.getHistoricalRates || mod.default?.getHistoricalRates;
if (typeof getHistoricalRates !== 'function') throw new Error('dukascopy-node getHistoricalRates export not found');

const end = new Date('2026-10-05T00:00:00Z');
const start = new Date(end.getTime() - 30 * 86400000);
const rows = await getHistoricalRates({
  instrument: 'xauusd',
  dates: { from: start, to: end },
  timeframe: 'm5',
  priceType: 'bid',
  volumes: true,
  format: 'array'
});
const counters = {
  raw_rows: Array.isArray(rows) ? rows.length : -1,
  non_array_row: 0,
  bad_timestamp: 0,
  bad_ohlc: 0,
  off_5m_boundary: 0,
  aligned_5m_boundary: 0
};
const samples = [];
let minTs = Infinity, maxTs = -Infinity;
for (const row of Array.isArray(rows) ? rows : []) {
  if (!Array.isArray(row)) { counters.non_array_row++; continue; }
  const ts = Math.floor(Number(row[0]) / 1000);
  const open=Number(row[1]), high=Number(row[2]), low=Number(row[3]), close=Number(row[4]);
  if (!Number.isFinite(ts)) { counters.bad_timestamp++; continue; }
  minTs=Math.min(minTs,ts); maxTs=Math.max(maxTs,ts);
  if (ts % 300 === 0) counters.aligned_5m_boundary++;
  else counters.off_5m_boundary++;
  if (!(open>0 && high>=Math.max(open,close) && low<=Math.min(open,close) && low>0)) counters.bad_ohlc++;
  if (samples.length<12) samples.push({
    raw_time:row[0], normalized_epoch_seconds:ts,
    normalized_iso:new Date(ts*1000).toISOString(),
    modulo_300:ts%300, open, high, low, close,
    volume:Number(row[5]||0)
  });
}
const report = {
  status: 'DIAGNOSTIC_ONLY',
  instrument:'XAUUSD',
  resolution:'M5 BID',
  requested_start_utc:start.toISOString(),
  requested_end_utc_exclusive:end.toISOString(),
  counters,
  min_time_utc:Number.isFinite(minTs)?new Date(minTs*1000).toISOString():null,
  max_time_utc:Number.isFinite(maxTs)?new Date(maxTs*1000).toISOString():null,
  samples,
  production_config_changed:false,
  render_deployment_performed:false,
  live_orders_enabled:false
};
console.log(JSON.stringify(report,null,2));
await writeFile('gold-m5-feed-probe.json',JSON.stringify(report,null,2));
