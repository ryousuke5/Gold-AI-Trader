import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BACKTEST_M15_SOURCE ??= 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDJPY/USDJPYm15.csv';
process.env.BACKTEST_H1_SOURCE ??= 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/USDJPY/USDJPYh1.csv';
const outDir = process.env.BACKTEST_OUTPUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backtest-output-usdjpy');
process.env.BACKTEST_OUTPUT_DIR = outDir;

const { runBacktest } = await import('./backtest-usdjpy.mjs');
await runBacktest();
const fsPath = path.join(outDir, 'usdjpy_backtest_report.json');
const report = JSON.parse(await fs.readFile(fsPath, 'utf8'));
report.symbol = 'USDJPY';
report.strategy = 'USDJPY M15 range breakout + H1 trend with JPY-to-USD PnL conversion';
report.assumptions.pnl_conversion = 'JPY realized PnL converted to USD using exit price';
await fs.writeFile(fsPath, JSON.stringify(report, null, 2));
console.log('=== USDJPY RESEARCH ===');
console.log('Symbol:', report.symbol);
console.log('Strategy:', report.strategy);
