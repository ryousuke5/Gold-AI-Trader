import fs from 'node:fs/promises';
import path from 'node:path';

const inputDir = path.resolve(process.env.GOLD_BACKTEST_OUTPUT_DIR || 'gold-backtest-output');
const outputDir = path.resolve(process.env.GOLD_CANDIDATE_DIAGNOSTICS_DIR || inputDir);
await fs.mkdir(outputDir, { recursive: true });

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  values.push(value);
  return values;
}

async function readCsv(file) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.trim().split(/\r?\n/);
  if (!lines[0]) return [];
  const fields = parseCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(fields.map((field, i) => [field, values[i] ?? '']));
  });
}

const report = JSON.parse(await fs.readFile(path.join(inputDir, 'gold_v2_backtest_report.json'), 'utf8'));
const scenarios = ['baseline', 'conservative'];
const latest = Date.parse(report.source_period.m5_last) / 1000;
if (!Number.isFinite(latest)) throw new Error('Missing latest timestamp in backtest report');
const oosStart = latest - 730 * 86400;
const isStart = oosStart - 1095 * 86400;
const recentStart = latest - 365 * 86400;

function periodOf(event) {
  if (event.signal_time >= recentStart) return 'recent365';
  if (event.signal_time >= oosStart) return 'OOS_730d';
  if (event.signal_time >= isStart) return 'IS_1095d';
  return 'outside_IS_OOS_window';
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function mean(items, getter) {
  const vals = items.map(getter).filter(Number.isFinite);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}
function metrics(items, outcomeGetter) {
  const outcomes = items.map(outcomeGetter).filter(Boolean);
  const rs = outcomes.map(x => num(x.net_r)).filter(Number.isFinite);
  const wins = outcomes.filter(x => num(x.net_r) > 0);
  const losses = outcomes.filter(x => num(x.net_r) < 0);
  const grossWin = wins.reduce((s, x) => s + Math.max(0, num(x.net_pnl) ?? (num(x.net_r) ?? 0)), 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + Math.min(0, num(x.net_pnl) ?? (num(x.net_r) ?? 0)), 0));
  return {
    n: outcomes.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: outcomes.length ? wins.length / outcomes.length * 100 : null,
    mean_r: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    profit_factor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? null : 0),
    exit_reasons: Object.fromEntries([...new Set(outcomes.map(x => x.exit_reason ?? 'UNKNOWN'))].sort().map(k => [k, outcomes.filter(x => (x.exit_reason ?? 'UNKNOWN') === k).length]))
  };
}

function grouped(events, groupFn) {
  const groups = new Map();
  for (const e of events) {
    const key = groupFn(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, items]) => ({
    group: key,
    candidates: items.length,
    decisions: Object.fromEntries([...new Set(items.map(x => x.admission_decision))].sort().map(k => [k, items.filter(x => x.admission_decision === k).length])),
    actual: metrics(items, x => x.actual_outcome),
    rr_only_shadow: metrics(items, x => x.counterfactual_rr_only_outcome)
  }));
}

function flattenEvent(e, scenario) {
  const d = e.setup_diagnostics || {};
  const h = e.h1_at_signal || {};
  const m = e.signal_bar || {};
  const o = e.actual_outcome || {};
  const sh = e.counterfactual_rr_only_outcome || {};
  return {
    cost_scenario: scenario,
    signal_time_utc: e.signal_time_utc,
    year_utc: e.year_utc,
    period: periodOf(e),
    side: e.side,
    hour_utc: e.hour_utc,
    setup_type: e.setup_type,
    h1_close_vs_ema20_atr: h.close_vs_ema20_atr,
    h1_ema20_vs_ema50_atr: h.ema20_vs_ema50_atr,
    h1_ema50_vs_ema200_atr: h.ema50_vs_ema200_atr,
    h1_rsi14: h.rsi14,
    strict_bull_stack: h.strict_bull_stack,
    strict_bear_stack: h.strict_bear_stack,
    m5_rsi14: m.rsi14,
    m5_close_vs_ema20_atr: m.close_vs_ema20_atr,
    range_atr: d.range_atr,
    breakout_atr: d.breakout_atr,
    body_atr: d.body_atr,
    close_location: d.close_location,
    volume_ratio: d.volume_ratio,
    extension_atr: d.extension_atr,
    stop_atr: d.stop_atr,
    entry_gap_atr: e.entry_metrics?.entry_gap_atr ?? null,
    effective_rr: e.entry_metrics?.effective_rr ?? null,
    rr_floor: e.entry_metrics?.effective_rr_floor ?? null,
    rr_margin: e.entry_metrics?.margin_to_rr_floor ?? null,
    decision: e.admission_decision,
    actual_exit_reason: o.exit_reason ?? null,
    actual_net_r: o.net_r ?? null,
    actual_mfe_r: o.mfe_r ?? null,
    actual_mae_r: o.mae_r ?? null,
    shadow_exit_reason: sh.exit_reason ?? null,
    shadow_net_r: sh.net_r ?? null,
    shadow_mfe_r: sh.mfe_r ?? null,
    shadow_mae_r: sh.mae_r ?? null,
    shadow_holding_minutes: sh.holding_minutes ?? null
  };
}

