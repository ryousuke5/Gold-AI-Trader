import crypto from 'node:crypto';

const SOURCE = 'NODE_HISTORICAL_ENGINE';
const HASH_RE = /^[a-f0-9]{64}$/;
const SYMBOL_RE = /^(XAUUSD|GOLD#?)$/i;
const SCENARIO_RE = /^[a-z0-9_-]{1,40}$/i;

function cleanText(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.trunc(number);
}

function isoOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function scalarMap(value, maxEntries = 60) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const key of Object.keys(value).sort().slice(0, maxEntries)) {
    const item = value[key];
    if (typeof item === 'string') output[cleanText(key, 64)] = cleanText(item, 160);
    else if (typeof item === 'boolean') output[cleanText(key, 64)] = item;
    else if (typeof item === 'number' && Number.isFinite(item)) output[cleanText(key, 64)] = item;
    else if (item === null) output[cleanText(key, 64)] = null;
  }
  return output;
}

function countMap(value, maxEntries = 40) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const key of Object.keys(value).sort().slice(0, maxEntries)) {
    const count = integerOrNull(value[key]);
    if (count !== null && count >= 0) output[cleanText(key, 80)] = count;
  }
  return output;
}

function metricSummary(value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    trades: integerOrNull(row.trades),
    wins: integerOrNull(row.wins),
    losses: integerOrNull(row.losses),
    win_rate_pct: numberOrNull(row.win_rate_pct),
    profit_factor: numberOrNull(row.profit_factor),
    profit_factor_unbounded: row.profit_factor_unbounded === true || row.profit_factor === Infinity,
    expectancy_R: numberOrNull(row.expectancy_R),
    total_R: numberOrNull(row.total_R),
    net_profit: numberOrNull(row.net_profit),
    return_pct: numberOrNull(row.return_pct),
    max_drawdown: numberOrNull(row.max_drawdown),
    max_drawdown_pct: numberOrNull(row.max_drawdown_pct),
    avg_holding_minutes: numberOrNull(row.avg_holding_minutes),
    stop_exits: integerOrNull(row.stop_exits),
    target_exits: integerOrNull(row.target_exits)
  };
}

function scenarioSummary(value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const shadow = row.post_drawdown_shadow && typeof row.post_drawdown_shadow === 'object'
    ? row.post_drawdown_shadow : {};
  return {
    summary: metricSummary(row.summary),
    recent365: row.recent365 ? metricSummary(row.recent365) : null,
    is1095: row.is1095 ? metricSummary(row.is1095) : null,
    oos730: row.oos730 ? metricSummary(row.oos730) : null,
    positive_years: integerOrNull(row.positiveYears ?? row.positive_years),
    positive_years_with_sample: integerOrNull(row.positiveYearsWithSample ?? row.positive_years_with_sample),
    quality_gate_passed: typeof row.quality_gate_passed === 'boolean'
      ? row.quality_gate_passed
      : (typeof row.qualityGate?.passed === 'boolean' ? row.qualityGate.passed : null),
    diagnostics: (() => {
      const diagnostics = row.diagnostics && typeof row.diagnostics === 'object' ? row.diagnostics : row;
      return {
        signals_evaluated: integerOrNull(diagnostics.signals_evaluated),
        candidates: integerOrNull(diagnostics.candidates),
        candidates_buy: integerOrNull(diagnostics.candidates_buy),
        candidates_sell: integerOrNull(diagnostics.candidates_sell),
        setup_wait_reasons: countMap(diagnostics.setup_wait_reasons),
        risk_gate_blocks: countMap(diagnostics.risk_gate_blocks),
        rejected_next_bar_gap: integerOrNull(diagnostics.rejected_next_bar_gap),
        rejected_entry_gap: integerOrNull(diagnostics.rejected_entry_gap),
        rejected_direction_filter: integerOrNull(diagnostics.rejected_direction_filter)
      };
    })(),
    post_drawdown_shadow: row.post_drawdown_shadow ? {
      trade_count: integerOrNull(shadow.trade_count),
      summary: shadow.summary ? metricSummary(shadow.summary) : null
    } : null
  };
}

function costScenarioMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const name of Object.keys(value).sort().slice(0, 8)) {
    if (!SCENARIO_RE.test(name)) continue;
    const row = value[name] && typeof value[name] === 'object' ? value[name] : {};
    output[name] = {
      spread_price: numberOrNull(row.spread_price),
      slippage_price: numberOrNull(row.slippage_price)
    };
  }
  return output;
}

function normalizeCore(input) {
  const symbol = cleanText(input.symbol, 24).toUpperCase();
  const timeframe = cleanText(input.timeframe, 8).toUpperCase();
  const strategyVersion = cleanText(input.strategy_version, 120);
  const evaluationMode = cleanText(input.evaluation_mode, 80);
  const periodStart = isoOrNull(input.period_start);
  const periodEnd = isoOrNull(input.period_end);
  if (!SYMBOL_RE.test(symbol)) return { ok: false, error: 'unsupported_symbol' };
  if (timeframe !== 'M5') return { ok: false, error: 'unsupported_timeframe' };
  if (!strategyVersion) return { ok: false, error: 'strategy_version_required' };
  if (!evaluationMode) return { ok: false, error: 'evaluation_mode_required' };
  if (!periodStart || !periodEnd || Date.parse(periodStart) >= Date.parse(periodEnd)) {
    return { ok: false, error: 'invalid_test_period' };
  }

  const inputSummary = input.summary && typeof input.summary === 'object' && !Array.isArray(input.summary)
    ? input.summary : {};
  const scenariosInput = inputSummary.scenarios && typeof inputSummary.scenarios === 'object' &&
    !Array.isArray(inputSummary.scenarios) ? inputSummary.scenarios : {};
  const scenarios = {};
  for (const name of Object.keys(scenariosInput).sort().slice(0, 8)) {
    if (!SCENARIO_RE.test(name)) continue;
    scenarios[name] = scenarioSummary(scenariosInput[name]);
  }
  if (Object.keys(scenarios).length === 0) return { ok: false, error: 'backtest_scenarios_required' };

  return {
    ok: true,
    core: {
      source: SOURCE,
      symbol,
      timeframe,
      strategy_version: strategyVersion,
      evaluation_mode: evaluationMode,
      period_start: periodStart,
      period_end: periodEnd,
      summary: {
        data_source: scalarMap(inputSummary.data_source, 8),
        strategy_parameters: scalarMap(inputSummary.strategy_parameters, 80),
        assumptions: scalarMap(inputSummary.assumptions, 40),
        cost_scenarios: costScenarioMap(inputSummary.cost_scenarios),
        scenarios
      }
    }
  };
}

