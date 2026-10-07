import fs from 'node:fs/promises';
import path from 'node:path';

const START = process.env.POLICY_PROXY_START || '2016-01-01';
const END = process.env.POLICY_PROXY_END || new Date().toISOString().slice(0, 10);
const OUT = process.env.POLICY_PROXY_OUTPUT || 'eurusd-policy-proxy/eu_us_policy_daily.csv';
const FRED = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map((x) => x.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function series(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const date = row.observation_date;
    const value = Number(row[key]);
    if (date && Number.isFinite(value)) map.set(date, value);
  }
  return map;
}

function addDays(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(start, end) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  while (d <= e) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function latestOnOrBefore(map, date) {
  let d = date;
  for (let i = 0; i < 10; i += 1) {
    if (map.has(d)) return { date: d, value: map.get(d) };
    d = addDays(d, -1);
  }
  return null;
}

function classify(diff, diff5, diff20) {
  if (diff20 <= -0.25) return { bias: 'BULLISH_EURUSD', confidence: 0.75, environment: 'FAVORABLE' };
  if (diff20 <= -0.10 && diff <= 1.50) return { bias: 'BULLISH_EURUSD', confidence: 0.68, environment: 'FAVORABLE' };
  if (diff20 >= 0.25) return { bias: 'BEARISH_EURUSD', confidence: 0.75, environment: 'FAVORABLE' };
  if (diff20 >= 0.10 && diff >= 1.50) return { bias: 'BEARISH_EURUSD', confidence: 0.68, environment: 'FAVORABLE' };
  return { bias: 'NEUTRAL', confidence: 0.60, environment: 'CAUTION' };
}

const url = FRED + '?id=DFF,ECBDFR&cosd=' + START + '&coed=' + END;
const response = await fetch(url, { headers: { 'user-agent': 'Gold-AI-Trader-policy-proxy/1.0' } });
if (!response.ok) throw new Error('FRED download failed: ' + response.status);
const rows = parseCsv(await response.text());
const dff = series(rows, 'dff');
const ecb = series(rows, 'ecbdfr');

const out = [];
for (const date of dateRange(START, END)) {
  const prev = addDays(date, -1);
  const prior5 = addDays(date, -6);
  const prior20 = addDays(date, -21);
  const usd = latestOnOrBefore(dff, prev);
  const eur = latestOnOrBefore(ecb, prev);
  if (!usd || !eur) continue;

  const diff = usd.value - eur.value;
  const usd5 = latestOnOrBefore(dff, prior5);
  const eur5 = latestOnOrBefore(ecb, prior5);
  const usd20 = latestOnOrBefore(dff, prior20);
  const eur20 = latestOnOrBefore(ecb, prior20);
  const diff5 = usd5 && eur5 ? usd5.value - eur5.value : diff;
  const diff20 = usd20 && eur20 ? usd20.value - eur20.value : diff;
  const c = classify(diff, diff5, diff20);

  out.push({
    timestamp: date + 'T00:00:00Z',
    source_effective_date: usd.date < eur.date ? usd.date : eur.date,
    fed_funds: usd.value.toFixed(4),
    ecb_deposit: eur.value.toFixed(4),
    usd_minus_eur_policy_rate: diff.toFixed(4),
    policy_diff_change_5d: (diff - diff5).toFixed(4),
    policy_diff_change_20d: (diff - diff20).toFixed(4),
    bias: c.bias,
    environment: c.environment,
    confidence: c.confidence.toFixed(4),
    freshness: 'CURRENT',
    event_risk_next_24h: 'UNKNOWN'
  });
}

if (out.length < 2000) throw new Error('Policy proxy output unexpectedly short: ' + out.length);

await fs.mkdir(path.dirname(OUT), { recursive: true });
const headers = Object.keys(out[0]);
await fs.writeFile(
  OUT,
  [headers.join(','), ...out.map((row) => headers.map((h) => row[h]).join(','))].join('\n') + '\n'
);
console.log(JSON.stringify({
  output: path.resolve(OUT),
  rows: out.length,
  start: out[0].timestamp,
  end: out.at(-1).timestamp,
  source: 'FRED DFF + ECBDFR; prior-day observation only'
}, null, 2));
