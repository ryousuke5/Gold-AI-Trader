import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const telemetry = fs.readFileSync(new URL('../src/gold_forward_research_telemetry.js', import.meta.url), 'utf8');
const db = fs.readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
const v19 = fs.readFileSync(new URL('../mt4/GoldAITraderV19.mq4', import.meta.url), 'utf8');

test('research telemetry is explicitly opt-in and disabled by default', () => {
  assert.match(server, /GOLD_FORWARD_RESEARCH_TELEMETRY_ENABLED\|\|'false'/);
  assert.match(server, /if\(!goldForwardResearchTelemetryEnabled\|\|strategyVersion!=='gold-m5-h1-v2'\)return/);
});

test('telemetry runs after persisted signal and risk records and cannot block the main flow', () => {
  assert.match(server, /risk_not_persisted[\s\S]*?recordGoldForwardResearchTelemetry\(/);
  assert.match(server, /Research telemetry must never change or block the deterministic signal\/risk\/order flow/);
  assert.match(server, /catch\(error\)[\s\S]*?GOLD FORWARD RESEARCH TELEMETRY ERROR/);
});

test('research observations never request or execute orders', () => {
  assert.match(telemetry, /orders_executed: false/);
  assert.doesNotMatch(telemetry, /OrderSend\s*\(/);
  assert.doesNotMatch(v19, /OrderSend\s*\(/);
});

test('database persistence is isolated in its own research table', () => {
  assert.match(db, /from\('gold_forward_research_observations'\)/);
  assert.match(db, /onConflict: 'observation_key'/);
});
