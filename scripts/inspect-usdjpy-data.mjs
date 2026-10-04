const url = 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDJPY/USDJPYm15.csv';

const res = await fetch(url, {
  headers: { Range: 'bytes=0-4095', 'user-agent': 'Gold-AI-Trader-diagnostic/1.0' }
});
if (!res.ok) throw new Error('HTTP ' + res.status);
const buf = Buffer.from(await res.arrayBuffer());
const text = buf.toString('utf8');
const lines = text.split(/\r?\n/).filter(Boolean).slice(0, 8);

console.log('RAW_HEAD');
for (const line of lines) console.log(line);

const firstData = lines.find((line) => !/^(date|time|datetime|timestamp)/i.test(line));
if (firstData) {
  const fields = firstData.split(/[;,]/);
  console.log('NUMERIC_FIELDS', fields.slice(0, 8).map(Number));
}
