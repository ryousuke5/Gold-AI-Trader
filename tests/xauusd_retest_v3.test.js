import test from 'node:test';
import assert from 'node:assert/strict';
import { findXauRetestSetupV3 } from '../src/xauusd_retest_v3.js';

function bar(time, open, high, low, close, volume=100){
  return {time,open,high,low,close,volume};
}

function features(bars){
  const h1=[];
  const t=bars[0].time;
  for(let i=0;i<5;i++) h1.push(bar(t+i*3600,100+i,101+i,99+i,100+i));
  const latest=bars.at(-1);
  return {
    barTime:latest.time,
    bid:102.95,
    ask:103.50,
    spread:0.55,
    m5:{ema20:102.4,ema50:101.6,rsi14:62,atr14:1},
    h1:{close:105,ema20:103,ema50:101,ema200:99,rsi14:61,atr14:2.5},
    recentM5:bars,
    recentH1:h1
  };
}

test('V3 accepts range -> breakout -> retest -> delayed reclaim confirmation',()=>{
  const t0=1700200000;
  const bars=[];
  for(let i=0;i<18;i++) bars.push(bar(t0+i*300,100,101.5,98.5,100));
  bars.push(bar(t0+18*300,101,103.0,100.7,102.7));
  bars.push(bar(t0+19*300,102.7,102.9,101.6,101.8));
  bars.push(bar(t0+20*300,101.8,102.5,101.9,102.1));
  bars.push(bar(t0+21*300,102.1,103.1,102.0,102.95));

  const setup=findXauRetestSetupV3(features(bars),{
    breakoutLookback:12,
    minRangeAtr:0.55,maxRangeAtr:3.5,
    breakoutAtr:0.05,breakoutBodyAtr:0.25,breakoutCloseLocation:0.58,
    maxBreakoutBodyAtr:1.8,maxRetestBars:6,minRetestBars:1,maxConfirmBars:3,
    retestToleranceAtr:0.25,maxPenetrationAtr:0.25,retestCloseBufferAtr:0.08,
    confirmBufferAtr:0.02,confirmBodyAtr:0.20,minConfirmCloseLocation:0.55,maxConfirmBodyAtr:1.5,
    minStopAtr:0.60,maxStopAtr:2.20,stopBufferAtr:0.12,takeProfitR:1.8,
    maxEntryDistanceAtr:0.25,maxExtensionAtr:1.8,minH1Agreement:0.60,
    h1BuyRsiMin:45,h1BuyRsiMax:75,h1SellRsiMin:25,h1SellRsiMax:55,
    maxSpreadPrice:0.60
  });
  assert.equal(setup.candidate,'BUY');
  assert.equal(setup.setup_type,'H1_RANGE_BREAK_RETEST_RECLAIM_V3');
  assert.equal(setup.diagnostics.breakout_time,bars[18].time);
  assert.equal(setup.diagnostics.retest_time,bars[19].time);
  assert.equal(setup.diagnostics.confirmation_time,bars[21].time);
  assert.equal(setup.diagnostics.confirmation_lag_bars,2);
});

test('V3 does not reject a normal spread as pure entry drift',()=>{
  const t0=1700300000;
  const bars=[];
  for(let i=0;i<18;i++) bars.push(bar(t0+i*300,100,101.5,98.5,100));
  bars.push(bar(t0+18*300,101,103.0,100.7,102.7));
  bars.push(bar(t0+19*300,102.7,102.9,101.6,101.8));
  bars.push(bar(t0+20*300,101.8,102.5,101.9,102.1));
  bars.push(bar(t0+21*300,102.1,103.1,102.0,102.95));
  const setup=findXauRetestSetupV3(features(bars));
  assert.equal(setup.candidate,'BUY');
  assert.notEqual(setup.reasons?.[0],'entry_drift_filter');
});
