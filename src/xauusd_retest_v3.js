const n=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
function bars(b){return Array.isArray(b)?[...b].sort((a,c)=>Number(a.time)-Number(c.time)):[];}
function wait(trend,reason,extra={}){return{candidate:'WAIT',trend,setup_type:'NONE',entry:0,stop_loss:0,take_profit:0,risk_reward:0,reasons:[reason],...extra};}
function agreement(barsIn,dir,count=5){const a=bars(barsIn).slice(-count);if(a.length<3)return 0;let g=0;for(let i=1;i<a.length;i+=1){const d=a[i].close-a[i-1].close;if((dir==='UP'&&d>0)||(dir==='DOWN'&&d<0))g++;}return g/(a.length-1);}
function validBar(b){return Number.isFinite(b?.open)&&Number.isFinite(b?.high)&&Number.isFinite(b?.low)&&Number.isFinite(b?.close)&&b.high>=b.low&&b.high>=b.open&&b.high>=b.close&&b.low<=b.open&&b.low<=b.close;}

export function xauH1RetestTrendV3(features={},options={}){
  const h=features.h1||{},recent=bars(features.recentH1||[]);
  const minAgree=n(options.minH1Agreement,0.60);
  const buyMin=n(options.h1BuyRsiMin,45),buyMax=n(options.h1BuyRsiMax,75);
  const sellMin=n(options.h1SellRsiMin,25),sellMax=n(options.h1SellRsiMax,55);
  const up=h.close>h.ema20&&h.ema20>h.ema50&&h.ema50>h.ema200&&h.rsi14>=buyMin&&h.rsi14<=buyMax&&agreement(recent,'UP',5)>=minAgree;
  const down=h.close<h.ema20&&h.ema20<h.ema50&&h.ema50<h.ema200&&h.rsi14>=sellMin&&h.rsi14<=sellMax&&agreement(recent,'DOWN',5)>=minAgree;
  return up?'UP':down?'DOWN':'RANGE';
}

