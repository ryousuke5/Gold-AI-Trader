function sortBarsAscending(bars) { return [...bars].sort((a,b)=>a.time-b.time); }
function maxHigh(bars) { return bars.reduce((m,b)=>Math.max(m,b.high),-Infinity); }
function minLow(bars) { return bars.reduce((m,b)=>Math.min(m,b.low),Infinity); }
function slopeAgreement(bars,dir){
  if(bars.length<3) return 0;
  let good=0;
  for(let i=1;i<bars.length;i++){
    const d=bars[i].close-bars[i-1].close;
    if((dir==='UP'&&d>0)||(dir==='DOWN'&&d<0)) good++;
  }
  return good/(bars.length-1);
}
function waitResult(trend,reasons=[],extra={}) {
  return {candidate:'WAIT',quality_score:0,setup_type:'NONE',trend,entry:0,stop_loss:0,take_profit:0,risk_reward:0,stop_atr:0,spread_to_tp_pct:0,reasons:[...new Set(reasons)],...extra};
}
export function eurUsdH1TrendPullbackV3Trend(f, options={}) {
  const h=f.h1||{}, recent=sortBarsAscending(f.recentH1||[]).slice(-6);
  const minAgreement=Number(options.minH1Agreement??process.env.EURUSD_PULLBACK_V3_MIN_H1_AGREEMENT??0.60);
  const up=h.close>h.ema20&&h.ema20>h.ema50&&h.ema50>h.ema200&&slopeAgreement(recent,'UP')>=minAgreement;
  const down=h.close<h.ema20&&h.ema20<h.ema50&&h.ema50<h.ema200&&slopeAgreement(recent,'DOWN')>=minAgreement;
  return up?'UP':down?'DOWN':'RANGE';
}
export function buildEurUsdTrendPullbackSetupV3(f, options={}) {
  const lookback=Math.max(9,Math.floor(Number(options.lookback??process.env.EURUSD_PULLBACK_V3_LOOKBACK??10)));
  const split=Math.max(4,Math.floor((lookback-1)/2));
  const minRetrace=Number(options.minRetraceRatio??process.env.EURUSD_PULLBACK_V3_MIN_RETRACE_RATIO??0.20);
  const maxRetrace=Number(options.maxRetraceRatio??process.env.EURUSD_PULLBACK_V3_MAX_RETRACE_RATIO??0.80);
  const minImpulseAtr=Number(options.minImpulseAtr??process.env.EURUSD_PULLBACK_V3_MIN_IMPULSE_ATR??0.40);
  const minPullbackAtr=Number(options.minPullbackAtr??process.env.EURUSD_PULLBACK_V3_MIN_PULLBACK_ATR??0.08);
  const touchBufferAtr=Number(options.touchBufferAtr??process.env.EURUSD_PULLBACK_V3_TOUCH_BUFFER_ATR??0.20);
  const structureBufferAtr=Number(options.structureBufferAtr??process.env.EURUSD_PULLBACK_V3_STRUCTURE_BUFFER_ATR??0.15);
  const breakBufferAtr=Number(options.breakBufferAtr??process.env.EURUSD_PULLBACK_V3_BREAK_BUFFER_ATR??0.02);
  const holdBufferAtr=Number(options.holdBufferAtr??process.env.EURUSD_PULLBACK_V3_HOLD_BUFFER_ATR??0.08);
  const minBodyAtr=Number(options.minBodyAtr??process.env.EURUSD_PULLBACK_V3_MIN_BODY_ATR??0.30);
  const maxBodyAtr=Number(options.maxBodyAtr??process.env.EURUSD_PULLBACK_V3_MAX_BODY_ATR??1.40);
  const minCloseLocation=Number(options.minCloseLocation??process.env.EURUSD_PULLBACK_V3_MIN_CLOSE_LOCATION??0.68);
  const maxExtension=Number(options.maxH1ExtensionAtr??process.env.EURUSD_PULLBACK_V3_MAX_H1_EXTENSION_ATR??2.50);
  const maxSpreadPips=Number(options.maxSpreadPips??process.env.EURUSD_MAX_SPREAD_PIPS??1.20);
  const maxSpreadAtrPct=Number(options.maxSpreadAtrPct??process.env.EURUSD_MAX_SPREAD_ATR_PCT??15);
  const minStopAtr=Number(options.minStopAtr??process.env.EURUSD_MIN_STOP_ATR??0.50);
  const maxStopAtr=Number(options.maxStopAtr??process.env.EURUSD_MAX_STOP_ATR??1.50);
  const tpR=Number(options.takeProfitR??process.env.EURUSD_PULLBACK_V3_TAKE_PROFIT_R??1.50);
  const maxSpreadToTpPct=Number(options.maxSpreadToTpPct??process.env.EURUSD_MAX_SPREAD_TO_TP_PCT??15);
  const trend=eurUsdH1TrendPullbackV3Trend(f,options);
  const bars=sortBarsAscending(f.recentM15||[]);
  if(bars.length<lookback+1) return waitResult(trend,['insufficient_recent_m15_bars']);
  const latest=bars.at(-1), active=bars.slice(-(lookback+1));
  if(f.barTime>0&&latest.time!==f.barTime) return waitResult(trend,['m15_bar_time_mismatch']);
  for(let i=1;i<active.length;i++) if(active[i].time-active[i-1].time!==900) return waitResult(trend,['recent_m15_setup_bars_not_contiguous']);
  const atr=Number(f.m15?.atr14||0);
  if(!(atr>0)) return waitResult(trend,['invalid_atr']);
  const spread=Number(f.spread||0), spreadPips=spread/0.0001, spreadAtrPct=spread/atr*100;
  if(!(spreadPips<=maxSpreadPips&&spreadAtrPct<=maxSpreadAtrPct)) return waitResult(trend,['spread_filter_failed'],{spread_pips:spreadPips,spread_atr_pct:spreadAtrPct});
  const h1Recent=sortBarsAscending(f.recentH1||[]).slice(-6), h1Agreement=trend==='UP'?slopeAgreement(h1Recent,'UP'):trend==='DOWN'?slopeAgreement(h1Recent,'DOWN'):0;
  const h1Extension=f.h1.atr14>0?Math.abs(f.h1.close-f.h1.ema50)/f.h1.atr14:Infinity;
  if(!(h1Extension<=maxExtension)) return waitResult(trend,['h1_overextended'],{h1_extension_atr:h1Extension,h1_slope_agreement:h1Agreement});
  const preConfirmation=active.slice(0,-1);
  const trigger=preConfirmation.at(-1);
  const structureBeforeTrigger=preConfirmation.slice(0,-1);
  const structureSplit=Math.max(3,Math.floor(structureBeforeTrigger.length/2));
  const impulse=structureBeforeTrigger.slice(0,structureSplit);
  const pullback=structureBeforeTrigger.slice(structureSplit);
  if(impulse.length<3||pullback.length<4||!trigger) return waitResult(trend,['invalid_pullback_window']);
  const impulseHigh=maxHigh(impulse), impulseLow=minLow(impulse), impulseRange=impulseHigh-impulseLow;
  if(!(impulseRange>0)) return waitResult(trend,['invalid_impulse_range']);
  const impulseNetAtr=(impulse.at(-1).close-impulse[0].open)/atr;
  const pullbackNetAtr=(pullback.at(-1).close-pullback[0].close)/atr;
  const retraceBuy=(impulseHigh-minLow(pullback))/impulseRange;
  const retraceSell=(maxHigh(pullback)-impulseLow)/impulseRange;
  const touchBuy=pullback.some(b=>b.low<=f.m15.ema20+atr*touchBufferAtr);
  const touchSell=pullback.some(b=>b.high>=f.m15.ema20-atr*touchBufferAtr);
  const heldBuy=minLow(pullback)>f.m15.ema50-atr*structureBufferAtr;
  const heldSell=maxHigh(pullback)<f.m15.ema50+atr*structureBufferAtr;
  const oppBuy=pullback.filter((b,i)=>i>0&&b.close<pullback[i-1].close).length;
  const oppSell=pullback.filter((b,i)=>i>0&&b.close>pullback[i-1].close).length;
  const triggerLevelBuy=maxHigh(pullback), triggerLevelSell=minLow(pullback);
  const latestRange=Math.max(0,latest.high-latest.low), latestBodyAtr=Math.abs(latest.close-latest.open)/atr;
  const latestCloseLoc=latestRange>0?(latest.close-latest.low)/latestRange:0;
  const latestBull=latest.close>latest.open, latestBear=latest.close<latest.open;
  const buyConfirm=trigger.close>triggerLevelBuy+atr*breakBufferAtr && latest.low>triggerLevelBuy-atr*holdBufferAtr && latest.close>triggerLevelBuy && latestBull;
  const sellConfirm=trigger.close<triggerLevelSell-atr*breakBufferAtr && latest.high<triggerLevelSell+atr*holdBufferAtr && latest.close<triggerLevelSell && latestBear;
  const buyTrigger=trend==='UP'&&f.m15.ema20>f.m15.ema50&&touchBuy&&heldBuy&&oppBuy>=2&&impulseNetAtr>=minImpulseAtr&&pullbackNetAtr<=-minPullbackAtr&&retraceBuy>=minRetrace&&retraceBuy<=maxRetrace&&buyConfirm&&latestBodyAtr>=minBodyAtr&&latestBodyAtr<=maxBodyAtr&&latestCloseLoc>=minCloseLocation;
  const sellTrigger=trend==='DOWN'&&f.m15.ema20<f.m15.ema50&&touchSell&&heldSell&&oppSell>=2&&impulseNetAtr<=-minImpulseAtr&&pullbackNetAtr>=minPullbackAtr&&retraceSell>=minRetrace&&retraceSell<=maxRetrace&&sellConfirm&&latestBodyAtr>=minBodyAtr&&latestBodyAtr<=maxBodyAtr&&latestCloseLoc<=1-minCloseLocation;
  const direction=buyTrigger?'BUY':sellTrigger?'SELL':'WAIT';
  const reasons=[];
  let score=0;
  if(trend==='UP'||trend==='DOWN')score+=25;else reasons.push('h1_trend_not_clear');
  if(h1Agreement>=Number(options.minH1Agreement??process.env.EURUSD_PULLBACK_V3_MIN_H1_AGREEMENT??0.60))score+=10;else reasons.push('h1_slope_agreement_weak');
  if((trend==='UP'&&f.m15.ema20>f.m15.ema50)||(trend==='DOWN'&&f.m15.ema20<f.m15.ema50))score+=10;else reasons.push('m15_ema_alignment_failed');
  if((trend==='UP'&&impulseNetAtr>=minImpulseAtr)||(trend==='DOWN'&&impulseNetAtr<=-minImpulseAtr))score+=10;else reasons.push('impulse_quality_failed');
  if((trend==='UP'&&pullbackNetAtr<=-minPullbackAtr)||(trend==='DOWN'&&pullbackNetAtr>=minPullbackAtr))score+=10;else reasons.push('pullback_direction_failed');
  if((trend==='UP'&&oppBuy>=2)||(trend==='DOWN'&&oppSell>=2))score+=5;else reasons.push('pullback_structure_weak');
  if((trend==='UP'&&touchBuy&&heldBuy&&retraceBuy>=minRetrace&&retraceBuy<=maxRetrace)||(trend==='DOWN'&&touchSell&&heldSell&&retraceSell>=minRetrace&&retraceSell<=maxRetrace))score+=10;else reasons.push('pullback_quality_failed');
  if((trend==='UP'&&buyConfirm)||(trend==='DOWN'&&sellConfirm))score+=10;else reasons.push('breakout_confirmation_failed');
  if(latestBodyAtr>=minBodyAtr&&latestBodyAtr<=maxBodyAtr)score+=5;else reasons.push('confirmation_body_outside_atr_band');
  if((trend==='UP'&&latestCloseLoc>=minCloseLocation)||(trend==='DOWN'&&latestCloseLoc<=1-minCloseLocation))score+=5;else reasons.push('confirmation_close_location_weak');
  if(direction==='WAIT') return waitResult(trend,reasons,{quality_score:score,h1_slope_agreement:h1Agreement,h1_extension_atr:h1Extension,impulse_net_atr:impulseNetAtr,pullback_net_atr:pullbackNetAtr,retrace_buy:retraceBuy,retrace_sell:retraceSell,confirmation_body_atr:latestBodyAtr,confirmation_close_location:latestCloseLoc,spread_pips:spreadPips,spread_atr_pct:spreadAtrPct});
  const entry=direction==='BUY'?Number(f.ask):Number(f.bid);
  const stopLoss=direction==='BUY'?minLow(pullback)-atr*structureBufferAtr:maxHigh(pullback)+atr*structureBufferAtr;
  const stopDistance=Math.abs(entry-stopLoss), stopAtr=stopDistance/atr;
  if(!(stopAtr>=minStopAtr&&stopAtr<=maxStopAtr)) return waitResult(trend,[...reasons,'stop_distance_outside_atr_band'],{quality_score:score,stop_atr:stopAtr});
  const takeProfit=direction==='BUY'?entry+stopDistance*tpR:entry-stopDistance*tpR;
  const spreadToTpPct=stopDistance>0?spread/(stopDistance*tpR)*100:Infinity;
  if(spreadToTpPct>maxSpreadToTpPct) return waitResult(trend,[...reasons,'spread_too_large_vs_target'],{quality_score:score,stop_atr:stopAtr,spread_to_tp_pct:spreadToTpPct});
  if(score<90) return waitResult(trend,[...reasons,'quality_score_below_threshold'],{quality_score:score,stop_atr:stopAtr,spread_to_tp_pct:spreadToTpPct});
  return {candidate:direction,quality_score:score,setup_type:'TREND_PULLBACK_V3_RETEST',trend,entry,stop_loss:stopLoss,take_profit:takeProfit,risk_reward:tpR,h1_slope_agreement:h1Agreement,h1_extension_atr:h1Extension,impulse_net_atr:impulseNetAtr,pullback_net_atr:pullbackNetAtr,retrace_buy:retraceBuy,retrace_sell:retraceSell,confirmation_body_atr:latestBodyAtr,confirmation_close_location:latestCloseLoc,spread_pips:spreadPips,spread_atr_pct:spreadAtrPct,spread_to_tp_pct:spreadToTpPct,stop_atr:stopAtr,reasons:[]};
}