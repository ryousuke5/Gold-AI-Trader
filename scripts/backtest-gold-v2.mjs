import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGoldV2Setup } from '../src/gold_strategy_v2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_CONFIG = {
  lookbackDays: Math.max(365, Number(process.env.GOLD_BACKTEST_LOOKBACK_DAYS || 1825)),
  initialEquity: Math.max(1000, Number(process.env.GOLD_BACKTEST_INITIAL_EQUITY || 100000)),
  riskPct: Math.max(0.01, Number(process.env.GOLD_BACKTEST_RISK_PCT || 0.25)),
  spreadPrice: Math.max(0, Number(process.env.GOLD_BACKTEST_SPREAD_PRICE || 0.50)),
  slippagePrice: Math.max(0, Number(process.env.GOLD_BACKTEST_SLIPPAGE_PRICE || 0.05)),
  maxDailyLossPct: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_DAILY_LOSS_PCT || 2)),
  maxDrawdownPct: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_DRAWDOWN_PCT || 5)),
  maxHoldBars: Math.max(1, Math.floor(Number(process.env.GOLD_BACKTEST_MAX_HOLD_BARS || 96))),
  maxEntryGapAtr: Math.max(0.1, Number(process.env.GOLD_BACKTEST_MAX_ENTRY_GAP_ATR || 0.50)),
  maxBarsWithoutSetup: 0,
  serverTimezone: process.env.GOLD_BACKTEST_SERVER_TIMEZONE || 'Europe/Nicosia'
};