const all = {};
const violations = [];

for (const scenario of scenarios) {
  const scenarioReport = report.results?.[scenario];
  if (!scenarioReport) throw new Error('Missing report scenario: ' + scenario);
  const events = JSON.parse(await fs.readFile(path.join(inputDir, 'gold_v2_candidate_events_' + scenario + '.json'), 'utf8'));
  const trades = await readCsv(path.join(inputDir, 'gold_v2_trades_' + scenario + '.csv'));
  const funnel = scenarioReport.funnel_diagnostics;
  if (!Array.isArray(events)) throw new Error(scenario + ': candidate events are not an array');
  if (events.length !== Number(scenarioReport.candidates)) throw new Error(scenario + ': candidate event count differs from candidate counter');
  if (trades.length !== Number(scenarioReport.summary.trades)) throw new Error(scenario + ': trade CSV count differs from summary');
  const count = decision => events.filter(e => e.admission_decision === decision).length;
  const counts = {
    accepted: count('ACCEPTED'),
    rr_rejected: count('REJECTED_EFFECTIVE_RR'),
    entry_gap_rejected: count('REJECTED_ENTRY_GAP'),
    geometry_rejected: count('REJECTED_INVALID_GEOMETRY'),
    risk_gate_blocked: count('RISK_GATE_BLOCKED'),
    next_bar_gap: count('NEXT_BAR_DATA_GAP'),
    other_rejections: events.filter(e => e.admission_decision.startsWith('REJECTED_') || e.admission_decision === 'SIMULATION_REJECTED_OTHER').length
  };
  const checks = [
    ['accepted count', counts.accepted, Number(scenarioReport.summary.trades)],
    ['RR rejection count', counts.rr_rejected, Number(scenarioReport.rejected_effective_rr)],
    ['entry gap rejection count', counts.entry_gap_rejected, Number(scenarioReport.rejected_entry_gap)],
    ['geometry rejection count', counts.geometry_rejected, Number(funnel.rejected_invalid_geometry)],
    ['risk gate block count', counts.risk_gate_blocked, Number(funnel.risk_gate_blocked_candidates)],
    ['next-bar gap count', counts.next_bar_gap, Number(funnel.rejected_next_bar_gap)]
  ];
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) violations.push({ scenario, check: label, actual, expected });
  }

  const acceptedKeys = events.filter(e => e.actual_outcome).map(e => String(e.signal_time) + ':' + String(e.actual_outcome.entry_time)).sort();
  const tradeKeys = trades.map(t => String(Number(t.signal_time)) + ':' + String(Number(t.entry_time))).sort();
  if (JSON.stringify(acceptedKeys) !== JSON.stringify(tradeKeys)) {
    violations.push({ scenario, check: 'accepted candidate/trade identities', acceptedKeys, tradeKeys });
  }

  for (const event of events) {
    if (!['BUY', 'SELL'].includes(event.side)) violations.push({ scenario, check: 'invalid candidate side', signal_time: event.signal_time, side: event.side });
    if (event.admission_decision === 'REJECTED_EFFECTIVE_RR' && !event.counterfactual_rr_only_outcome) {
      event.shadow_simulation_status = 'NO_RESULT';
    } else if (event.counterfactual_rr_only_outcome) {
      event.shadow_simulation_status = 'HYPOTHETICAL_ONLY';
    } else {
      event.shadow_simulation_status = 'NOT_APPLICABLE';
    }
    event.period = periodOf(event);
  }

  all[scenario] = {
    scenario,
    candidate_count: events.length,
    trade_count: trades.length,
    decision_counts: counts,
    wait_reasons_top: Object.entries(funnel.setup_wait_reasons || {})
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([reason, count]) => ({ reason, count, pct_of_evaluated: funnel.signals_evaluated ? Number(count) / Number(funnel.signals_evaluated) * 100 : 0 })),
    all_candidates: {
      by_side: grouped(events, e => e.side),
      by_utc_hour: grouped(events, e => String(e.hour_utc).padStart(2, '0') + ':00'),
      by_year: grouped(events, e => e.year_utc),
      by_period: grouped(events, e => e.period),
      accepted_actual_outcomes: metrics(events, e => e.actual_outcome),
      rr_rejected_counterfactual_only: metrics(events, e => e.counterfactual_rr_only_outcome)
    },
    feature_means_by_disposition: [...new Set(events.map(e => e.admission_decision))].sort().map(decision => {
      const items = events.filter(e => e.admission_decision === decision);
      const get = key => e => num(e.setup_diagnostics?.[key]);
      return {
        decision,
        n: items.length,
        effective_rr_mean: mean(items, e => num(e.entry_metrics?.effective_rr)),
        range_atr_mean: mean(items, get('range_atr')),
        breakout_atr_mean: mean(items, get('breakout_atr')),
        body_atr_mean: mean(items, get('body_atr')),
        close_location_mean: mean(items, get('close_location')),
        volume_ratio_mean: mean(items, get('volume_ratio')),
        extension_atr_mean: mean(items, get('extension_atr')),
        stop_atr_mean: mean(items, get('stop_atr')),
        actual_mean_r: mean(items, e => num(e.actual_outcome?.net_r)),
        rr_only_shadow_mean_r: mean(items, e => num(e.counterfactual_rr_only_outcome?.net_r))
      };
    }),
    events
  };
}

