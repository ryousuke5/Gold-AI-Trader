import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const python = process.platform === 'win32' ? 'python' : 'python3';
const script = path.join(here, 'fetch-xauusd-m5.py');

const child = spawn(python, [script, ...process.argv.slice(2)], {
  stdio: 'inherit'
});

child.on('error', (error) => {
  console.error('Failed to start Python data fetcher:', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error('Python data fetcher terminated by signal:', signal);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
