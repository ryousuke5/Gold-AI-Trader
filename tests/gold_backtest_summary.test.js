import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoldBacktestSummary,
  validateGoldBacktestSummaryPayload,
  uploadGoldBacktestSummary
} from '../src/gold_backtest_summary.js';

function sampleReport(overrides = {}) {
  return {
    strategy: 'GOLD V2 deterministic backtest',
    strategy_variant: 'gold_v2',
    evaluation_mode: 'FULL_HISTORY_WITH_IS_OOS_SPLIT',
    instrument: 'XAUUSD',
    data_source: { m5: 'DUKASCOPY_XAUUSD', h1: 'FROM_M5' },
    test_period: {
      start: '2020-01-01T00:00:00.000Z',
      end: '2026-01-01T00:00:00.000Z'
    },
    strategy_parameters: { rangeLookback: 12, minRangeAtr: 0.8 },
    assumptions: { execution: 'next M5 bar open', risk_per_trade_pct: 0.25 },
    cost_scenarios: {
      baseline: { spread_price: 0.35, slippage_price: 0.05 },
      conservative: { spread_price: 0.5, slippage_price: 0.1 }
    },
    results: {
      baseline: {
        summary: {
          trades: 42, wins: 24, losses: 18, win_rate_pct: 57.14,
          profit_factor: 1.35, expectancy_R: 0.12, total_R: 5.04,
          net_profit: 504, return_pct: 5.04, max_drawdown: 180,
          max_drawdown_pct: 1.8, avg_holding_minutes: 65,
          stop_exits: 18, target_exits: 24
        },
        recent365: { trades: 10, profit_factor: 1.2, expectancy_R: 0.1, max_drawdown_pct: 1.0 },
        is1095: { trades: 30, profit_factor: 1.3, expectancy_R: 0.11, max_drawdown_pct: 1.5 },
        oos730: { trades: 12, profit_factor: 1.1, expectancy_R: 0.05, max_drawdown_pct: 1.8 },
        positiveYears: 4,
        positiveYearsWithSample: 3,
        qualityGate: { passed: true },
        signals_evaluated: 800,
        candidates: 45,
        candidates_buy: 26,
        candidates_sell: 19,
        setup_wait_reasons: { range_too_wide: 20, volume_expansion_filter: 10 },
        risk_gate_blocks: { spread_limit: 3 },
        post_drawdown_shadow: { trade_count: 5, summary: { trades: 5, expectancy_R: -0.1 } },
        trades: [{ entry: 2300, exit: 2302, net_pnl: 20 }]
      },
      conservative: {
        summary: { trades: 40, profit_factor: 1.1, expectancy_R: 0.04, max_drawdown_pct: 2.2 },
        qualityGate: { passed: false }
      }
    },
    ...overrides
  };
}

test('builds a compact aggregate-only payload with a deterministic idempotency key', () => {
  const first = buildGoldBacktestSummary(sampleReport());
  const second = buildGoldBacktestSummary(sampleReport());
  assert.equal(first.run_key, second.run_key);
  assert.match(first.run_key, /^[a-f0-9]{64}$/);
  assert.equal(first.source, 'NODE_HISTORICAL_ENGINE');
  assert.equal(first.symbol, 'XAUUSD');
  assert.equal(first.summary.scenarios.baseline.summary.trades, 42);
  assert.equal(first.summary.scenarios.baseline.summary.profit_factor, 1.35);
  assert.equal(first.summary.scenarios.baseline.oos730.trades, 12);
  assert.equal(first.summary.scenarios.baseline.quality_gate_passed, true);
  assert.equal(first.summary.scenarios.baseline.diagnostics.candidates, 45);
  assert.equal(first.summary.scenarios.baseline.trades, undefined);
  assert.equal(first.summary.scenarios.baseline.summary.entry, undefined);
  assert.equal(first.summary.data_source.m5, 'DUKASCOPY_XAUUSD');
  assert.equal(JSON.stringify(first).includes('"open"'), false);
  assert.equal(JSON.stringify(first).includes('"high"'), false);
  assert.equal(JSON.stringify(first).includes('"low"'), false);
  assert.equal(JSON.stringify(first).includes('"net_pnl"'), false);
});