if (violations.length) {
  throw new Error('Candidate quality diagnostics integrity checks failed: ' + JSON.stringify(violations));
}

const baseline = all.baseline;
const flattened = scenarios.flatMap(scenario => all[scenario].events.map(e => flattenEvent(e, scenario)));
const result = {
  generated_at: new Date().toISOString(),
  research_only: true,
  live_orders_changed: false,
  instrument: report.instrument,
  data_source: report.data_source,
  source_period: report.source_period,
  data_rows: report.data_quality?.rows,
  server_timezone: report.server_timezone,
  test_contract: 'Candidate details are diagnostic only. RR-only shadow results are isolated per-opportunity counterfactuals, can overlap, and are not added to portfolio results.',
  candidate_scarcity: {
    five_year_signals_evaluated: baseline.funnel_diagnostics.signals_evaluated,
    five_year_candidates: baseline.candidates,
    candidate_rate_pct: baseline.funnel_diagnostics.signals_evaluated ? baseline.candidates / baseline.funnel_diagnostics.signals_evaluated * 100 : 0,
    wait_reason_counts: baseline.wait_reasons_top,
    candidate_decisions: baseline.decision_counts
  },
  integrity_violations: violations,
  scenarios: all
};

await fs.writeFile(path.join(outputDir, 'gold_v2_candidate_quality_diagnostics.json'), JSON.stringify(result, null, 2));

const csvFields = Object.keys(flattened[0] || { cost_scenario: '', signal_time_utc: '' });
const csvEscape = value => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
};
await fs.writeFile(
  path.join(outputDir, 'gold_v2_candidate_quality_events.csv'),
  [csvFields.join(','), ...flattened.map(row => csvFields.map(key => csvEscape(row[key])).join(','))].join('\n') + '\n'
);

