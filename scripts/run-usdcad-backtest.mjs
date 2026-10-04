import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BACKTEST_M15_SOURCE ??= 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDCAD/USDCADm15.csv';
process.env.BACKTEST_H1_SOURCE ??= 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDCAD/USDCADh1.csv';
const outDir = process.env.BACKTEST_OUTPUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backtest-output-usdcad');
process.env.BACKTEST_OUTPUT_DIR = outDir;
const { runBacktest } = await import('./backtest-usdcad.mjs');
await runBacktest();
const reportPath = path.join(outDir, 'usdcad_backtest_report.json');
const report = JSON.parse(await fs.readFile(reportPath,'utf8'));
report.symbol='USDCAD';
report.strategy='USDCAD M15 range breakout + H1 trend with CAD-to-USD PnL conversion';
await fs.writeFile(reportPath,JSON.stringify(report,null,2));
console.log('=== USDCAD RESEARCH ===');
console.log('Symbol:',report.symbol);
