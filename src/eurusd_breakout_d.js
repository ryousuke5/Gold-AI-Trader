function sortBars(bars){return [...bars].sort((a,b)=>a.time-b.time);}
function slopeAgreement(bars,dir){if(bars.length<3)return 0;let good=0;for(let i=1;i<bars.length;i++){const d=bars[i].close-bars[i-1].close;if((dir==='UP'&&d>0)||(dir==='DOWN'&&d<0))good++;}return good/(bars.length-1);}
function median(values){const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return NaN;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function waitResult(trend,reasons=[],extra={}){return {candidate:'WAIT',quality_score:0,setup_type:'NONE',trend,entry:0,stop_loss:0,take_profit:0,risk_reward:0,stop_atr:0,spread_to_tp_pct:0,reasons:[...new Set(reasons)],...extra};}

export function eurUsdH1TrendBreakoutDTrend(f,options={}){
  const h=f.h1||{},recent=sortBars(f.recentH1||[]).slice(-6);
  const minAgreement=Number(options.minH1Agreement??process.env.EURUSD_BREAKOUT_D_MIN_H1_AGREEMENT??0.60);
  const up=h.close>h.ema20&&h.ema20>h.ema50&&h.ema50>h.ema200&&slopeAgreement(recent,'UP')>=minAgreement;
  const down=h.close<h.ema20&&h.ema20<h.ema50&&h.ema50<h.ema200&&slopeAgreement(recent,'DOWN')>=minAgreement;
  return up?'UP':down?'DOWN':'RANGE';
}

export function buildEurUsdBreakoutSetupD(f,options={}){
  const rangeBars=Math.max(6,Math.floor(Number(options.rangeBars??process.env.EURUSD_BREAKOUT_D_RANGE_BARS??8)));
  const minRangeAtr=Number(options.minRangeAtr??process.env.EURUSD_BREAKOUT_D_MIN_RANGE_ATR??0.55);
  const maxRangeAtr=Number(options.maxRangeAtr??process.env.EURUSD_BREAKOUT_D_MAX_RANGE_ATR??1.80);
  const breakBufferAtr=Number(options.breakBufferAtr??process.env.EURUSD_BREAKOUT_D_BREAK_BUFFER_ATR??0.05);
  const minTriggerBodyAtr=Number(options.minTriggerBodyAtr??process.env.EURUSD_BREAKOUT_D_MIN_TRIGGER_BODY_ATR??0.30);
  const maxTriggerBodyAtr=Number(options.maxTriggerBodyAtr??process.env.EURUSD_BREAKOUT_D_MAX_TRIGGER_BODY_ATR??1.10);
  const minCloseLocation=Number(options.minCloseLocation??process.env.EURUSD_BREAKOUT_D_MIN_CLOSE_LOCATION??0.70);
  const minTriggerRangeAtr=Number(options.minTriggerRangeAtr??process.env.EURUSD_BREAKOUT_D_MIN_TRIGGER_RANGE_ATR??0.75);
  const maxH1ExtensionAtr=Number(options.maxH1ExtensionAtr??process.env.EURUSD_BREAKOUT_D_MAX_H1_EXTENSION_ATR??2.50);
  const minStopAtr=Number(options.minStopAtr??process.env.EURUSD_BREAKOUT_D_MIN_STOP_ATR??0.50);
  const maxStopAtr=Number(options.maxStopAtr??process.env.EURUSD_BREAKOUT_D_MAX_STOP_ATR??1.60);
  const stopBufferAtr=Number(options.stopBufferAtr??process.env.EURUSD_BREAKOUT_D_STOP_BUFFER_ATR??0.12);
  const takeProfitR=Number(options.takeProfitR??process.env.EURUSD_BREAKOUT_D_TAKE_PROFIT_R??1.50);
  const maxSpreadPips=Number(options.maxSpreadPips??process.env.EURUSD_MAX_SPREAD_PIPS??1.20);
  const maxSpreadAtrPct=Number(options.maxSpreadAtrPct??process.env.EURUSD_MAX_SPREAD_ATR_PCT??15);
  const maxSpreadToTpPct=Number(options.maxSpreadToTpPct??process.env.EURUSD_MAX_SPREAD_TO_TP_PCT??15);
  const minRsiBuy=Number(options.minRsiBuy??process.env.EURUSD_BREAKOUT_D_MIN_RSI_BUY??52);
  const maxRsiBuy=Number(options.maxRsiBuy??process.env.EURUSD_BREAKOUT_D_MAX_RSI_BUY??72);
  const minRsiSell=Number(options.minRsiSell??process.env.EURUSD_BREAKOUT_D_MIN_RSI_SELL??28);
  const maxRsiSell=Number(options.maxRsiSell??process.env.EURUSD_BREAKOUT_D_MAX_RSI_SELL??48);
  const minAtrExpansion=Number(options.minAtrExpansion??process.env.EURUSD_BREAKOUT_D_MIN_ATR_EXPANSION??0.95);
  const minScore=Number(options.minScore??process.env.EURUSD_BREAKOUT_D_MIN_SCORE??80);
  const trend=eurUsdH1TrendBreakoutDTrend(f,options),bars=sortBars(f.recentM15||[]);
  if(bars.length<rangeBars+1)return waitResult(trend,['insufficient_recent_m15_bars']);
  const latest=bars.at(-1),range=bars.slice(-(rangeBars+1,-1));
  const prior=bars.slice(-(rangeBars+1)).slice(0,-1);
  if(f.barTime>0&&latest.time!==f.barTime)return waitResult(trend,['m15_bar_time_mismatch']);
  if(prior.length!==rangeBars)return waitResult(trend,['invalid_range_window']);
  for(let i=1;i<prior.length;i++)if(prior[i].time-prior[i-1].time!==900)return waitResult(trend,['recent_m15_setup_bars_not_contiguous']);
  const atr=Number(f.m15?.atr14||0);
  if(!(atr>0))return waitResult(trend,['invalid_atr']);
  const spread=Number(f.spread||0),spreadPips=spread/0.0001,spreadAtrPct=spread/atr*100;
  if(!(spreadPips<=maxSpreadPips&&spreadAtrPct<=maxSpreadAtrPct))return waitResult(trend,['spread_filter_failed'],{spread_pips:spreadPips,spread_atr_pct:spreadAtrPct});
  const h1Recent=sortBars(f.recentH1||[]).slice(-6),h1Agreement=trend==='UP'?slopeAgreement(h1Recent,'UP'):trend==='DOWN'?slopeAgreement(h1Recent,'DOWN'):0;
  const h1Extension=f.h1?.atr14>0?Math.abs(f.h1.close-f.h1.ema50)/f.h1.atr14:Infinity;
  if(!(h1Extension<=maxH1ExtensionAtr))return waitResult(trend,['h1_overextended'],{h1_extension_atr:h1Extension,h1_slope_agreement:h1Agreement});
  const rangeHigh=Math.max(...prior.map(b=>b.high)),rangeLow=Math.min(...prior.map(b=>b.low)),rangeWidth=rangeHigh-rangeLow,rangeWidthAtr=rangeWidth/atr;
  if(!(rangeWidthAtr>=minRangeAtr&&rangeWidthAtr<=maxRangeAtr))return waitResult(trend,['range_width_outside_band'],{range_width_atr:rangeWidthAtr,h1_slope_agreement:h1Agreement,h1_extension_atr:h1Extension});
  const triggerRange=Math.max(0,latest.high-latest.low),triggerBodyAtr=Math.abs(latest.close-latest.open)/atr,triggerCloseLoc=triggerRange>0?(latest.close-latest.low)/triggerRange:0;
  const priorAtrs=prior.map(b=>b.atr14).filter(x=>Number.isFinite(x)&&x>0),atrBaseline=median(priorAtrs),atrExpansion=atrBaseline>0?atr/atrBaseline:Infinity;
  const buyBreak=trend==='UP'&&latest.close>rangeHigh+atr*breakBufferAtr;
  const sellBreak=trend==='DOWN'&&latest.close<rangeLow-atr*breakBufferAtr;
  const buy=buyBreak&&latest.close>latest.open&&triggerRange/atr>=minTriggerRangeAtr&&triggerBodyAtr>=minTriggerBodyAtr&&triggerBodyAtr<=maxTriggerBodyAtr&&triggerCloseLoc>=minCloseLocation&&atrExpansion>=minAtrExpansion&&f.m15.rsi14>=minRsiBuy&&f.m15.rsi14<=maxRsiBuy;
  const sell=sellBreak&&latest.close<latest.open&&triggerRange/atr>=minTriggerRangeAtr&&triggerBodyAtr>=minTriggerBodyAtr&&triggerBodyAtr<=maxTriggerBodyAtr&&(1-triggerCloseLoc)>=minCloseLocation&&atrExpansion>=minAtrExpansion&&f.m15.rsi14>=minRsiSell&&f.m15.rsi14<=maxRsiSell;
  const direction=buy?'BUY':sell?'SELL':'WAIT';
  const reasons=[];let score=0;
  if(trend==='UP'||trend==='DOWN')score+=20;else reasons.push('h1_trend_not_clear');
  if(h1Agreement>=Number(options.minH1Agreement??process.env.EURUSD_BREAKOUT_D_MIN_H1_AGREEMENT??0.60))score+=15;else reasons.push('h1_slope_agreement_weak');
  if(rangeWidthAtr>=minRangeAtr&&rangeWidthAtr<=maxRangeAtr)score+=15;else reasons.push('range_width_outside_band');
  if((buyBreak||sellBreak))score+=20;else reasons.push('breakout_confirmation_failed');
  if(triggerRange/atr>=minTriggerRangeAtr)score+=10;else reasons.push('trigger_range_too_small');
  if(triggerBodyAtr>=minTriggerBodyAtr&&triggerBodyAtr<=maxTriggerBodyAtr)score+=5;else reasons.push('trigger_body_outside_atr_band');
  if((trend==='UP'&&triggerCloseLoc>=minCloseLocation)||(trend==='DOWN'&&triggerCloseLoc<=1-minCloseLocation))score+=5;else reasons.push('trigger_close_location_weak');
  if(atrExpansion>=minAtrExpansion)score+=5;else reasons.push('atr_expansion_weak');
  if((trend==='UP'&&f.m15.rsi14>=minRsiBuy&&f.m15.rsi14<=maxRsiBuy)||(trend==='DOWN'&&f.m15.rsi14>=minRsiSell&&f.m15.rsi14<=maxRsiSell))score+=5;else reasons.push('m15_rsi_outside_breakout_zone');
  if(direction==='WAIT')return waitResult(trend,reasons,{quality_score:score,h1_slope_agreement:h1Agreement,h1_extension_atr:h1Extension,range_width_atr:rangeWidthAtr,trigger_range_atr:triggerRange/atr,trigger_body_atr:triggerBodyAtr,trigger_close_location:triggerCloseLoc,atr_expansion:atrExpansion,spread_pips:spreadPips,spread_atr_pct:spreadAtrPct});
  const entry=direction==='BUY'?Number(f.ask):Number(f.bid);
  const stopLoss=direction==='BUY'?rangeLow-atr*stopBufferAtr:rangeHigh+atr*stopBufferAtr;
  const stopDistance=Math.abs(entry-stopLoss),stopAtr=stopDistance/atr;
  if(!(stopAtr>=minStopAtr&&stopAtr<=maxStopAtr))return waitResult(trend,[...reasons,'stop_distance_outside_atr_band'],{quality_score:score,stop_atr:stopAtr});
  const takeProfit=direction==='BUY'?entry+stopDistance*takeProfitR:entry-stopDistance*takeProfitR;
  const spreadToTpPct=spread/(stopDistance*takeProfitR)*100;
  if(spreadToTpPct>maxSpreadToTpPct)return waitResult(trend,[...reasons,'spread_too_large_vs_target'],{quality_score:score,stop_atr:stopAtr,spread_to_tp_pct:spreadToTpPct});
  if(score<minScore)return waitResult(trend,[...reasons,'quality_score_below_threshold'],{quality_score:score,stop_atr:stopAtr,spread_to_tp_pct:spreadToTpPct});
  return {candidate:direction,quality_score:score,setup_type:'BREAKOUT_D_RANGE_EXPANSION',trend,entry,stop_loss:stopLoss,take_profit:takeProfit,risk_reward:takeProfitR,h1_slope_agreement:h1Agreement,h1_extension_atr:h1Extension,range_width_atr:rangeWidthAtr,trigger_range_atr:triggerRange/atr,trigger_body_atr:triggerBodyAtr,trigger_close_location:triggerCloseLoc,atr_expansion:atrExpansion,spread_pips:spreadPips,spread_atr_pct:spreadAtrPct,spread_to_tp_pct:spreadToTpPct,stop_atr:stopAtr,reasons:[]};
}
