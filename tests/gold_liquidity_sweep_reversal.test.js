import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldLiquiditySweepReversalSetup } from '../src/gold_liquidity_sweep_reversal_research.js';
function fixture(signal, rsi=35, overrides={}) {
  const recentM5=Array.from({length:12},(_,i)=>({time:1728000000+i*300,open:1995,high:i===0?2000:1998,low:i===0?1990:1992,close:1995,volume:100,atr14:1}));
  recentM5.push({time:recentM5.at(-1).time+300,volume:100,...signal});
  return {features:{m5:{rsi14:rsi,atr14:1},recentM5},
    config:{rangeLookback:12,minSweepAtr:0.10,closeBackAtr:0.05,buyRsiMax:40,sellRsiMin:60,
      minCloseLocation:0.60,maxCloseLocation:0.40,minStopAtr:0.50,maxStopAtr:2.50,takeProfitR:1.50,
      sessionStartUtc:0,sessionEndUtc:23,...overrides}};
}
test('confirms BUY after a prior-range low sweep and close back inside',()=>{
  const {features,config}=fixture({open:1989.8,high:1991.5,low:1989.5,close:1991.0});
  const r=buildGoldLiquiditySweepReversalSetup(features,config);
  assert.equal(r.candidate,'BUY'); assert.equal(r.setup_type,'M5_LIQUIDITY_SWEEP_CLOSE_BACK_REVERSAL');
  assert.ok(r.stop_loss<1989.5); assert.ok(r.take_profit>1991.0);
});
test('confirms SELL after a prior-range high sweep and close back inside',()=>{
  const {features,config}=fixture({open:2000.2,high:2000.5,low:1998.5,close:1999.0},65);
  const r=buildGoldLiquiditySweepReversalSetup(features,config);
  assert.equal(r.candidate,'SELL'); assert.ok(r.stop_loss>2000.5); assert.ok(r.take_profit<1999.0);
});
test('rejects low sweep if price fails to close back inside prior range',()=>{
  const {features,config}=fixture({open:1989.5,high:1990.2,low:1989.2,close:1989.9});
  assert.equal(buildGoldLiquiditySweepReversalSetup(features,config).candidate,'WAIT');
});
test('applies RSI confirmation threshold fixed before testing',()=>{
  const {features,config}=fixture({open:1989.8,high:1991.5,low:1989.5,close:1991.0},45);
  assert.equal(buildGoldLiquiditySweepReversalSetup(features,config).candidate,'WAIT');
});
test('does not treat signal candle as part of its own prior range',()=>{
  const {features,config}=fixture({open:1994,high:1997,low:1993,close:1996});
  assert.equal(buildGoldLiquiditySweepReversalSetup(features,config).candidate,'WAIT');
});
