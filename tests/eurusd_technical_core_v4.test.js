import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEurUsdFeatures } from '../src/eurusd_features.js';
import { eurUsdH1TrendTechnicalCoreV4Trend, buildEurUsdTechnicalCoreV4 } from '../src/eurusd_technical_core_v4.js';

function fixture() {
  const t = 1727000000;
  const m15 = [
    {time:t,open:1.1000,high:1.1005,low:1.0998,close:1.1004},
    {time:t+900,open:1.1004,high:1.1009,low:1.1002,close:1.1008},
    {time:t+1800,open:1.1008,high:1.1016,low:1.1006,close:1.1015},
    {time:t+2700,open:1.1015,high:1.1020,low:1.1012,close:1.1019},
    {time:t+3600,open:1.1019,high:1.1020,low:1.1014,close:1.1016},
    {time:t+4500,open:1.1016,high:1.1017,low:1.1010,close:1.1012},
    {time:t+5400,open:1.1012,high:1.10135,low:1.1009,close:1.1010},
    {time:t+6300,open:1.1010,high:1.1011,low:1.1008,close:1.1009},
    {time:t+7200,open:1.1009,high:1.1020,low:1.10085,close:1.1019},
  ];
  const h1 = Array.from({length:6},(_,i)=>({
    time:t+i*3600,
    open:1.0997+i*0.0004,
    high:1.1001+i*0.0004,
    low:1.0995+i*0.0004,
    close:1.0998+i*0.0004
  }));
  return normalizeEurUsdFeatures({
    bid:1.10185,ask:1.10193,point:1e-5,spread:0.00008,bar_time:t+7200,
    m15:{ema20:1.1013,ema50:1.1009,rsi14:55,atr14:0.001},
    h1:{close:1.1018,ema20:1.1014,ema50:1.1010,ema200:1.0998,rsi14:56,atr14:0.0025},
    recent_m15:m15,recent_h1:h1
  });
}

test('Core V4 accepts a broad trend-pullback continuation candidate', () => {
  const f = fixture();
  assert.equal(buildEurUsdH1TrendTechnicalCoreV4Trend(f), 'UP');
  const setup = buildEurUsdTechnicalCoreV4(f, { lookback: 8 });
  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup, null, 2));
  assert.equal(setup.setup_type, 'EURUSD_H1_TREND_M15_PULLBACK_CORE_V4');
  assert.ok(setup.stop_atr >= 0.40 && setup.stop_atr <= 1.80);
  assert.equal(setup.risk_reward, 1.5);
});

test('Core V4 does not require RSI as a hard entry condition', () => {
  const f = fixture();
  f.m15.rsi14 = 46;
  const setup = buildEurUsdTechnicalCoreV4(f, { lookback: 8 });
  assert.equal(setup.candidate, 'BUY', JSON.stringify(setup, null, 2));
});

test('Core V4 rejects a broken recent M15 sequence', () => {
  const f = fixture();
  f.recentM15[5].time += 300;
  const setup = buildEurUsdTechnicalCoreV4(f);
  assert.equal(setup.candidate, 'WAIT');
  assert.match(setup.reasons.join(','), /recent_m15_setup_bars_not_contiguous/);
});
