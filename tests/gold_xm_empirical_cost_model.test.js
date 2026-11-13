import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getServerLocalHour,
  resolveEmpiricalSpread,
  validateEmpiricalSpreadProfile
} from '../src/gold_xm_empirical_cost_model.js';

const profile = {
  schema_version: 1,
  profile_id: 'fixture',
  server_timezone: 'Europe/Nicosia',
  profiles: {
    'XMTrading-Demo 6': {
      unique_observations: 5000,
      global: { p50: 0.27, p75: 0.28, p90: 0.30, p95: 0.32, p99: 0.40, max: 1.2 },
      hours: {
        '2': { observations: 1200, p50: 0.28, p75: 0.29, p90: 0.31, p95: 0.33, p99: 0.41, max: 0.95 },
        '3': { observations: 900, p50: 0.29, p75: 0.30, p90: 0.32, p95: 0.34, p99: 0.42, max: 1.1 }
      }
    }
  }
};

test('maps UTC epoch to Europe/Nicosia server hour with winter and summer DST', () => {
  assert.equal(getServerLocalHour(Date.parse('2026-11-13T00:30:00Z') / 1000), 2);
  assert.equal(getServerLocalHour(Date.parse('2026-07-13T00:30:00Z') / 1000), 3);
});

test('selects the requested hourly empirical spread quantile', () => {
  const result = resolveEmpiricalSpread({
    profile,
    accountServer: 'XMTrading-Demo 6',
    timestampSeconds: Date.parse('2026-11-13T00:30:00Z') / 1000,
    quantile: 'p90'
  });
  assert.equal(result.spreadPrice, 0.31);
  assert.equal(result.serverHour, 2);
  assert.equal(result.observations, 1200);
  assert.equal(result.source, 'hourly');
  assert.equal(result.accountServer, 'XMTrading-Demo 6');
});

test('falls back to global quantile if the local hour is missing or too thin', () => {
  const missingHour = resolveEmpiricalSpread({
    profile,
    accountServer: 'XMTrading-Demo 6',
    timestampSeconds: Date.parse('2026-11-13T22:30:00Z') / 1000,
    quantile: 'p95'
  });
  assert.equal(missingHour.spreadPrice, 0.32);
  assert.equal(missingHour.source, 'global_fallback');

  const thinHour = resolveEmpiricalSpread({
    profile,
    accountServer: 'XMTrading-Demo 6',
    timestampSeconds: Date.parse('2026-11-13T01:30:00Z') / 1000,
    quantile: 'p90',
    minObservations: 1000
  });
  assert.equal(thinHour.spreadPrice, 0.30);
  assert.equal(thinHour.source, 'global_fallback');
});

test('fails closed for unknown account server and invalid quantile', () => {
  assert.throws(() => resolveEmpiricalSpread({
    profile, accountServer: 'XMTrading-Real 11',
    timestampSeconds: Date.parse('2026-11-13T00:30:00Z') / 1000
  }), /No empirical spread profile/);
  assert.throws(() => resolveEmpiricalSpread({
    profile, accountServer: 'XMTrading-Demo 6',
    timestampSeconds: Date.parse('2026-11-13T00:30:00Z') / 1000,
    quantile: 'p80'
  }), /Unsupported spread quantile/);
});

test('validates versioned spread profile structure', () => {
  assert.equal(validateEmpiricalSpreadProfile(profile), true);
  assert.throws(() => validateEmpiricalSpreadProfile({ ...profile, schema_version: 2 }), /Unsupported/);
});

test('committed XM spread profile passes structural validation and preserves both account servers', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const actual = JSON.parse(await readFile(resolve(root, 'data/gold_xm_empirical_spread_profile_20261113.json'), 'utf8'));
  assert.equal(validateEmpiricalSpreadProfile(actual), true);
  assert.ok(actual.profiles['XMTrading-Demo 6']);
  assert.ok(actual.profiles['XMTrading-Real 11']);
  assert.equal(actual.source.raw_rows, 4221339);
  assert.equal(actual.source.duplicate_rows_removed, 254926);
  const demo = resolveEmpiricalSpread({
    profile: actual,
    accountServer: 'XMTrading-Demo 6',
    timestampSeconds: Date.parse('2026-11-13T00:30:00Z') / 1000,
    quantile: 'p90'
  });
  assert.equal(demo.serverHour, 2);
  assert.equal(demo.spreadPrice, 0.29);
});