function hashCore(core) {
  return crypto.createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex');
}

/**
 * Reduces the existing Node historical backtest report to aggregate statistics only.
 * No OHLCV bars, quotes, per-trade records, or CSV rows are included.
 */
export function buildGoldBacktestSummary(report = {}) {
  const period = report.test_period && typeof report.test_period === 'object' ? report.test_period : {};
  const results = report.results && typeof report.results === 'object' && !Array.isArray(report.results)
    ? report.results : {};
  const scenarios = {};
  for (const name of Object.keys(results).sort().slice(0, 8)) {
    if (!SCENARIO_RE.test(name)) continue;
    const row = results[name] || {};
    scenarios[name] = {
      summary: row.summary,
      recent365: row.recent365,
      is1095: row.is1095,
      oos730: row.oos730,
      positiveYears: row.positiveYears,
      positiveYearsWithSample: row.positiveYearsWithSample,
      qualityGate: row.qualityGate,
      signals_evaluated: row.signals_evaluated,
      candidates: row.candidates,
      candidates_buy: row.candidates_buy,
      candidates_sell: row.candidates_sell,
      setup_wait_reasons: row.setup_wait_reasons,
      risk_gate_blocks: row.risk_gate_blocks,
      rejected_next_bar_gap: row.rejected_next_bar_gap,
      rejected_entry_gap: row.rejected_entry_gap,
      rejected_direction_filter: row.rejected_direction_filter,
      post_drawdown_shadow: row.post_drawdown_shadow
    };
  }

  const rawDataSource = report.data_source && typeof report.data_source === 'object'
    ? report.data_source : { source: report.data_source || '' };
  const candidate = {
    source: SOURCE,
    symbol: cleanText(report.instrument || 'XAUUSD', 24).toUpperCase(),
    timeframe: 'M5',
    strategy_version: cleanText(report.strategy_variant || report.strategy || 'unknown', 120),
    evaluation_mode: cleanText(report.evaluation_mode || 'UNSPECIFIED', 80),
    period_start: period.start || report.source_period?.m5_first || '',
    period_end: period.end || report.source_period?.m5_last || '',
    summary: {
      data_source: scalarMap(rawDataSource, 8),
      strategy_parameters: scalarMap(report.strategy_parameters, 80),
      assumptions: scalarMap(report.assumptions, 40),
      cost_scenarios: costScenarioMap(report.cost_scenarios),
      scenarios
    }
  };
  const normalized = normalizeCore(candidate);
  if (!normalized.ok) throw new Error(normalized.error);
  const core = normalized.core;
  return { ...core, run_key: hashCore(core) };
}

/**
 * Validates and whitelists a compact summary arriving at the authenticated API.
 * The run key is a digest of the normalized payload, making retries idempotent.
 */
export function validateGoldBacktestSummaryPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'invalid_payload' };
  }
  const runKey = cleanText(payload.run_key, 64);
  if (!HASH_RE.test(runKey)) return { ok: false, error: 'invalid_run_key' };
  if (payload.source !== SOURCE) return { ok: false, error: 'unsupported_source' };
  const normalized = normalizeCore(payload);
  if (!normalized.ok) return normalized;
  const expectedRunKey = hashCore(normalized.core);
  if (runKey !== expectedRunKey) return { ok: false, error: 'run_key_mismatch' };
  const row = {
    run_key: runKey,
    ...normalized.core,
    created_at: new Date().toISOString()
  };
  if (Buffer.byteLength(JSON.stringify(row), 'utf8') > 24 * 1024) {
    return { ok: false, error: 'summary_payload_too_large' };
  }
  return { ok: true, row };
}

export async function uploadGoldBacktestSummary(report, {
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch
} = {}) {
  const payload = buildGoldBacktestSummary(report);
  const urlText = cleanText(baseUrl, 500);
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!urlText || !key) throw new Error('GOLD_BACKTEST_API_URL and GOLD_API_KEY are required for automatic upload');
  const url = new URL(urlText);
  if (url.protocol !== 'https:') throw new Error('GOLD_BACKTEST_API_URL must use HTTPS');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable in this Node.js runtime');

  const response = await fetchImpl(new URL('/api/gold/backtest-summary', url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-gold-api-key': key
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const responseText = await response.text();
  let result = {};
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error('Backtest summary upload returned a non-JSON response');
  }
  if (!response.ok || result.ok !== true || result.persisted !== true) {
    throw new Error(result.error || `Backtest summary upload failed (HTTP ${response.status})`);
  }
  return { ok: true, run_key: payload.run_key, persisted: true, duplicate: result.duplicate === true };
}
