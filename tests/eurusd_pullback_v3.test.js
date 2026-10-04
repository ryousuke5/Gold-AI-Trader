import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEurUsdFeatures } from '../src/eurusd_features.js';
import { buildEurUsdTrendPullbackSetupV3, eurUsdH1TrendPullbackV3Trend } from '../src/eurusd_pullback_v3.js';

function fixture() {
  const t=1727000000;
  const recentM15=[
    {time:t,open:1.1000,high:1.1005,low:1.0998,close:1.1004,volume:100},
    {time:t+900,open:1.1004,high:1.1009,low:1.1002,close:1.1008,volume:110},
    {time:t+1800,open:1.1008,high:1.1015,low:1.1006,close:1.1014,volume:120},
    {time:t+2700,open:1.1014,high:1.1020,low:1.1012,close:1.1018,volume:130},
    {time:t+3600,open:1.1018,high:1.1020,low:1.1012,close:1.1014,volume:140},
    {time:t+4500,open:1.1014,high:1.1015,low:1.10099,close:1.1010,volume:150},
    {time:t+5400,open:1.1010,high:1.1011,low:1.10095,close:1.10096,volume:160},
    {time:t+6300,open:1.10096,high:1.10102,low:1.10094,close:1.10095,volume:170},
    {time:t+7200,open:1.10095,high:1.10130,low:1.10094,close:1.10105,volume:180},
    {time:t+8100,open:1.10200,high:1.10230,low:1.10192,close:1.10215,volume:200},
    {time:t+9000,open:1.10215,high:1.10245,low:1.10200,close:1.10225,volume:220}
  ];
  const recentH1=Array.from({length:6},(_,i)=>{
    const close=1.0998+i*0.00035;
    return {time:t+i*3600,open:close-0.00005,high:close+0.00012,low:close-0.00012,close,volume:100+i};
  });
  return normalizeEurUsdFeatures({
    bid:1.10217,ask:1.10225,point:0.00001,spread:0.00008,bar_time:t+9000,
    m15:{ema20:1.1012,ema50:1.1008,rsi14:58,atr14:0.0010},
    h1:{close:1.10155,ema20:1.1012,ema50:1.1008,ema200:1.0997,rsi14:55,atr14:0.0025},
    recent_m15:recentM15,recent_h1:recentH1
  });
}
test('V3 identifies trend and accepts a confirmed retest continuation',()=>{
  const f=fixture();
  assert.equal(eurUsdH1TrendPullbackV3Trend(f),'UP');
  const s=buildEurUsdTrendPullbackSetupV3(f);
  assert.equal(s.candidate,'BUY',JSON.stringify(s,null,2));
  assert.equal(s.setup_type,'TREND_PULLBACK_V3_RETEST');
  assert.ok(s.quality_score>=90);
  assert.equal(s.risk_reward,1.5);
});
test('V3 rejects a break without post-break hold',()=>{
  const f=fixture();
  f.recentM15[f.recentM15.length-1].low=1.1000;
  const s=buildEurUsdTrendPullbackSetupV3(f);
  assert.equal(s.candidate,'WAIT');
  assert.match(s.reasons.join(','),/breakout_confirmation_failed|quality_score_below_threshold/);
});
test('V3 rejects unclear H1 trend',()=>{
  const f=fixture();
  f.h1.ema20=1.1005;
  f.h1.ema50=1.1008;
  assert.equal(eurUsdH1TrendPullbackV3Trend(f),'RANGE');
  assert.equal(buildEurUsdTrendPullbackSetupV3(f).candidate,'WAIT');
});
