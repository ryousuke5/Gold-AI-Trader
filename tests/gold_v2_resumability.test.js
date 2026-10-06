import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github/workflows/gold-v2-research.yml'),
  'utf8'
);

test('GOLD V2 raw checkpoint cache advances across repeated interruptions', () => {
  const rawKey = 'key: xauusd-m1-${{ needs.plan.outputs.cache_version }}-${{ runner.os }}-${{ matrix.chunk.id }}-${{ github.run_id }}';
  const rawRestore = 'xauusd-m1-${{ needs.plan.outputs.cache_version }}-${{ runner.os }}-${{ matrix.chunk.id }}-';
  const stableM5Key = 'key: xauusd-m5-${{ needs.plan.outputs.cache_version }}-${{ runner.os }}-${{ matrix.chunk.id }}';

  assert.ok(WORKFLOW.includes(rawKey), 'raw cache save key must include github.run_id');
  assert.ok(WORKFLOW.includes(rawRestore), 'restore prefix must be scoped to the same chunk');
  assert.match(WORKFLOW, /- name: Save raw M1 checkpoint[\s\S]*?if: always\(\)/);
  assert.ok(WORKFLOW.includes(stableM5Key), 'completed M5 cache key must remain stable per chunk');
});
