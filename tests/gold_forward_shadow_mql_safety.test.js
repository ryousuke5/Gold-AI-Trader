import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ea = readFileSync(resolve(here, '../mt4/GoldAITraderV19.mq4'), 'utf8');

test('research V19 keeps both order switches disabled by default', () => {
  assert.match(ea, /input bool\s+AllowAutoOrders\s*=\s*false\s*;/);
  assert.match(ea, /input bool\s+EnableForwardShadowTelemetry\s*=\s*false\s*;/);
  assert.match(ea, /input string\s+ForwardShadowApiBaseUrl\s*=\s*""\s*;/);
  assert.match(ea, /input string\s+ForwardShadowApiKey\s*=\s*""\s*;/);
});

test('research V19 contains no MT4 trade submission path', () => {
  assert.equal(/\bOrderSend\s*\(/.test(ea), false);
  assert.equal(/\bOrderClose\s*\(/.test(ea), false);
  assert.equal(/\bOrderModify\s*\(/.test(ea), false);
  assert.match(ea, /void OnTick\(\)\s*\{\s*UpdateForwardShadowOnTick\(\);\s*\}/);
});

test('shadow endpoint refuses the production host and requires a separate key', () => {
  assert.match(ea, /UrlHostOnly\(baseUrl\)\s*==\s*UrlHostOnly\(ApiBaseUrl\)/);
  assert.match(ea, /TrimText\(ForwardShadowApiKey\)\s*==\s*TrimText\(ApiKey\)/);
  assert.match(ea, /X-Gold-API-Key: \" \+ TrimText\(ForwardShadowApiKey\)/);
});

test('virtual entries require approved ANALYSIS-only server state and disabled order gate', () => {
  assert.match(ea, /!riskApproved\s*\|\|\s*!safetyAllowed/);
  assert.match(ea, /stateMode\s*!=\s*\"ANALYSIS\"\s*\|\|\s*remoteAutoTrading\s*\|\|\s*orderAllowed/);
  assert.match(ea, /if\(g_shadowActive\s*\|\|\s*AllowAutoOrders\s*\|\|\s*!g_marketSafetyAllowed\)/);
});

test('completed H1 EMA and ATR series are included in V19 features', () => {
  assert.match(ea, /iMA\(sym, PERIOD_H1, 20, 0, MODE_EMA, PRICE_CLOSE, shiftH1\)/);
  assert.match(ea, /iMA\(sym, PERIOD_H1, 50, 0, MODE_EMA, PRICE_CLOSE, shiftH1\)/);
  assert.match(ea, /iMA\(sym, PERIOD_H1, 200, 0, MODE_EMA, PRICE_CLOSE, shiftH1\)/);
  assert.match(ea, /iATR\(sym, PERIOD_H1, 14, shiftH1\)/);
});

test('shadow exits explicitly label quote-side R as excluding commissions and swaps', () => {
  assert.match(ea, /SPREAD_AND_CONFIGURED_SLIPPAGE_EXCLUDES_COMMISSION_SWAP/);
  assert.match(ea, /orders_executed=false/);
});


test('the 30-minute horizon ends only the research observation, not a broker position', () => {
  assert.match(ea, /#define\s+SHADOW_OBSERVATION_HORIZON_SECONDS\s+1800/);
  assert.match(ea, /tickUtc\s*-\s*g_shadowEntryTimeUtc\s*>=\s*SHADOW_OBSERVATION_HORIZON_SECONDS/);
  assert.match(ea, /SendShadowExit\(tickUtc, bid, ask, "TIME"\)/);
  assert.match(ea, /observation_horizon_complete/);
});


test('the fixed 30-minute end is a shadow-only observation cutoff', () => {
  assert.match(ea, /#define\s+SHADOW_OBSERVATION_HORIZON_SECONDS\s+1800/);
  assert.match(ea, /tickUtc\s*-\s*g_shadowEntryTimeUtc\s*>=\s*SHADOW_OBSERVATION_HORIZON_SECONDS/);
  assert.match(ea, /SendShadowExit\(tickUtc, bid, ask, "TIME"\)/);
  assert.match(ea, /observation_horizon_complete/);
  assert.equal(/OrderSend\s*\(/.test(ea), false);
});
