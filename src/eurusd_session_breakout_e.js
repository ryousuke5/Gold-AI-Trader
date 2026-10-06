// RESEARCH ONLY — not wired to live trading.
// EURUSD Strategy E: London-session breakout of the pre-London range.
// Intended architecture: mechanical candidate -> AI environment filter -> risk gate.
function parts(ts,timeZone){
  return new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ts*1000)).reduce((o,p)=>{if(p.type!=='literal')o[p.type]=Number(p.value);return o;},{});
}
function slopeAgreement(bars,dir){
  if(!Array.isArray(bars)||bars.length<3)return 0;
  const a=bars.slice(-6);let good=0,total=0;
  for(let i=1;i<a.length;i++){const d=Number(a[i].close)-Number(a[i-1].close);good+=(dir==='UP'?d>0:d<0);total++;}
  return total?good/total:0;
}
function wait(trend,reasons=[],extra={}){return {candidate:'WAIT',setup_type:'NONE',trend,quality_score:0,entry:0,stop_loss:0,take_profit:0,risk_reward:0,session_key:null,range_width_atr:0,h1_slope_agreement:0,reasons:[...new Set(reasons)],...extra};}

export function buildEurUsdSessionRangeBreakoutSetupE(features,options={}){
  const tz=options.sessionTimeZone??'Europe/London';
  const rangeStart=Number(options.rangeStartHour??0),rangeEnd=Number(options.rangeEndHour??7);
  const entryStart=Number(options.entryStartHour??7),entryEnd=Number(options.entryEndHour??15);
  const minRangeAtr=Number(options.minRangeAtr??0.50),maxRangeAtr=Number(options.maxRangeAtr??2.00);
  const stopBufferAtr=Number(options.stopBufferAtr??0.15),takeProfitR=Number(options.takeProfitR??2.00);
  const minH1Agreement=Number(options.minH1Agreement??0.67),maxSpreadPips=Number(options.maxSpreadPips??0.80);
  const rangeBars=Array.isArray(features.recentM15)?features.recentM15:[];
  const h1=features.h1||{};
  const latest=rangeBars.at(-1);
  if(!latest)return wait('RANGE',['missing_m15_bar']);
  const p=parts((Number(features.barTime||latest.time))*1,tz);
  const hour=Number(p.hour),sessionKey=`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
  if(hour<entryStart||hour>=entryEnd)return wait('RANGE',['outside_entry_window'],{session_key:sessionKey});
  const dayRange=rangeBars.filter(b=>{const q=parts(Number(b.time),tz);return Number(q.year)===Number(p.year)&&Number(q.month)===Number(p.month)&&Number(q.day)===Number(p.day)&&Number(q.hour)>=rangeStart&&Number(q.hour)<rangeEnd;});
  if(dayRange.length<4)return wait('RANGE',['insufficient_pre_london_range_bars'],{session_key:sessionKey});
  const atr=Number(features.m15?.atr14||0),spread=Number(features.spread||0),spreadPips=spread/0.0001;
  if(!(atr>0))return wait('RANGE',['invalid_m15_atr'],{session_key:sessionKey});
  if(!(spreadPips<=maxSpreadPips))return wait('RANGE',['spread_filter_failed'],{session_key:sessionKey,spread_pips:spreadPips});
  const trend=(Number(h1.close)>Number(h1.ema20)&&Number(h1.ema20)>Number(h1.ema50)&&Number(h1.ema50)>Number(h1.ema200))?'UP':
    (Number(h1.close)<Number(h1.ema20)&&Number(h1.ema20)<Number(h1.ema50)&&Number(h1.ema50)<Number(h1.ema200))?'DOWN':'RANGE';
  const h1Agreement=trend==='UP'?slopeAgreement(features.recentH1||[],'UP'):trend==='DOWN'?slopeAgreement(features.recentH1||[],'DOWN'):0;
  if(!((trend==='UP'||trend==='DOWN')&&h1Agreement>=minH1Agreement))return wait(trend,['h1_trend_filter_failed'],{session_key:sessionKey,h1_slope_agreement:h1Agreement,spread_pips:spreadPips});
  const rangeHigh=Math.max(...dayRange.map(b=>Number(b.high))),rangeLow=Math.min(...dayRange.map(b=>Number(b.low)));
  const rangeWidthAtr=(rangeHigh-rangeLow)/atr;
  if(!(rangeWidthAtr>=minRangeAtr&&rangeWidthAtr<=maxRangeAtr))return wait(trend,['range_width_outside_band'],{session_key:sessionKey,h1_slope_agreement:h1Agreement,range_width_atr:rangeWidthAtr,spread_pips:spreadPips});
  const buy=trend==='UP'&&Number(latest.close)>rangeHigh;
  const sell=trend==='DOWN'&&Number(latest.close)<rangeLow;
  if(!buy&&!sell)return wait(trend,['breakout_not_confirmed'],{session_key:sessionKey,h1_slope_agreement:h1Agreement,range_width_atr:rangeWidthAtr,spread_pips:spreadPips});
  const dir=buy?'BUY':'SELL',entry=dir==='BUY'?Number(features.ask):Number(features.bid);
  const stop=dir==='BUY'?rangeLow-atr*stopBufferAtr:rangeHigh+atr*stopBufferAtr;
  const risk=Math.abs(entry-stop);
  if(!(risk>0))return wait(trend,['invalid_risk_distance'],{session_key:sessionKey});
  const target=dir==='BUY'?entry+risk*takeProfitR:entry-risk*takeProfitR;
  const stopAtr=risk/atr,spreadToTpPct=spread/(risk*takeProfitR)*100;
  if(spreadToTpPct>15)return wait(trend,['spread_too_large_vs_target'],{session_key:sessionKey,stop_atr:stopAtr,spread_to_tp_pct:spreadToTpPct});
  return {candidate:dir,setup_type:'LONDON_SESSION_RANGE_BREAKOUT_E',trend,quality_score:100,entry,stop_loss:stop,take_profit:target,risk_reward:takeProfitR,stop_atr:stopAtr,spread_to_tp_pct:spreadToTpPct,session_key:sessionKey,range_high:rangeHigh,range_low:rangeLow,range_width_atr:rangeWidthAtr,h1_slope_agreement:h1Agreement,spread_pips:spreadPips,max_trades_per_session:1,research_only:true,reasons:[]};
}