const STRATEGY = {
  rangeLookback: Math.max(4, Number(process.env.GOLD_RANGE_LOOKBACK || 12)),
  minRangeAtr: Math.max(0.1, Number(process.env.GOLD_MIN_RANGE_ATR || 0.8)),
  maxRangeAtr: Math.max(0.2, Number(process.env.GOLD_MAX_RANGE_ATR || 2.8)),
  breakoutAtr: Math.max(0.01, Number(process.env.GOLD_BREAKOUT_ATR || 0.10)),
  minBodyAtr: Math.max(0.05, Number(process.env.GOLD_MIN_BODY_ATR || 0.40)),
  minCloseLocation: Math.min(0.95, Math.max(0.50, Number(process.env.GOLD_MIN_CLOSE_LOCATION || 0.65))),
  minVolumeRatio: Math.max(0.1, Number(process.env.GOLD_MIN_VOLUME_RATIO || 1.10)),
  buyRsiMin: Math.max(1, Number(process.env.GOLD_BUY_RSI_MIN || 52)),
  buyRsiMax: Math.min(99, Number(process.env.GOLD_BUY_RSI_MAX || 75)),
  sellRsiMin: Math.max(1, Number(process.env.GOLD_SELL_RSI_MIN || 25)),
  sellRsiMax: Math.min(99, Number(process.env.GOLD_SELL_RSI_MAX || 48)),
  maxExtensionAtr: Math.max(0.1, Number(process.env.GOLD_MAX_EXTENSION_ATR || 1.50)),
  stopBufferAtr: Math.max(0, Number(process.env.GOLD_STOP_BUFFER_ATR || 0.15)),
  minStopAtr: Math.max(0.1, Number(process.env.GOLD_MIN_STOP_ATR || 0.80)),
  maxStopAtr: Math.max(0.2, Number(process.env.GOLD_MAX_STOP_ATR || 2.00)),
  takeProfitR: Math.max(1.0, Number(process.env.GOLD_TAKE_PROFIT_R || 2.00)),
  minH1RsiBuy: Math.max(1, Number(process.env.GOLD_MIN_H1_RSI_BUY || 50)),
  maxH1RsiBuy: Math.min(99, Number(process.env.GOLD_MAX_H1_RSI_BUY || 72)),
  minH1RsiSell: Math.max(1, Number(process.env.GOLD_MIN_H1_RSI_SELL || 28)),
  maxH1RsiSell: Math.min(99, Number(process.env.GOLD_MAX_H1_RSI_SELL || 50)),
  sessionStartUtc: Math.min(23, Math.max(0, Math.floor(Number(process.env.GOLD_SESSION_START_UTC || 7)))),
  sessionEndUtc: Math.min(23, Math.max(0, Math.floor(Number(process.env.GOLD_SESSION_END_UTC || 20))))
};

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (!values.length || period <= 0) return out;
  const alpha = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) continue;
    prev = prev === null ? v : alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(0, d);
    loss += Math.max(0, -d);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atr(bars, period) {
  const out = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr = new Array(bars.length).fill(0);
  for (let i = 0; i < bars.length; i++) {
    tr[i] = i === 0
      ? bars[i].high - bars[i].low
      : Math.max(
          bars[i].high - bars[i].low,
          Math.abs(bars[i].high - bars[i - 1].close),
          Math.abs(bars[i].low - bars[i - 1].close)
        );
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let value = sum / period;
  out[period] = value;
  for (let i = period + 1; i < bars.length; i++) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

function addIndicators(bars) {
  const closes = bars.map((b) => b.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const r = rsi(closes, 14), a = atr(bars, 14);
  return bars.map((b, i) => ({ ...b, ema20:e20[i], ema50:e50[i], ema200:e200[i], rsi14:r[i], atr14:a[i] }));
}

function localHour(timestamp) {
  return new Date(timestamp * 1000).getUTCHours();
}

function localDateTimeParts(timestampSeconds, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'
  }).formatToParts(new Date(timestampSeconds*1000));
  const out={};
  for (const part of parts) if(part.type!=='literal') out[part.type]=Number(part.value);
  return out;
}

function zonedHourStartUtc(timestampSeconds, timeZone) {
  const p=localDateTimeParts(timestampSeconds,timeZone);
  const localAsUtc=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  const offsetSeconds=Math.round((localAsUtc-timestampSeconds*1000)/1000);
  const localHourAsUtc=Date.UTC(p.year,p.month-1,p.day,p.hour,0,0);
  return Math.floor((localHourAsUtc-offsetSeconds*1000)/1000);
}

function aggregateM5ToH1(m5, timeZone='UTC') {
  const buckets = new Map();
  for (const bar of m5) {
    const hour = timeZone==='UTC' ? Math.floor(bar.time/3600)*3600 : zonedHourStartUtc(bar.time,timeZone);
    const cur = buckets.get(hour);
    if (!cur) {
      buckets.set(hour, { time:hour, open:bar.open, high:bar.high, low:bar.low, close:bar.close, volume:bar.volume });
    } else {
      cur.high = Math.max(cur.high, bar.high);
      cur.low = Math.min(cur.low, bar.low);
      cur.close = bar.close;
      cur.volume += bar.volume;
    }
  }
  return [...buckets.values()].sort((a,b)=>a.time-b.time);
}

function normalizeDukascopy(rows) {
  const now = Date.now();
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    time: Math.floor(Number(row[0]) / 1000),
    open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
    close: Number(row[4]), volume: Number(row[5]) || 0
  })).filter((b) =>
    Number.isFinite(b.time) && b.open > 0 &&
    b.high >= b.low && b.high >= b.open && b.high >= b.close &&
    b.low <= b.open && b.low <= b.close &&
    (b.time + 300) * 1000 <= now
  ).sort((a,b)=>a.time-b.time);
}

async function fetchDukascopyM5(lookbackDays) {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86400000);
  const mod = await import('dukascopy-node');
  const getHistoricalRates = mod.getHistoricalRates || mod.default?.getHistoricalRates;
  if (typeof getHistoricalRates !== 'function') throw new Error('dukascopy-node getHistoricalRates export not found');
  const rows = await getHistoricalRates({
    instrument: 'xauusd',
    dates: { from:start, to:end },
    timeframe:'m5',
    priceType:'bid',
    volumes:true,
    format:'array'
  });
  const bars = normalizeDukascopy(rows);
  if (bars.length < 200000) throw new Error('Insufficient Dukascopy XAUUSD M5 data: ' + bars.length);
  const unique = [];
  let last = -1;
  for (const b of bars) {
    if (b.time === last) continue;
    unique.push(b);
    last = b.time;
  }
  return unique;
}

