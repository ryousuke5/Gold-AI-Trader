import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workflow = await fs.readFile(
  new URL('../.github/workflows/eurusd-spread-sensitivity.yml', import.meta.url),
  'utf8'
);
const aggregator = await fs.readFile(
  new URL('../scripts/aggregate-eurusd-spread-sensitivity.mjs', import.meta.url),
  'utf8'
);

function readScenarioMatrix(source) {
  const pattern = /^[ \t]*- name: (cost|atr|gate)-([^\r\n]+)\r?\n[ \t]+type: ([^\r\n]+)\r?\n[ \t]+spread: '([^']+)'\r?\n[ \t]+gate: '([^']+)'\r?\n[ \t]+atr_gate: '([^']+)'/gm;
  return [...source.matchAll(pattern)].map((m) => ({
    name: m[1] + '-' + m[2].trim(),
    group: m[1],
    type: m[3].trim(),
    spread: Number(m[4]),
    gate: Number(m[5]),
    atrGate: Number(m[6])
  }));
}

test('EURUSD spread matrix brackets the observed live spread distribution', () => {
  const scenarios = readScenarioMatrix(workflow);
  assert.equal(scenarios.length, 16);
  const byName = new Map(scenarios.map((scenario) => [scenario.name, scenario]));

  for (const [name, spread] of [
    ['cost-1.9', 1.9],
    ['cost-2.0', 2.0],
    ['cost-2.1', 2.1]
  ]) {
    const scenario = byName.get(name);
    assert.ok(scenario, 'missing execution-cost scenario ' + name);
    assert.equal(scenario.type, 'execution-cost');
    assert.equal(scenario.spread, spread);
    assert.equal(scenario.gate, 2.5);
    assert.equal(scenario.atrGate, 15);
  }

  for (const gate of [1.2, 1.5, 1.8, 2.0, 2.1, 2.2]) {
    const name = 'gate-' + gate.toFixed(1);
    const scenario = byName.get(name);
    assert.ok(scenario, 'missing spread gate scenario ' + name);
    assert.equal(scenario.type, 'spread-gate');
    assert.equal(scenario.spread, 2.0, 'hold assumed spread fixed to isolate the gate');
    assert.equal(scenario.gate, gate);
    assert.equal(scenario.atrGate, 15);
  }
});

test('EURUSD sensitivity report discloses unavailable historical spread data', () => {
  assert.match(aggregator, /historical broker spread by timestamp/);
  assert.match(aggregator, /sensitivity analysis, not a reconstruction of historical XM execution/);
  assert.match(workflow, /no historical broker Ask\/spread data/);
});