const f = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? 'N/A' : Number(value).toFixed(3);
const markdown = [
  '# GOLD V2 candidate signal quality diagnostics',
  '',
  '**Research-only diagnostics. No strategy or live-order setting was changed.** The current strict setup generated ' + baseline.candidate_count + ' candidates from ' + baseline.funnel_diagnostics.signals_evaluated + ' evaluated signal bars over the five-year dataset.',
  '',
  'RR-only shadow outcomes are isolated, hypothetical paths that bypass only the RR floor. They are excluded from accepted-trade, equity, PF, expectancy and drawdown calculations. Shadow opportunities may overlap, so they must not be interpreted as a tradable portfolio.',
  '',
  '## Candidate disposition by cost scenario',
  '',
  '| Cost scenario | Candidates | Accepted | RR rejected | Entry-gap rejected | Geometry rejected | Risk-gate blocked | Next-bar gaps |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'
];
for (const scenario of scenarios) {
  const x = all[scenario];
  markdown.push('| ' + [
    scenario, x.candidate_count, x.decision_counts.accepted, x.decision_counts.rr_rejected,
    x.decision_counts.entry_gap_rejected, x.decision_counts.geometry_rejected,
    x.decision_counts.risk_gate_blocked, x.decision_counts.next_bar_gap
  ].join(' | ') + ' |');
}
markdown.push(
  '',
  '## Candidate-level feature and outcome details (baseline costs)',
  '',
  '| UTC signal time | Side | Hour | H1 RSI | H1 close−EMA20 / ATR | H1 EMA20−50 / ATR | Range ATR | Breakout ATR | Body ATR | Close location | Volume ratio | Stop ATR | Entry gap ATR | Effective RR | Decision | Actual R | Actual exit | RR-only shadow R | Shadow exit |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---:|---|'
);
for (const e of baseline.events) {
  const d = e.setup_diagnostics || {};
  const h = e.h1_at_signal || {};
  const actual = e.actual_outcome || {};
  const shadow = e.counterfactual_rr_only_outcome || {};
  markdown.push('| ' + [
    e.signal_time_utc, e.side, e.hour_utc, f(h.rsi14), f(h.close_vs_ema20_atr), f(h.ema20_vs_ema50_atr),
    f(d.range_atr), f(d.breakout_atr), f(d.body_atr), f(d.close_location), f(d.volume_ratio), f(d.stop_atr),
    f(e.entry_metrics?.entry_gap_atr), f(e.entry_metrics?.effective_rr), e.admission_decision,
    f(actual.net_r), actual.exit_reason ?? '—', f(shadow.net_r), shadow.exit_reason ?? '—'
  ].join(' | ') + ' |');
}
markdown.push('', '## Actual accepted outcomes by side / hour / year (baseline costs)', '',
  '| Group | Candidates | Decision counts | Actual outcomes | Mean R | PF |',
  '|---|---:|---|---:|---:|---:|');
for (const dimension of ['by_side', 'by_utc_hour', 'by_year', 'by_period']) {
  for (const row of baseline.all_candidates[dimension]) {
    markdown.push('| ' + [
      dimension + ': ' + row.group, row.candidates, JSON.stringify(row.decisions),
      row.actual.n, f(row.actual.mean_r), f(row.actual.profit_factor)
    ].join(' | ') + ' |');
  }
}
markdown.push('', '## WAIT reason distribution', '',
  '| Reason | Count | Share of evaluated bars |',
  '|---|---:|---:|');
for (const row of baseline.wait_reasons_top) {
  markdown.push('| ' + [row.reason, row.count, f(row.pct_of_evaluated) + '%'].join(' | ') + ' |');
}
markdown.push('', '## Conclusions and limits', '',
  '- Candidate frequency is extremely low; inspect candidate construction and data/time gating before fine-tuning RR thresholds.',
  '- Any apparent differences by side, UTC hour or year are descriptive only because candidate counts are tiny.',
  '- Compare actual accepted trade outcomes separately from RR-only shadow outcomes; do not combine the two.',
  '- Backtest outcomes are based on M5 OHLC; exact intrabar event ordering is not observable.',
  '- No production RR floor or strategy threshold is recommended by this report.',
  '');
await fs.writeFile(path.join(outputDir, 'gold_v2_candidate_quality_diagnostics.md'), markdown.join('\n'));

console.log('GOLD V2 CANDIDATE QUALITY DIAGNOSTICS PASS', JSON.stringify({
  scenarios,
  candidates_baseline: baseline.candidate_count,
  decisions_baseline: baseline.decision_counts,
  integrity_violations: violations.length,
  json: path.join(outputDir, 'gold_v2_candidate_quality_diagnostics.json'),
  csv: path.join(outputDir, 'gold_v2_candidate_quality_events.csv'),
  markdown: path.join(outputDir, 'gold_v2_candidate_quality_diagnostics.md')
}));