function contiguous(bars) {
  for (let i=1;i<bars.length;i++) if (bars[i].time-bars[i-1].time !== 300) return false;
  return true;
}

function dataQuality(bars) {
  let invalid=0, gaps=0, weekendGaps=0, positiveVolume=0;
  for (let i=0;i<bars.length;i++) {
    const b=bars[i];
    if (b.volume>0) positiveVolume++;
    if (!(b.high>=b.low && b.high>=b.open && b.high>=b.close && b.low<=b.open && b.low<=b.close && b.close>0)) invalid++;
    if (i>0) {
      const d=bars[i].time-bars[i-1].time;
      if (d>450) { gaps++; const day=new Date(bars[i-1].time*1000).getUTCDay(); if(day===5||day===6) weekendGaps++; }
    }
  }
  return {
    rows:bars.length, invalid_ohlc:invalid, gaps_gt_7_5min:gaps, weekend_gaps:weekendGaps,
    volume_positive_rows:positiveVolume, volume_coverage_pct:bars.length ? positiveVolume/bars.length*100 : 0
  };
}

function recentBars(bars, index, count=80) {
  return bars.slice(Math.max(0,index-count+1),index+1).map((b)=>({
    time:b.time+300, open:b.open, high:b.high, low:b.low, close:b.close, volume:b.volume
  }));
}

function latestCompletedH1Index(h1, signalTime) {
  let lo=0, hi=h1.length-1, best=-1;
  while(lo<=hi) {
    const mid=Math.floor((lo+hi)/2);
    if(h1[mid].time<=signalTime) {best=mid; lo=mid+1;} else hi=mid-1;
  }
  return best;
}

function applyRiskGate(state, equity, timestamp, config) {
  const day = new Date(timestamp*1000).toISOString().slice(0,10);
  if(state.day!==day) { state.day=day; state.dayStartEquity=equity; }
  state.peak=Math.max(state.peak,equity);
  const daily=state.dayStartEquity>0 ? (equity-state.dayStartEquity)/state.dayStartEquity*100 : 0;
  const dd=state.peak>0 ? (state.peak-equity)/state.peak*100 : 0;
  const reasons=[];
  if(daily<=-Math.abs(config.maxDailyLossPct)) reasons.push('daily_loss_limit');
  if(dd>=Math.abs(config.maxDrawdownPct)) reasons.push('drawdown_limit');
  return {allowed:!reasons.length,reasons,daily,dd};
}

function simulateTrade({signalBar,nextBar,futureBars,setup,equity,config}) {
  const spread=config.spreadPrice, slip=config.slippagePrice;
  const side=setup.candidate;
  const entry=side==='BUY' ? nextBar.open+spread+slip : nextBar.open-slip;
  const stop=setup.stop_loss, target=setup.take_profit;
  if(!(entry>0 && stop>0 && target>0)) return null;
  const stopDistance=Math.abs(entry-stop);
  if(!(stopDistance>0) || Math.abs(entry-setup.entry_reference)/Math.max(0.000001, Number(signalBar.atr14))>config.maxEntryGapAtr) return null;
  const riskCash=equity*(config.riskPct/100);
  let exitTime=futureBars[Math.min(futureBars.length-1,config.maxHoldBars-1)]?.time ?? nextBar.time;
  let exitPrice=futureBars[Math.min(futureBars.length-1,config.maxHoldBars-1)]?.close ?? nextBar.close;
  let exitReason='TIME';
  const scan=futureBars.slice(0,config.maxHoldBars);
  for(const bar of scan) {
    const stopHit=side==='BUY' ? bar.low<=stop : bar.high+spread>=stop;
    const targetHit=side==='BUY' ? bar.high>=target : bar.low+spread<=target;
    if(stopHit) {
      exitTime=bar.time;
      exitReason='STOP';
      exitPrice=side==='BUY' ? stop-slip : stop+spread+slip;
      break;
    }
    if(targetHit) {
      exitTime=bar.time;
      exitReason='TARGET';
      exitPrice=side==='BUY' ? target-slip : target+spread+slip;
      break;
    }
  }
  const pnlPrice=side==='BUY' ? exitPrice-entry : entry-exitPrice;
  const netR=pnlPrice/stopDistance;
  const netPnl=riskCash*netR;
  const grossR=side==='BUY' ? (exitPrice+ (side==='BUY'?0:0) - nextBar.open)/stopDistance : (nextBar.open-exitPrice)/stopDistance;
  return {
    signal_time:signalBar.time, entry_time:nextBar.time, exit_time:exitTime, side,
    setup_type:setup.setup_type, entry, stop_loss:stop, take_profit:target,
    risk_cash:riskCash, net_r:netR, net_pnl:netPnl, exit_reason:exitReason,
    holding_minutes:Math.max(0,(exitTime-nextBar.time)/60),
    range_atr:setup.diagnostics?.range_atr ?? null,
    breakout_atr:setup.diagnostics?.breakout_atr ?? null,
    volume_ratio:setup.diagnostics?.volume_ratio ?? null
  };
}