export function findXauRetestSetupV3(features={},options={}){
  const cfg={
    breakoutLookback:Math.max(6,Math.floor(n(options.breakoutLookback,12))),
    minRangeAtr:n(options.minRangeAtr,0.55),
    maxRangeAtr:n(options.maxRangeAtr,3.50),
    breakoutAtr:n(options.breakoutAtr,0.05),
    breakoutBodyAtr:n(options.breakoutBodyAtr,0.25),
    breakoutCloseLocation:n(options.breakoutCloseLocation,0.58),
    maxBreakoutBodyAtr:n(options.maxBreakoutBodyAtr,1.80),
    maxRetestBars:Math.max(2,Math.floor(n(options.maxRetestBars,6))),
    minRetestBars:Math.max(1,Math.floor(n(options.minRetestBars,1))),
    maxConfirmBars:Math.max(1,Math.floor(n(options.maxConfirmBars,3))),
    retestToleranceAtr:n(options.retestToleranceAtr,0.25),
    maxPenetrationAtr:n(options.maxPenetrationAtr,0.25),
    retestCloseBufferAtr:n(options.retestCloseBufferAtr,0.08),
    confirmBufferAtr:n(options.confirmBufferAtr,0.02),
    confirmBodyAtr:n(options.confirmBodyAtr,0.20),
    minConfirmCloseLocation:n(options.minConfirmCloseLocation,0.55),
    maxConfirmBodyAtr:n(options.maxConfirmBodyAtr,1.50),
    minStopAtr:n(options.minStopAtr,0.60),
    maxStopAtr:n(options.maxStopAtr,2.20),
    stopBufferAtr:n(options.stopBufferAtr,0.12),
    takeProfitR:n(options.takeProfitR,1.80),
    maxEntryDistanceAtr:n(options.maxEntryDistanceAtr,0.25),
    maxExtensionAtr:n(options.maxExtensionAtr,1.80),
    minH1Agreement:n(options.minH1Agreement,0.60),
    h1BuyRsiMin:n(options.h1BuyRsiMin,45),h1BuyRsiMax:n(options.h1BuyRsiMax,75),
    h1SellRsiMin:n(options.h1SellRsiMin,25),h1SellRsiMax:n(options.h1SellRsiMax,55),
    useVolumeFilter:options.useVolumeFilter===true,
    minVolumeRatio:n(options.minVolumeRatio,0.90),
    maxSpreadPrice:n(options.maxSpreadPrice,0.60)
  };
  const debug = options.debug && typeof options.debug === 'object' ? options.debug : null;
  const trend=xauH1RetestTrendV3(features,cfg);
  const m5=features.m5||{},all=bars(features.recentM5||[]);
  if (debug) debug.trend = trend;
  if(all.length<cfg.breakoutLookback+cfg.maxRetestBars+cfg.maxConfirmBars+3)return wait(trend,'insufficient_recent_m5_bars');
  const confirmationIndex=all.length-1,confirmation=all[confirmationIndex];
  if(!validBar(confirmation))return wait(trend,'invalid_confirmation_bar');
  if(features.barTime&&Number(features.barTime)!==Number(confirmation.time))return wait(trend,'m5_bar_time_mismatch');
  const atr=n(m5.atr14),spread=n(features.spread);
  if(!(atr>0))return wait(trend,'invalid_m5_atr');
  if(spread>cfg.maxSpreadPrice)return wait(trend,'spread_filter_failed',{spread_price:spread});
  const h1Agreement=trend==='UP'?agreement(features.recentH1,'UP',5):trend==='DOWN'?agreement(features.recentH1,'DOWN',5):0;
  if (debug) debug.h1Agreement = h1Agreement;
  if(trend==='RANGE')return wait(trend,'h1_trend_not_clear',{h1_slope_agreement:h1Agreement});

  let selected=null;
  const firstRetest=Math.max(0,confirmationIndex-cfg.maxConfirmBars);
  const lastRetest=confirmationIndex-1;

  for(let retestIndex=lastRetest;retestIndex>=firstRetest;retestIndex-=1){
    const retest=all[retestIndex];
    if (debug) debug.last = { retestIndex, validRetest: validBar(retest) };
    if(!validBar(retest))continue;
    const breakoutMin=Math.max(cfg.breakoutLookback,retestIndex-cfg.maxRetestBars);
    const breakoutMax=retestIndex-cfg.minRetestBars;
    for(let bi=breakoutMax;bi>=breakoutMin;bi-=1){
      const breakout=all[bi];
      if(!validBar(breakout))continue;
      const rangeBars=all.slice(bi-cfg.breakoutLookback,bi);
      if(rangeBars.length!==cfg.breakoutLookback||rangeBars.some(x=>!validBar(x)))continue;
      const rangeHigh=Math.max(...rangeBars.map(x=>x.high)),rangeLow=Math.min(...rangeBars.map(x=>x.low));
      const rangeWidth=rangeHigh-rangeLow,rangeAtr=rangeWidth/atr;
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.range = { bi, rangeHigh, rangeLow, rangeWidth, rangeAtr, pass: rangeWidth>0&&rangeAtr>=cfg.minRangeAtr&&rangeAtr<=cfg.maxRangeAtr };
      if(!(rangeWidth>0&&rangeAtr>=cfg.minRangeAtr&&rangeAtr<=cfg.maxRangeAtr))continue;

      const bRange=breakout.high-breakout.low;
      const bBodyAtr=Math.abs(breakout.close-breakout.open)/atr;
      if(!(bRange>0&&bBodyAtr>=cfg.breakoutBodyAtr&&bBodyAtr<=cfg.maxBreakoutBodyAtr))continue;
      const bCloseLoc=(breakout.close-breakout.low)/bRange;
      const buyBreak=trend==='UP'&&m5.ema20>m5.ema50&&breakout.close>breakout.open&&breakout.close>=rangeHigh+cfg.breakoutAtr*atr&&bCloseLoc>=cfg.breakoutCloseLocation;
      const sellBreak=trend==='DOWN'&&m5.ema20<m5.ema50&&breakout.close<breakout.open&&breakout.close<=rangeLow-cfg.breakoutAtr*atr&&bCloseLoc<=1-cfg.breakoutCloseLocation;
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.breakout = { bi, bBodyAtr, bCloseLoc, buyBreak, sellBreak };
      if(!buyBreak&&!sellBreak)continue;

      const direction=buyBreak?'BUY':'SELL',level=direction==='BUY'?rangeHigh:rangeLow;

      let intact=true;
      for(let k=bi+1;k<retestIndex;k+=1){
        const mid=all[k];
        if(!validBar(mid)){intact=false;break;}
        if(direction==='BUY'&&mid.close<level-cfg.maxPenetrationAtr*atr){intact=false;break;}
        if(direction==='SELL'&&mid.close>level+cfg.maxPenetrationAtr*atr){intact=false;break;}
      }
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.pathIntact = intact;
      if(!intact)continue;

      const retestTouch=direction==='BUY'
        ?retest.low<=level+cfg.retestToleranceAtr*atr&&retest.low>=level-cfg.maxPenetrationAtr*atr&&retest.close>=level-cfg.retestCloseBufferAtr*atr
        :retest.high>=level-cfg.retestToleranceAtr*atr&&retest.high<=level+cfg.maxPenetrationAtr*atr&&retest.close<=level+cfg.retestCloseBufferAtr*atr;
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.retestTouch = retestTouch;
      if(!retestTouch)continue;

      let confirmPath=true;
      for(let k=retestIndex+1;k<confirmationIndex;k+=1){
        const mid=all[k];
        if(!validBar(mid)){confirmPath=false;break;}
        if(direction==='BUY'&&mid.close<level-cfg.maxPenetrationAtr*atr){confirmPath=false;break;}
        if(direction==='SELL'&&mid.close>level+cfg.maxPenetrationAtr*atr){confirmPath=false;break;}
      }
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.confirmPath = confirmPath;
      if(!confirmPath)continue;

      const cRange=confirmation.high-confirmation.low;
      const cBodyAtr=Math.abs(confirmation.close-confirmation.open)/atr;
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.confirmBody = { cRange, cBodyAtr, pass:cRange>0&&cBodyAtr>=cfg.confirmBodyAtr&&cBodyAtr<=cfg.maxConfirmBodyAtr };
      if(!(cRange>0&&cBodyAtr>=cfg.confirmBodyAtr&&cBodyAtr<=cfg.maxConfirmBodyAtr))continue;
      const cCloseLoc=(confirmation.close-confirmation.low)/cRange;
      const confirmOk=direction==='BUY'
        ?confirmation.close>level+cfg.confirmBufferAtr*atr&&confirmation.close>confirmation.open&&confirmation.close>retest.close&&cCloseLoc>=cfg.minConfirmCloseLocation
        :confirmation.close<level-cfg.confirmBufferAtr*atr&&confirmation.close<confirmation.open&&confirmation.close<retest.close&&cCloseLoc<=1-cfg.minConfirmCloseLocation;
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.confirmOk = confirmOk;
      if(!confirmOk)continue;

      const extension=direction==='BUY'?(confirmation.close-m5.ema20)/atr:(m5.ema20-confirmation.close)/atr;
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.extension = extension;
      if(extension<-0.50||extension>cfg.maxExtensionAtr)continue;

      const vols=rangeBars.map(x=>n(x.volume)).filter(v=>v>=0),avgVolume=vols.length?vols.reduce((s,v)=>s+v,0)/vols.length:0;
      const volumeRatio=avgVolume>0?n(confirmation.volume)/avgVolume:0;
      if(cfg.useVolumeFilter&&avgVolume>0&&volumeRatio<cfg.minVolumeRatio)continue;

      const entry=direction==='BUY'?n(features.ask):n(features.bid);
      const stop=direction==='BUY'?retest.low-cfg.stopBufferAtr*atr:retest.high+cfg.stopBufferAtr*atr;
      const stopDistance=Math.abs(entry-stop),stopAtr=stopDistance/atr;
      if (debug && retestIndex === debug.targetRetestIndex) debug.last.stop = { entry, stop, stopDistance, stopAtr };
      if(!(stopDistance>0&&stopAtr>=cfg.minStopAtr&&stopAtr<=cfg.maxStopAtr))continue;

      const target=direction==='BUY'?entry+stopDistance*cfg.takeProfitR:entry-stopDistance*cfg.takeProfitR;
      const spreadAdjustedDistance=Math.max(0,Math.abs(n(features.bid)-confirmation.close));
      if(cfg.maxEntryDistanceAtr>0&&spreadAdjustedDistance>cfg.maxEntryDistanceAtr*atr)continue;

      selected={
        candidate:direction,trend:direction==='BUY'?'UP':'DOWN',setup_type:'H1_RANGE_BREAK_RETEST_RECLAIM_V3',
        entry,stop_loss:stop,take_profit:target,risk_reward:cfg.takeProfitR,
        diagnostics:{
          breakout_time:breakout.time,retest_time:retest.time,confirmation_time:confirmation.time,
          confirmation_lag_bars:confirmationIndex-retestIndex,range_high:rangeHigh,range_low:rangeLow,
          range_atr:rangeAtr,breakout_body_atr:bBodyAtr,breakout_close_location:bCloseLoc,
          retest_low:retest.low,retest_high:retest.high,retest_close:retest.close,
          confirmation_body_atr:cBodyAtr,confirmation_close_location:cCloseLoc,
          extension_atr:extension,volume_ratio:volumeRatio,stop_atr:stopAtr,h1_slope_agreement:h1Agreement
        },
        reasons:[]
      };
      break;
    }
    if(selected)break;
  }
  return selected||wait(trend,'no_valid_breakout_retest_reclaim',{h1_slope_agreement:h1Agreement});
}
