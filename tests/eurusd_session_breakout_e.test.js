import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEurUsdSessionRangeBreakoutSetupE } from '../src/eurusd_session_breakout_e.js';

function bar(time,open,high,low,close,atr14=0.001){
  return {time,open,high,low,close,atr14,ema20:1.10,ema50:1.09,ema200:1.08,rsi14:58};
}

function featureAt(hour,close,spread=0.00008){
  const base=Date.parse('2026-01-05T00:00:00Z')/1000;
  const bars=[];
  for(let i=0;i<28;i++){
    const t=base+i*900;
    bars.push(bar(t,1.1000+i*0.00002,1.1001+i*0.00002,1.0999+i*0.00002,1.1000+i*0.00002));
  }
  const lastTime=base+hour*3600;
  const latest=bar(lastTime,close-0.0003,close+0.0005,close-0.0005,close,0.001);
  return {
    barTime:lastTime,bid:close-spread/2,ask:close+spread/2,spread,point:0.00001,
    m15:{ema20:1.1000,ema50:1.0990,rsi14:58,atr14:0.001},
    h1:{close:1.1100,ema20:1.1050,ema50:1.1000,ema200:1.0950,atr14:0.002},
    recentM15:[...bars,latest],
    recentH1:[1,2,3,4,5,6].map((_,i)=>({time:base-3600*(5-i),close:1+i*0.001}))
  };
}

test('E returns WAIT outside London entry window',()=>{
  const f=featureAt(6.5,1.1010);
  const s=buildEurUsdSessionRangeBreakoutSetupE(f,{sessionTimeZone:'Europe/London',entryStartHour:7,entryEndHour:15});
  assert.equal(s.candidate,'WAIT');
  assert.ok(s.reasons.includes('outside_entry_window'));
});

test('E rejects excessive spread',()=>{
  const f=featureAt(8,1.1015,0.00020);
  const s=buildEurUsdSessionRangeBreakoutSetupE(f,{sessionTimeZone:'Europe/London',maxSpreadPips:1.2});
  assert.equal(s.candidate,'WAIT');
  assert.ok(s.reasons.includes('spread_filter_failed'));
});

test('E produces BUY only when H1 trend and range breakout align',()=>{
  const f=featureAt(8,1.1012);
  f.recentM15=f.recentM15.map((b,i)=>i<28?{...b,high:1.1004,low:1.0996,open:1.1000,close:1.1000}:b);
  const s=buildEurUsdSessionRangeBreakoutSetupE(f,{sessionTimeZone:'Europe/London',minRangeAtr:0.5,maxRangeAtr:2.0,minH1Agreement:0.67});
  assert.equal(s.candidate,'BUY');
  assert.equal(s.setup_type,'LONDON_SESSION_RANGE_BREAKOUT_E');
});

test('E can produce SELL when H1 trend and downside breakout align',()=>{
  const f=featureAt(8,1.0988);
  f.h1={close:1.0900,ema20:1.0950,ema50:1.1000,ema200:1.1050,atr14:0.002};
  f.m15={ema20:1.1000,ema50:1.1010,rsi14:42,atr14:0.001};
  f.recentM15=f.recentM15.map((b,i)=>i<28?{...b,high:1.1004,low:1.0996,open:1.1000,close:1.1000}:b);
  const s=buildEurUsdSessionRangeBreakoutSetupE(f,{sessionTimeZone:'Europe/London',minRangeAtr:0.5,maxRangeAtr:2.0,minH1Agreement:0.67});
  assert.equal(s.candidate,'SELL');
  assert.equal(s.setup_type,'LONDON_SESSION_RANGE_BREAKOUT_E');
});