function summarize(trades, initialEquity) {
  let equity=initialEquity, peak=equity, maxDD=0, maxDDPct=0, gp=0, gl=0, holds=0, wins=0, losses=0, stop=0, target=0;
  const bySide={BUY:{trades:0,wins:0,losses:0,netR:0},SELL:{trades:0,wins:0,losses:0,netR:0}};
  const curve=[];
  for(const t of trades) {
    equity+=t.net_pnl; peak=Math.max(peak,equity);
    const dd=peak-equity; maxDD=Math.max(maxDD,dd); maxDDPct=Math.max(maxDDPct,peak>0?dd/peak*100:0);
    if(t.net_pnl>0) {gp+=t.net_pnl;wins++;bySide[t.side].wins++;} else if(t.net_pnl<0) {gl+=-t.net_pnl;losses++;bySide[t.side].losses++;}
    bySide[t.side].trades++; bySide[t.side].netR+=t.net_r; holds+=t.holding_minutes;
    if(t.exit_reason==='STOP')stop++; if(t.exit_reason==='TARGET')target++;
    curve.push({time:t.exit_time,equity});
  }
  for(const side of Object.keys(bySide)) {
    bySide[side].win_rate_pct=bySide[side].trades?bySide[side].wins/bySide[side].trades*100:0;
  }
  const totalR=trades.reduce((s,t)=>s+t.net_r,0);
  const expectancyR=trades.length?totalR/trades.length:0;
  const pf=gl>0?gp/gl:(gp>0?Infinity:0);
  return {
    initial_equity:initialEquity, final_equity:equity, net_profit:equity-initialEquity,
    return_pct:(equity/initialEquity-1)*100, trades:trades.length, wins, losses,
    win_rate_pct:trades.length?wins/trades.length*100:0, profit_factor:pf,
    expectancy_R:expectancyR, total_R:totalR,
    max_drawdown:maxDD, max_drawdown_pct:maxDDPct,
    avg_holding_minutes:trades.length?holds/trades.length:0,
    stop_exits:stop,target_exits:target, by_side:bySide
  };
}

function periodSummary(trades, initialEquity, days) {
  if(!trades.length) return summarize([],initialEquity);
  const end=Math.max(...trades.map(t=>t.exit_time));
  const start=end-days*86400;
  return summarize(trades.filter(t=>t.exit_time>=start),initialEquity);
}

function annualSummary(trades, initialEquity) {
  const map=new Map();
  for(const t of trades) {
    const key=new Date(t.exit_time*1000).toISOString().slice(0,4);
    const row=map.get(key)||{year:key,trades:0,wins:0,losses:0,net_r:0,net_pnl:0};
    row.trades++; if(t.net_pnl>0)row.wins++; else if(t.net_pnl<0)row.losses++; row.net_r+=t.net_r; row.net_pnl+=t.net_pnl; map.set(key,row);
  }
  return [...map.values()].sort((a,b)=>a.year.localeCompare(b.year)).map(r=>({...r,win_rate_pct:r.trades?r.wins/r.trades*100:0}));
}

