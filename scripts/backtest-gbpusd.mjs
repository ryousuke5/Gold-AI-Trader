import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BACKTEST_M15_SOURCE ??= 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/GBPUSD/GBPUSDm15.csv';
process.env.BACKTEST_H1_SOURCE ??= 'https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/GBPUSD/GBPUSDh1.csv';
const outDir = process.env.BACKTEST_OUTPUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backtest-output-gbpusd');
process.env.BACKTEST_OUTPUT_DIR = outDir;

const { runBacktest } = await import('./backtest-eurusd.mjs');
const result = await runBacktest();

result.report.strategy = 'GBPUSD M15 range breakout + H1 trend (research adapter)';
result.report.symbol = 'GBPUSD';
result.report.data_source = {
  m15: process.env.BACKTEST_M15_SOURCE,
  h1: process.env.BACKTEST_H1_SOURCE
};

await fs.writeFile(path.join(outDir, 'gbpusd_backtest_report.json'), JSON.stringify(result.report, null, 2));
await fs.rename(path.join(outDir, 'eurusd_trades.csv'), path.join(outDir, 'gbpusd_trades.csv'));
await fs.rm(path.join(outDir, 'eurusd_backtest_report.json'), { force: true });

console.log('=== GBPUSD RESEARCH ADAPTER ===');
console.log('Symbol:', result.report.symbol);
console.log('Strategy:', result.report.strategy);
