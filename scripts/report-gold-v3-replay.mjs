import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = path.resolve(process.env.GOLD_V3_REPLAY_OUTPUT_DIR || 'gold-v3-replay');
const DATA = path.resolve(process.env.GOLD_V3_REPLAY_DATASET || path.join(DIR, 'gold_v3_frequency_replay.jsonl'));
const REPORT = path.join(DIR, 'report.json');

async function readRows(file) {
  const text = await fs.readFile(file, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function summarize(trades) {
  const values = trades.map((trade) => Number(trade.net_r)).filter(Number.isFinite);
  const wins = values.filter((value) => value > 0);
  const losses = values.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = -losses.reduce((sum, value) => sum + value, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const bySide = {};
  const byExit = {};
  const monthly = {};
  for (const trade of trades) {
    const side = trade.side || trade.candidate || 'UNKNOWN';
    const exit = trade.exit_reason || 'UNKNOWN';
    bySide[side] = bySide[side] || { trades: 0, net_r: 0 };
    bySide[side].trades++;
    bySide[side].net_r += Number(trade.net_r) || 0;
    byExit[exit] = byExit[exit] || { trades: 0, net_r: 0 };
    byExit[exit].trades++;
    byExit[exit].net_r += Number(trade.net_r) || 0;
    const exitEpoch = Number(trade.exit_time);
    const month = Number.isFinite(exitEpoch)
      ? new Date(exitEpoch * 1000).toISOString().slice(0, 7)
      : 'UNKNOWN';
    monthly[month] = monthly[month] || { trades: 0, net_r: 0 };
    monthly[month].trades++;
    monthly[month].net_r += Number(trade.net_r) || 0;
  }
  const monthlyValues = Object.values(monthly);
  return {
    trades: values.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: values.length - wins.length - losses.length,
    win_rate_pct: values.length ? wins.length / values.length * 100 : 0,
    gross_profit_r: grossProfit,
    gross_loss_r: grossLoss,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
    expectancy_r: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    net_r: values.reduce((sum, value) => sum + value, 0),
    max_drawdown_r: maxDrawdown,
    average_win_r: wins.length ? grossProfit / wins.length : 0,
    average_loss_r: losses.length ? grossLoss / losses.length : 0,
    by_side: bySide,
    by_exit_reason: byExit,
    monthly_net_r: monthly,
    profitable_months: monthlyValues.filter((item) => item.net_r > 0).length,
    losing_months: monthlyValues.filter((item) => item.net_r < 0).length
  };
}

const rows = await readRows(DATA);
const baselineTrades = [];
const stressTrades = [];
const reasons = { baseline: {}, stress: {} };
for (const row of rows) {
  for (const scenario of ['baseline', 'stress']) {
    const execution = row.execution?.[scenario];
    if (execution?.traded) {
      const trade = { ...execution, candidate: row.candidate };
      (scenario === 'baseline' ? baselineTrades : stressTrades).push(trade);
    } else {
      const reason = String(execution?.reason || 'missing_execution_result');
      reasons[scenario][reason] = (reasons[scenario][reason] || 0) + 1;
    }
  }
}
const manifest = JSON.parse(await fs.readFile(path.join(DIR, 'manifest.json'), 'utf8'));
const report = {
  created_at: new Date().toISOString(),
  strategy_version: 'gold-h1-m5-expanded-pullback-reaccel-v3',
  source_fingerprint: manifest.source_data?.content_sha256,
  period: manifest.period,
  candidates: {
    v2_candidate_count: manifest.v2_comparison?.candidate_count ?? null,
    v3_candidate_count: manifest.v3?.candidate_count ?? rows.length,
    v3_vs_v2_ratio: manifest.v2_comparison?.candidate_count
      ? (manifest.v3?.candidate_count ?? rows.length) / manifest.v2_comparison.candidate_count
      : null
  },
  cost_scenarios: manifest.cost_scenarios,
  baseline: summarize(baselineTrades),
  stress: summarize(stressTrades),
  skipped_execution_reasons: reasons,
  limitations: [
    'This is a deterministic OHLC replay, not a broker tick-by-tick fill simulation.',
    'The spread and slippage scenarios are fixed assumptions; the historical quote sample is not mapped to every trade timestamp.',
    'OHLC bars cannot reveal intrabar event order; when stop and target are both touched in one M5 candle, stop is assumed first.',
    'The input must use UTC timestamps; server-local MT4 history needs historical DST normalization.',
    'Swap/financing and account-specific commissions are not modeled in this first pass.',
    'This result is research-only and does not approve live trading.'
  ]
};
await fs.writeFile(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