function toCsv(trades) {
  const headers=['signal_time','entry_time','exit_time','side','setup_type','entry','stop_loss','take_profit','risk_cash','net_r','net_pnl','exit_reason','holding_minutes','range_atr','breakout_atr','volume_ratio'];
  return headers.join(',')+'\n'+trades.map(t=>headers.map(h=>String(t[h]??'')).join(',')).join('\n')+'\n';
}

function score(report) {
  const s=report.summary;
  if(!s.trades) return -Infinity;
  return (s.profit_factor-1)*10 + s.expectancy_R*10 - s.max_drawdown_pct*0.5;
}

async function runOne(rawM5, rawH1, config, strategy) {
  const m5=rawM5, h1=rawH1;
  const m5Ind=addIndicators(m5), h1Ind=addIndicators(h1);
  const latest=m5Ind[m5Ind.length-1].time;
  const start=latest-config.lookbackDays*86400;
  const first=Math.max(250,80);
  let equity=config.initialEquity;
  const trades=[];
  const state={day:null,dayStartEquity:equity,peak:equity};
  const blocks={};
  let nextAvailable=0;
  let candidates=0, rejectedEntryGap=0;
  for(let i=first;i<m5Ind.length-1;i++) {
    const signal=m5Ind[i];
    if(signal.time<start) continue;
    if(i<nextAvailable) continue;
    if(![signal.ema20,signal.ema50,signal.rsi14,signal.atr14].every(Number.isFinite)) continue;
    const signalTime = signal.time + 300;
    const h1i=latestCompletedH1Index(h1Ind,signalTime);
    const h=h1Ind[h1i];
    if(!h || ![h.close,h.ema20,h.ema50,h.ema200,h.rsi14,h.atr14].every(Number.isFinite)) continue;
    const setup=buildGoldV2Setup({
      m5:{ema20:signal.ema20,ema50:signal.ema50,rsi14:signal.rsi14,atr14:signal.atr14},
      h1:{close:h.close,ema20:h.ema20,ema50:h.ema50,ema200:h.ema200,rsi14:h.rsi14,atr14:h.atr14},
      recentM5:recentBars(m5Ind,i,Math.max(80,strategy.rangeLookback+1))
    },strategy);
    if(setup.candidate==='WAIT') continue;
    candidates++;
    const gate=applyRiskGate(state,equity,signalTime,config);
    if(!gate.allowed) { for(const r of gate.reasons) blocks[r]=(blocks[r]||0)+1; continue; }
    const next=m5Ind[i+1];
    if(next.time-signal.time!==300) continue;
    const trade=simulateTrade({signalBar:signal,nextBar:next,futureBars:m5Ind.slice(i+1),setup,equity,config});
    if(!trade) { rejectedEntryGap++; continue; }
    trades.push(trade); equity+=trade.net_pnl;
    const exitIndex=m5Ind.findIndex((b,idx)=>idx>i+1 && b.time>trade.exit_time);
    nextAvailable=exitIndex<0?m5Ind.length:exitIndex;
  }
  return {summary:summarize(trades,config.initialEquity),recent365:periodSummary(trades,config.initialEquity,365),annual:annualSummary(trades,config.initialEquity),trades,candidates,risk_gate_blocks:blocks,rejected_entry_gap:rejectedEntryGap};
}

function parseArgs() {
  const out=new Map();
  for(let i=2;i<process.argv.length;i++) {
    const t=process.argv[i];
    if(!t.startsWith('--')) continue;
    const [k,v]=t.slice(2).split('=');
    out.set(k,v??'true');
  }
  return out;
}

function costScenarios(config) {
  return [
    {name:'baseline',spreadPrice:config.spreadPrice,slippagePrice:config.slippagePrice},
    {name:'conservative',spreadPrice:Math.max(config.spreadPrice,0.75),slippagePrice:Math.max(config.slippagePrice,0.10)}
  ];
}

