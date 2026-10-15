import test from 'node:test';
import assert from 'node:assert/strict';
import { findXauRetestSetupV3, hasValidStopGeometry, hasValidExecutableStopGeometry, calculateXauRetestStopPrice, isXauEntryDistanceWithinLimit } from '../src/xauusd_retest_v3.js';

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

function featuresDown(bars){
  const h1=[];
  const t=bars[0].time;
  for(let i=0;i<5;i++) h1.push(bar(t+i*3600,105-i,106-i,104-i,105-i));
  const latest=bars.at(-1);
  return {
    barTime:latest.time,
    bid:latest.close,
    ask:latest.close+0.55,
    spread:0.55,
    m5:{ema20:98.5,ema50:99.0,rsi14:40,atr14:1},
    h1:{close:100,ema20:101,ema50:103,ema200:105,rsi14:40,atr14:2.5},
    recentM5:bars,
    recentH1:h1
  };
}

test('V3 accepts range -> breakout -> retest -> delayed reclaim confirmation',()=>{
  const t0=1700200000;
  const bars=[];
  for(let i=0;i<24;i++) bars.push(bar(t0+i*300,100,101.5,98.5,100));
  bars.push(bar(t0+24*300,101,103.0,100.7,102.7));
  bars.push(bar(t0+25*300,102.7,102.9,101.6,101.8));
  bars.push(bar(t0+26*300,101.8,102.5,101.6,102.1));
  bars.push(bar(t0+27*300,102.1,103.1,102.0,102.95));

  const debug={targetRetestIndex:25};
  const setup=findXauRetestSetupV3(features(bars),{debug,
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
  console.log('V3 DEBUG',JSON.stringify(debug));
  assert.equal(setup.candidate,'BUY');
  assert.equal(setup.setup_type,'H1_RANGE_BREAK_RETEST_RECLAIM_V3');
  assert.equal(setup.diagnostics.breakout_time,bars[24].time);
  assert.equal(setup.diagnostics.retest_time,bars[25].time);
  assert.equal(setup.diagnostics.confirmation_time,bars[27].time);
  assert.equal(setup.diagnostics.confirmation_lag_bars,2);
});

test('V3 does not reject a normal spread as pure entry drift',()=>{
  const t0=1700300000;
  const bars=[];
  for(let i=0;i<24;i++) bars.push(bar(t0+i*300,100,101.5,98.5,100));
  bars.push(bar(t0+24*300,101,103.0,100.7,102.7));
  bars.push(bar(t0+25*300,102.7,102.9,101.6,101.8));
  bars.push(bar(t0+26*300,101.8,102.5,101.6,102.1));
  bars.push(bar(t0+27*300,102.1,103.1,102.0,102.95));
  const setup=findXauRetestSetupV3(features(bars));
  assert.equal(setup.candidate,'BUY');
  assert.notEqual(setup.reasons?.[0],'entry_drift_filter');
});

test('stop geometry matches executable BUY/SELL side',()=>{
  assert.equal(hasValidStopGeometry('BUY',100,99.5),true);
  assert.equal(hasValidStopGeometry('BUY',100,100),false);
  assert.equal(hasValidStopGeometry('BUY',100,100.5),false);
  assert.equal(hasValidStopGeometry('SELL',100,100.5),true);
  assert.equal(hasValidStopGeometry('SELL',100,100),false);
  assert.equal(hasValidStopGeometry('SELL',100,99.5),false);
  assert.equal(hasValidStopGeometry('BUY',NaN,99),false);
  assert.equal(hasValidStopGeometry('WAIT',100,99),false);
});


test('entry distance guard uses first executable market price, not signal close itself',()=>{
  assert.equal(isXauEntryDistanceWithinLimit(100,100.20,1,0.25),true);
  assert.equal(isXauEntryDistanceWithinLimit(100,100.251,1,0.25),false);
  assert.equal(isXauEntryDistanceWithinLimit(100,99.75,1,0.25),true);
  assert.equal(isXauEntryDistanceWithinLimit(100,99.749,1,0.25),false);
  assert.equal(isXauEntryDistanceWithinLimit(100,140,1,0),true);
  assert.equal(isXauEntryDistanceWithinLimit(100,101,0,0.25),false);
  assert.equal(isXauEntryDistanceWithinLimit(NaN,101,1,0.25),false);
});


test('SELL stop includes signal spread because its stop trigger uses Ask',()=>{
  assert.ok(Math.abs(calculateXauRetestStopPrice('SELL',101,99,2,0.55,0.12)-101.79)<1e-9);
  assert.ok(Math.abs(calculateXauRetestStopPrice('BUY',101,99,2,0.55,0.12)-98.76)<1e-9);
  assert.equal(calculateXauRetestStopPrice('SELL',101,99,0,0.55,0.12),null);
  assert.equal(calculateXauRetestStopPrice('WAIT',101,99,2,0.55,0.12),null);
});

test('stop geometry is checked against the executable close-side quote',()=>{
  assert.equal(hasValidExecutableStopGeometry('BUY',100,100.55,99.8),true);
  assert.equal(hasValidExecutableStopGeometry('BUY',100,100.55,100.2),false);
  assert.equal(hasValidExecutableStopGeometry('SELL',100,100.55,100.8),true);
  assert.equal(hasValidExecutableStopGeometry('SELL',100,100.55,100.5),false);
  assert.equal(hasValidExecutableStopGeometry('SELL',100,99.9,101),false);
});

test('V3 SELL retest stop remains above retest Bid high by buffer after accounting for spread',()=>{
  const t0=1700400000;
  const bars=[];
  for(let i=0;i<24;i++) bars.push(bar(t0+i*300,100,101.5,98.5,100));
  bars.push(bar(t0+24*300,99.3,99.5,98.0,98.2));
  bars.push(bar(t0+25*300,98.2,98.7,97.9,98.4));
  bars.push(bar(t0+26*300,98.4,98.5,97.9,98.2));
  bars.push(bar(t0+27*300,98.2,98.35,97.1,97.4));
  const setup=findXauRetestSetupV3(featuresDown(bars),{
    breakoutLookback:12,minRangeAtr:0.55,maxRangeAtr:3.5,
    breakoutAtr:0.05,breakoutBodyAtr:0.25,breakoutCloseLocation:0.58,
    maxBreakoutBodyAtr:1.8,maxRetestBars:6,minRetestBars:1,maxConfirmBars:3,
    retestToleranceAtr:0.25,maxPenetrationAtr:0.25,retestCloseBufferAtr:0.08,
    confirmBufferAtr:0.02,confirmBodyAtr:0.20,minConfirmCloseLocation:0.55,maxConfirmBodyAtr:1.5,
    minStopAtr:0.60,maxStopAtr:2.20,stopBufferAtr:0.12,takeProfitR:1.8,
    maxEntryDistanceAtr:0.25,maxExtensionAtr:1.8,minH1Agreement:0.60,
    h1BuyRsiMin:45,h1BuyRsiMax:75,h1SellRsiMin:25,h1SellRsiMax:55,
    maxSpreadPrice:0.60
  });
  assert.equal(setup.candidate,'SELL');
  assert.equal(setup.stop_loss,bars[25].high+0.55+0.12);
});