test('normalizes infinite profit factor as an explicit unbounded flag', () => {
  const payload = buildGoldBacktestSummary(sampleReport({
    results: { baseline: { summary: { trades: 1, profit_factor: Infinity } } }
  }));
  assert.equal(payload.summary.scenarios.baseline.summary.profit_factor, null);
  assert.equal(payload.summary.scenarios.baseline.summary.profit_factor_unbounded, true);
});

test('API validator accepts a correctly hashed summary and rejects tampering', () => {
  const payload = buildGoldBacktestSummary(sampleReport());
  const accepted = validateGoldBacktestSummaryPayload(payload);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.row.run_key, payload.run_key);
  assert.equal(accepted.row.source, 'NODE_HISTORICAL_ENGINE');

  const tampered = {
    ...payload,
    summary: {
      ...payload.summary,
      scenarios: {
        ...payload.summary.scenarios,
        baseline: {
          ...payload.summary.scenarios.baseline,
          summary: { ...payload.summary.scenarios.baseline.summary, trades: 999 }
        }
      }
    }
  };
  assert.deepEqual(validateGoldBacktestSummaryPayload(tampered), {
    ok: false, error: 'run_key_mismatch'
  });
});

test('rejects invalid symbols, timeframes, periods, and missing scenarios', () => {
  assert.throws(() => buildGoldBacktestSummary(sampleReport({ instrument: 'EURUSD' })), /unsupported_symbol/);
  assert.throws(() => buildGoldBacktestSummary(sampleReport({
    test_period: { start: '2026-02-01T00:00:00Z', end: '2026-01-01T00:00:00Z' }
  })), /invalid_test_period/);
  assert.throws(() => buildGoldBacktestSummary(sampleReport({ results: {} })), /backtest_scenarios_required/);
});

test('uploads only the compact payload to the authenticated summary endpoint', async () => {
  let capturedUrl = '';
  let capturedOptions = null;
  const result = await uploadGoldBacktestSummary(sampleReport(), {
    baseUrl: 'https://gold-ai-trader-1.onrender.com',
    apiKey: 'test-api-key-value',
    fetchImpl: async (url, options) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, persisted: true, duplicate: false })
      };
    }
  });
  assert.equal(capturedUrl, 'https://gold-ai-trader-1.onrender.com/api/gold/backtest-summary');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['x-gold-api-key'], 'test-api-key-value');
  const sent = JSON.parse(capturedOptions.body);
  assert.equal(sent.source, 'NODE_HISTORICAL_ENGINE');
  assert.equal('trades' in sent.summary.scenarios.baseline, false);
  assert.equal(result.persisted, true);
});

test('refuses non-HTTPS destinations and missing credentials', async () => {
  await assert.rejects(() => uploadGoldBacktestSummary(sampleReport(), {
    baseUrl: 'http://example.com', apiKey: 'secret', fetchImpl: async () => {}
  }), /HTTPS/);
  await assert.rejects(() => uploadGoldBacktestSummary(sampleReport(), {
    baseUrl: 'https://example.com', apiKey: '', fetchImpl: async () => {}
  }), /required/);
});

test('server persistence whitelist drops unexpected raw bars and trade rows', () => {
  const payload = buildGoldBacktestSummary(sampleReport());
  const tainted = {
    ...payload,
    raw_m5: [{ time: 1, open: 2, high: 3, low: 1, close: 2, volume: 10 }],
    trades: [{ entry: 2, exit: 3, net_pnl: 1 }],
    summary: {
      ...payload.summary,
      raw_bars: [{ open: 1, high: 2, low: 1, close: 2 }],
      scenarios: {
        ...payload.summary.scenarios,
        baseline: {
          ...payload.summary.scenarios.baseline,
          trades: [{ entry: 2, exit: 3, net_pnl: 1 }]
        }
      }
    }
  };
  const accepted = validateGoldBacktestSummaryPayload(tainted);
  assert.equal(accepted.ok, true);
  const persistedJson = JSON.stringify(accepted.row);
  assert.equal(persistedJson.includes('"raw_m5"'), false);
  assert.equal(persistedJson.includes('"raw_bars"'), false);
  assert.equal(persistedJson.includes('"net_pnl"'), false);
  assert.equal(persistedJson.includes('"entry"'), false);
});
