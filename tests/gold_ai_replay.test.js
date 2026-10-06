import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeHistoricalEnvironment } from '../src/gold_ai_replay.js';

test('historical replay rejects future-dated evidence before API call', async () => {
  const asof = 1760000000;
  const snapshot = { asof_time: asof, candidate: 'BUY' };
  const context = { asof_time: asof, sources: [{ id: 'future', published_at: asof + 1 }] };
  await assert.rejects(
    analyzeHistoricalEnvironment({ snapshot, context }),
    /future_information_detected:future/
  );
});

test('historical replay rejects invalid as-of time', async () => {
  await assert.rejects(
    analyzeHistoricalEnvironment({ snapshot: { asof_time: 0 }, context: { sources: [] } }),
    /invalid_snapshot_asof_time/
  );
});
