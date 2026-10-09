import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

const days = Math.max(365, envNumber('CORE_V4_LOOKBACK_DAYS', 1825));
const out = path.resolve(process.env.CORE_V4_PREPARED_DATA || 'eurusd-core-v4-data/eurusd-m15.json.gz');
const batchSize = Math.max(1, Math.floor(envNumber('CORE_V4_BATCH_SIZE', 5)));
const batchPauseMs = Math.max(0, envNumber('CORE_V4_BATCH_PAUSE_MS', 1500));
const retryCount = Math.max(0, Math.floor(envNumber('CORE_V4_RETRY_COUNT', 2)));
const retryPauseMs = Math.max(100, envNumber('CORE_V4_RETRY_PAUSE_MS', 2000));
const fetchAttempts = Math.max(1, Math.floor(envNumber('CORE_V4_FETCH_ATTEMPTS', 2)));
const minimumCoverageRatio = Math.min(1, Math.max(0.5, envNumber('CORE_V4_MINIMUM_COVERAGE_RATIO', 0.95)));

const mod = await import('dukascopy-node');
const get = mod.getHistoricalRates || mod.default?.getHistoricalRates;
if (typeof get !== 'function') throw new Error('dukascopy-node getHistoricalRates export missing');

const end = new Date();
const start = new Date(end.getTime() - days * 86400000);
function estimateWeekdayBars(from, to) {
  let weekdays = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= last) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) weekdays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return weekdays * 96;
}
const expectedBars = estimateWeekdayBars(start, end);
const configuredMinimum = envNumber('CORE_V4_MINIMUM_BARS', 0);
const minimumBars = Number.isFinite(configuredMinimum) && configuredMinimum > 0
  ? Math.floor(configuredMinimum)
  : Math.ceil(expectedBars * minimumCoverageRatio);
const requestConfig = {
  instrument: 'eurusd',
  dates: { from: start, to: end },
  timeframe: 'm15',
  priceType: 'bid',
  volumes: true,
  format: 'array',
  // Large historical ranges should use restrained batching to avoid stressing the feed.
  batchSize,
  pauseBetweenBatchesMs: batchPauseMs,
  // Retry empty responses as well as failed artifacts. The library's defaults disable retries.
  retryCount,
  retryOnEmpty: true,
  pauseBetweenRetriesMs: retryPauseMs,
  failAfterRetryCount: true
};

let rows = [];
const attemptDiagnostics = [];
for (let attempt = 1; attempt <= fetchAttempts; attempt++) {
  const startedAt = Date.now();
  try {
    const result = await get(requestConfig);
    rows = Array.isArray(result) ? result : [];
    attemptDiagnostics.push({
      attempt,
      bars: rows.length,
      elapsed_ms: Date.now() - startedAt,
      outcome: rows.length >= minimumBars ? 'sufficient' : 'insufficient'
    });
    console.log(JSON.stringify({
      event: 'eurusd_history_fetch_attempt',
      ...attemptDiagnostics.at(-1),
      batch_size: batchSize,
      batch_pause_ms: batchPauseMs,
      retry_count: retryCount,
      retry_pause_ms: retryPauseMs
    }));
    if (rows.length >= minimumBars) break;
  } catch (error) {
    attemptDiagnostics.push({
      attempt,
      bars: 0,
      elapsed_ms: Date.now() - startedAt,
      outcome: 'error',
      error: String(error?.message || error).slice(0, 500)
    });
    console.error(JSON.stringify({ event: 'eurusd_history_fetch_attempt', ...attemptDiagnostics.at(-1) }));
  }
  if (attempt < fetchAttempts) await new Promise(resolve => setTimeout(resolve, retryPauseMs * attempt));
}

if (!Array.isArray(rows) || rows.length < minimumBars) {
  throw new Error('Insufficient EURUSD M15 coverage after ' + attemptDiagnostics.length +
    ' fetch attempt(s): ' + (rows?.length || 0) + ' raw bars; require at least ' + minimumBars +
    ' of estimated ' + expectedBars + '. Diagnostics=' + JSON.stringify(attemptDiagnostics));
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

// Deduplicate timestamps defensively before the chronological replay.
const unique = [];
let previousTime = -1;
for (const bar of normalized) {
  if (bar.time === previousTime) continue;
  unique.push(bar);
  previousTime = bar.time;
}

if (unique.length < minimumBars) {
  throw new Error('Insufficient normalized EURUSD M15 coverage: ' + unique.length +
    ' bars from ' + normalized.length + ' raw rows; require ' + minimumBars +
    ' (estimated bars=' + expectedBars + ', coverage threshold=' + (minimumCoverageRatio * 100).toFixed(1) + '%).');
}
const firstGapDays = (unique[0].time * 1000 - start.getTime()) / 86400000;
const lastCompletedBarAgeDays = (end.getTime() - (unique.at(-1).time + 900) * 1000) / 86400000;
if (firstGapDays > 14) {
  throw new Error('EURUSD M15 history starts too late: first gap=' + firstGapDays.toFixed(2) + ' days.');
}
if (lastCompletedBarAgeDays > 7) {
  throw new Error('EURUSD M15 history is stale: last completed bar age=' + lastCompletedBarAgeDays.toFixed(2) + ' days.');
}

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, gzipSync(JSON.stringify(unique)), 'binary');
console.log(JSON.stringify({
  output: out,
  bars: unique.length,
  raw_rows: rows.length,
  invalid_or_incomplete_rows_dropped: rows.length - normalized.length,
  duplicate_rows_dropped: normalized.length - unique.length,
  first_utc: new Date(unique[0].time * 1000).toISOString(),
  last_utc: new Date(unique.at(-1).time * 1000).toISOString(),
  lookback_days: days,
  estimated_weekday_bars: expectedBars,
  minimum_required_bars: minimumBars,
  coverage_pct: unique.length / expectedBars * 100,
  first_gap_days: Number(firstGapDays.toFixed(2)),
  latest_completed_bar_age_days: Number(lastCompletedBarAgeDays.toFixed(2)),
  fetch_attempts: attemptDiagnostics,
  config: { batch_size: batchSize, batch_pause_ms: batchPauseMs, retry_count: retryCount, retry_pause_ms: retryPauseMs }
}, null, 2));