async function main() {
  const args=parseArgs();
  const lookbackDays=Math.max(365,Number(args.get('lookback-days')||BASE_CONFIG.lookbackDays));
  const end=new Date(), start=new Date(end.getTime()-lookbackDays*86400000);
  const mod=await import('dukascopy-node');
  const getHistoricalRates=mod.getHistoricalRates||mod.default?.getHistoricalRates;
  const rows=await getHistoricalRates({instrument:'xauusd',dates:{from:start,to:end},timeframe:'m5',priceType:'bid',volumes:true,format:'array'});
  const rawM5=normalizeDukascopy(rows);
  if(rawM5.length<200000) throw new Error('Insufficient Dukascopy XAUUSD M5 data: '+rawM5.length);
  const rawH1=aggregateM5ToH1(rawM5,config.serverTimezone);
  const strategy=JSON.parse(process.env.GOLD_STRATEGY_JSON||JSON.stringify(STRATEGY));
  const config={...BASE_CONFIG,lookbackDays};
  const results={};
  for(const cost of costScenarios(config)) {
    const runConfig={...config,...cost};
    const out=await runOne(rawM5,rawH1,runConfig,strategy);
    results[cost.name]=out;
    console.log(cost.name, out.summary);
  }
  const report={
    strategy:'XAUUSD V2 H1 trend + M5 compression/volume breakout (technical core)',
    fundamental_backtest_status:'NOT_RUN',
    fundamental_backtest_note:'AI/web-search environment filtering is intentionally excluded from historical technical performance because point-in-time AI outputs are not available in this price dataset.',
    data_source:{m5:'DUKASCOPY_XAUUSD',h1:'FROM_M5'},
    instrument:'XAUUSD',
    server_timezone:config.serverTimezone,
    source_period:{m5_first:new Date(rawM5[0].time*1000).toISOString(),m5_last:new Date(rawM5[rawM5.length-1].time*1000).toISOString()},
    test_period:{start:start.toISOString(),end:end.toISOString()},
    assumptions:{initial_equity:config.initialEquity,risk_per_trade_pct:config.riskPct,execution:'next M5 bar open',same_bar_conflict:'stop first',max_hold_bars:config.maxHoldBars,entry_model:'bid data + spread/slippage by side'},
    strategy_parameters:strategy,
    data_quality:dataQuality(rawM5),
    cost_scenarios:Object.fromEntries(Object.entries(results).map(([name,r])=>[name,{spread_price:costScenarios(config).find(c=>c.name===name).spreadPrice,slippage_price:costScenarios(config).find(c=>c.name===name).slippagePrice}])),
    results:Object.fromEntries(Object.entries(results).map(([name,r])=>[name,{summary:r.summary,recent365:r.recent365,annual:r.annual,candidates:r.candidates,risk_gate_blocks:r.risk_gate_blocks,rejected_entry_gap:r.rejected_entry_gap}])),
  };
  const outDir=process.env.GOLD_BACKTEST_OUTPUT_DIR||path.resolve(__dirname,'../gold-backtest-output');
  await fs.mkdir(outDir,{recursive:true});
  await fs.writeFile(path.join(outDir,'gold_v2_backtest_report.json'),JSON.stringify(report,null,2));
  for(const [name,r] of Object.entries(results)) await fs.writeFile(path.join(outDir,'gold_v2_trades_'+name+'.csv'),toCsv(r.trades));
  console.log('=== GOLD V2 BACKTEST ===');
  for(const [name,r] of Object.entries(results)) console.log(name, 'trades='+r.summary.trades,'PF='+r.summary.profit_factor,'expectancy_R='+r.summary.expectancy_R,'return='+r.summary.return_pct+'%','maxDD='+r.summary.max_drawdown_pct+'%','recent365_PF='+r.recent365.profit_factor);
}

if(import.meta.url===`file://${process.argv[1]}`) main();
