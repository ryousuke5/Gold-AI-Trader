import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../mt4/GoldAITraderV19.mq4', import.meta.url), 'utf8');

test('V19 captures research bars separately from the signal safety gate', () => {
  assert.match(source, /EnableResearchDataCollection\s*=\s*true/);
  assert.match(source, /ResearchBarsToCapture\s*=\s*24/);
  assert.match(source, /bool BuildResearchSnapshotJson/);
  assert.match(source, /recent_m5/);
  assert.match(source, /recent_h1/);
  assert.match(source, /research_snapshot_saved/);
  assert.match(source, /if\(!g_marketSafetyAllowed\)/);
});

test('V19 research snapshots do not enable order submission', () => {
  assert.match(source, /input bool\s+AllowAutoOrders\s*=\s*false/);
  assert.match(source, /AllowAutoOrders/);
  assert.doesNotMatch(source, /AllowAutoOrders\s*=\s*true/);
});
