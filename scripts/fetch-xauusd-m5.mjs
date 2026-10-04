import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { getHistoricalRates } from 'dukascopy-node';

const lookbackDays = Math.max(365, Number(process.env.GOLD_BACKTEST_LOOKBACK_DAYS || 1825));
const chunkDays = Math.max(7, Number(process.env.GOLD_DATA_CHUNK_DAYS || 45));
const outputFile = path.resolve(process.env.GOLD_PREPARED_DATA_FILE || 'gold-xauusd-data/xauusd-m5.json.gz');

const end = new Date();
const start = new Date(end.getTime() - lookbackDays * 86400000);

const all = [];
let cursor = new Date(start);

while (cursor < end) {
  const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + chunkDays * 86400000));
  const rows = await getHistoricalRates({
    instrument: 'xauusd',
    dates: { from: cursor, to: chunkEnd },
    timeframe: 'm5',
    priceType: 'bid',
    volumes: true,
    format: 'array'
  });
  const now = Date.now();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const b = {
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]) || 0
    };
    if (
      Number.isFinite(b.time) && b.open > 0 &&
      b.high >= b.low && b.high >= b.open && b.high >= b.close &&
      b.low <= b.open && b.low <= b.close &&
      (b.time + 300) * 1000 <= now
    ) all.push(b);
  }
  console.log(JSON.stringify({
    chunk_start: cursor.toISOString(),
    chunk_end: chunkEnd.toISOString(),
    rows_fetched: Array.isArray(rows) ? rows.length : 0,
    cumulative_rows: all.length
  }));
  cursor = chunkEnd;
}

all.sort((a,b)=>a.time-b.time);
const unique = [];
let last = -1;
for (const bar of all) {
  if (bar.time === last) continue;
  unique.push(bar);
  last = bar.time;
}

if (unique.length < 200000) {
  throw new Error('Insufficient Dukascopy XAUUSD M5 data: ' + unique.length);
}

const payload = JSON.stringify(unique);
await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, gzipSync(payload, { level: 9 }));

console.log(JSON.stringify({
  ok: true,
  lookback_days: lookbackDays,
  chunk_days: chunkDays,
  start: start.toISOString(),
  end: end.toISOString(),
  rows: unique.length,
  first: new Date(unique[0].time * 1000).toISOString(),
  last: new Date(unique[unique.length - 1].time * 1000).toISOString(),
  output: outputFile,
  compressed_bytes: (await fs.stat(outputFile)).size
}, null, 2));
