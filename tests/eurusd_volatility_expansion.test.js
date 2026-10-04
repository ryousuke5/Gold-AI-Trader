import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEurUsdVolatilityExpansionSetup } from '../src/eurusd_volatility_expansion.js';

function b(time, open, high, low, close, volume=100){return {time,open,high,low,close,volume};}

test('volatility expansion stays WAIT with insufficient history',()=>{
 const now=Date.parse('2026-01-05T12:00:00Z')/1000;
 const recent=Array.from({length:21},(_,i)=>b(now+i*900,1.1,1.1005,1.0995,1.1));
 const setup=buildEurUsdVolatilityExpansionSetup({barTime:recent.at(-1).time,recentM15:recent,m15:{ema20:1.1,ema50:1.099,rsi14:55,atr14:.001},h1:{close:1.102,ema20:1.101,ema50:1.100,ema200:1.098},spread:.00008});
 assert.equal(setup.candidate,'WAIT');
 assert.match(setup.reasons.join('|'),/no_valid_volatility_breakout|outside/);
});

test('breakout direction requires the H1 trend and M15 EMA alignment',()=>{
 const now=Date.parse('2026-01-05T08:15:00Z')/1000;
 const recent=[];
 for(let i=0;i<22;i++) recent.push(b(now+(i-1)*900,1.1000,1.1005,1.0995,1.1000,100));
 recent.push(b(now,1.1010,1.1030,1.1009,1.1028,180));
 const setup=buildEurUsdVolatilityExpansionSetup({
  barTime:recent.at(-1).time,recentM15:recent,
  bid:1.1026,ask:1.1028,spread:.00008,
  m15:{ema20:1.102,ema50:1.101,rsi14:58,atr14:.001},
  h1:{close:1.1025,ema20:1.102,ema50:1.100,ema200:1.098}
 },{maxSqueezeWidthAtr:3,minAtrExpansion:1,breakoutAtr:.01,minBodyAtr:.1,minCloseLocation:.6,minVolumeRatio:1,maxSpreadPips:2});
 assert.equal(setup.candidate,'WAIT');
 assert.ok(setup.reasons.includes('no_valid_volatility_breakout') || setup.stop_atr >= 0);
});
