import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const days = Math.max(365, Number(process.env.CORE_V4_LOOKBACK_DAYS || 1825));
const out = path.resolve(process.env.CORE_V4_PREPARED_DATA || 'eurusd-core-v4-data/eurusd-m15.json.gz');

const mod = await import('dukascopy-node');
const get = mod.getHistoricalRates || mod.default?.getHistoricalRates;
if (typeof get !== 'function') throw new Error('dukascopy-node getHistoricalRates export missing');

const end = new Date();
const start = new Date(end.getTime() - days * 86400000);
const rows = await get({
  instrument: 'eurusd',
  dates: { from: start, to: end },
  timeframe: 'm15',
  priceType: 'bid',
  volumes: true,
  format: 'array'
});

if (!Array.isArray(rows) || rows.length < 100000) {
  throw new Error('Insufficient EURUSD M15 coverage: ' + (rows?.length || 0));
}

const now = Date.now();
const normalized = rows.map((r) => ({
  time: Math.floor(Number(r[0]) / 1000),
  open: Number(r[1]),
  high: Number(r[2]),
  low: Number(r[3]),
  close: Number(r[4]),
  volume: Number(r[5]) || 0
})).filter((b) =>
  Number.isFinite(b.time) && b.open > 0 &&
  b.high >= b.low && b.high >= b.open && b.high >= b.close &&
  b.low <= b.open && b.low <= b.close &&
  (b.time + 900) * 1000 <= now
).sort((a, b) => a.time - b.time);

if (normalized.length < 100000) {
  throw new Error('Insufficient normalized EURUSD M15 coverage: ' + normalized.length);
}

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, gzipSync(JSON.stringify(normalized)), 'binary');
console.log(JSON.stringify({
  output: out,
  bars: normalized.length,
  first_utc: new Date(normalized[0].time * 1000).toISOString(),
  last_utc: new Date(normalized.at(-1).time * 1000).toISOString(),
  lookback_days: days
}, null, 2));
