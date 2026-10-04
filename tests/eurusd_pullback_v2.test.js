import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEurUsdFeatures } from '../src/eurusd_features.js';
import { buildEurUsdTrendPullbackSetupV2, eurUsdH1TrendPullbackV2Trend } from '../src/eurusd_pullback_v2.js';

function bars() {
  const t = 1727000000;
  return [
    { time:t,open:1.10080,high:1.10130,low:1.10060,close:1.10120,volume:100 },
    { time:t+900,open:1.10120,high:1.10180,low:1.10100,close:1.10170,volume:110 },
    { time:t+1800,open:1.10170,high:1.10240,low:1.10150,close:1.10230,volume:120 },
    { time:t+2700,open:1.10230,high:1.10280,low:1.10210,close:1.10270,volume:130 },
    { time:t+3600,open:1.10270,high:1.10275,low:1.10210,close:1.10220,volume:140 },
    { time:t+4500,open:1.10220,high:1.10230,low:1.10160,close:1.10180,volume:150 },
    { time:t+5400,open:1.10180,high:1.10190,low:1.10135,close:1.10145,volume:160 },
    { time:t+6300,open:1.10145,high:1.10155,low:1.10130,close:1.10135,volume:170 },
    { time:t+7200,open:1.10135,high:1.10260,low:1.10125,close:1.10245,volume:220 }
  ];
}

function h1Bars() {
  const t = 1727000000;
  const closes=[1.0998,1.1001,1.1004,1.1007,1.1010,1.1013];
  return closes.map((close,i)=>({
    time:t+i*3600, open:close-0.00005, high:close+0.00012, low:close-0.00012, close, volume:100+i
  }));
}

function features() {
  return normalizeEurUsdFeatures({
    bid:1.10237, ask:1.10245, point:0.00001, spread:0.00008, bar_time:1727007200,
    m15:{ema20:1.10145,ema50:1.10080,rsi14:60,atr14:0.00100},
    h1:{close:1.10130,ema20:1.10110,ema50:1.10070,ema200:1.09970,rsi14:57,atr14:0.00250},
    recent_m15:bars(), recent_h1:h1Bars()
  });
}

test('Strategy B v2 accepts a clean trend-pullback continuation',()=>{
  const f=features();
  assert.equal(eurUsdH1TrendPullbackV2Trend(f),'UP');
  const setup=buildEurUsdTrendPullbackSetupV2(f,{maxSpreadToTpPct:20});
  assert.equal(setup.candidate,'BUY',JSON.stringify(setup,null,2));
  assert.equal(setup.setup_type,'TREND_PULLBACK_V2');
  assert.equal(setup.quality_score,100);
  assert.ok(setup.stop_atr>=0.60 && setup.stop_atr<=1.40);
  assert.ok(setup.risk_reward>=1.79 && setup.risk_reward<=1.81);
});

test('Strategy B v2 rejects an interrupted M15 sequence',()=>{
  const f=features();
  f.recentM15[7].time += 300;
  const setup=buildEurUsdTrendPullbackSetupV2(f);
  assert.equal(setup.candidate,'WAIT');
  assert.match(setup.reasons.join(','),/recent_m15_setup_bars_not_contiguous/);
});

test('Strategy B v2 rejects an overextended H1 trend',()=>{
  const f=features();
  f.h1.close=1.1065;
  const setup=buildEurUsdTrendPullbackSetupV2(f);
  assert.equal(setup.candidate,'WAIT');
  assert.match(setup.reasons.join(','),/h1_overextended|h1_trend_not_clear/);
});
