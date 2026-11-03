#property strict
#property version   "1.00"
#property description "GOLD H4_H1PR_01 UTC-aligned virtual forward monitor. No order execution APIs."

// Research-only forward monitor for the frozen H4_H1PR_01 hypothesis.
// It reconstructs UTC H1/H4 bars from completed XM M5 BID bars.
// This EA records hypothetical entries/exits only. It contains no order API.

input string ExpectedSymbol = "GOLD#";
input int    MaxM5HistoryBars = 90000;
input int    MinH4Bars = 1000;
input int    MinH1Bars = 1000;
input int    MaxEntryDelaySeconds = 30;
input bool   RequireDemoAccount = true;
input bool   EnableEventCsv = true;
input string EventCsvName = "GOLD_H4_H1PR01_ForwardEvents.csv";

#define M5_SECONDS 300
#define H1_SECONDS 3600
#define H4_SECONDS 14400
#define EMPTY_DBL 1.0e100

struct UtcBar
{
   datetime time_utc;
   double open;
   double high;
   double low;
   double close;
};

UtcBar g_h1[];
UtcBar g_h4[];
double g_h1Ema20[];
double g_h1Atr14[];
double g_h1Rsi14[];
double g_h4Ema50[];
double g_h4Ema200[];

int g_log = INVALID_HANDLE;
bool g_virtualActive = false;
int g_virtualSide = 0;

double g_entry = 0.0;
double g_stop = 0.0;
double g_target = 0.0;
double g_risk = 0.0;
double g_entryAtr = 0.0;
double g_entrySpread = 0.0;
datetime g_signalTimeUtc = 0;
datetime g_entryTimeUtc = 0;
datetime g_entryHourUtc = 0;
datetime g_lastProcessedSignalUtc = 0;
datetime g_lastSeenHourUtc = 0;
datetime g_lastAttemptHourUtc = 0;
string g_prefix = "";
bool g_offsetGuardBlocked = false;
int g_lastM5HistoryCount = 0;
int g_lastM5UsedCount = 0;
int g_lastH1BuiltCount = 0;
int g_lastH4BuiltCount = 0;
string g_lastHistoryFailure = "NOT_CHECKED";

string SideName(int side)
{
   if(side > 0) return "BUY";
   if(side < 0) return "SELL";
   return "NONE";
}

string DateText(datetime t)
{
   if(t <= 0) return "";
   return TimeToString(t, TIME_DATE | TIME_SECONDS);
}

string NumberText(double v, int digits)
{
   if(v == EMPTY_DBL || !MathIsValidNumber(v)) return "";
   return DoubleToString(v, digits);
}

string Key(string suffix)
{
   return g_prefix + suffix;
}

void SavePersistentState()
{
   GlobalVariableSet(Key("ACTIVE"), g_virtualActive ? 1.0 : 0.0);
   GlobalVariableSet(Key("SIDE"), (double)g_virtualSide);
   GlobalVariableSet(Key("ENTRY"), g_entry);
   GlobalVariableSet(Key("STOP"), g_stop);
   GlobalVariableSet(Key("TARGET"), g_target);
   GlobalVariableSet(Key("RISK"), g_risk);
   GlobalVariableSet(Key("ATR"), g_entryAtr);
   GlobalVariableSet(Key("SPREAD"), g_entrySpread);
   GlobalVariableSet(Key("SIGNAL_UTC"), (double)g_signalTimeUtc);
   GlobalVariableSet(Key("ENTRY_UTC"), (double)g_entryTimeUtc);
   GlobalVariableSet(Key("ENTRY_HOUR"), (double)g_entryHourUtc);
   GlobalVariableSet(Key("LAST_SIGNAL"), (double)g_lastProcessedSignalUtc);
   GlobalVariableSet(Key("LAST_SEEN_HR"), (double)g_lastSeenHourUtc);
}

bool LoadPersistentState()
{
   if(!GlobalVariableCheck(Key("ACTIVE"))) return false;
   g_virtualActive = (GlobalVariableGet(Key("ACTIVE")) > 0.5);
   if(GlobalVariableCheck(Key("LAST_SIGNAL"))) g_lastProcessedSignalUtc = (datetime)GlobalVariableGet(Key("LAST_SIGNAL"));
   if(GlobalVariableCheck(Key("LAST_SEEN_HR"))) g_lastSeenHourUtc = (datetime)GlobalVariableGet(Key("LAST_SEEN_HR"));
   if(!g_virtualActive) return true;

   string required[10];
   required[0]="SIDE"; required[1]="ENTRY"; required[2]="STOP"; required[3]="TARGET";
   required[4]="RISK"; required[5]="ATR"; required[6]="SPREAD";
   required[7]="SIGNAL_UTC"; required[8]="ENTRY_UTC"; required[9]="ENTRY_HOUR";
   for(int i=0;i<ArraySize(required);i++)
   {
      if(!GlobalVariableCheck(Key(required[i])))
      {
         g_virtualActive = false;
         Print("H4H1PR01: incomplete persisted virtual position; cleared to avoid a fabricated recovery.");
         GlobalVariableSet(Key("ACTIVE"), 0.0);
         return false;
      }
   }
   g_virtualSide = (int)GlobalVariableGet(Key("SIDE"));
   g_entry = GlobalVariableGet(Key("ENTRY"));
   g_stop = GlobalVariableGet(Key("STOP"));
   g_target = GlobalVariableGet(Key("TARGET"));
   g_risk = GlobalVariableGet(Key("RISK"));
   g_entryAtr = GlobalVariableGet(Key("ATR"));
   g_entrySpread = GlobalVariableGet(Key("SPREAD"));
   g_signalTimeUtc = (datetime)GlobalVariableGet(Key("SIGNAL_UTC"));
   g_entryTimeUtc = (datetime)GlobalVariableGet(Key("ENTRY_UTC"));
   g_entryHourUtc = (datetime)GlobalVariableGet(Key("ENTRY_HOUR"));
   if((g_virtualSide != 1 && g_virtualSide != -1) || g_entry <= 0 || g_risk <= 0 || g_stop <= 0 || g_target <= 0)
   {
      g_virtualActive = false;
      GlobalVariableSet(Key("ACTIVE"), 0.0);
      Print("H4H1PR01: persisted virtual position failed validation; cleared.");
      return false;
   }
   return true;
}

datetime FirstOfMonth(int year, int month)
{
   return StrToTime(StringFormat("%04d.%02d.01 00:00", year, month));
}

datetime LastSundayOfMonth(int year, int month)
{
   int nextYear = year;
   int nextMonth = month + 1;
   if(nextMonth > 12) { nextMonth = 1; nextYear++; }
   datetime firstNext = FirstOfMonth(nextYear, nextMonth);
   datetime lastDay = firstNext - 86400;
   return lastDay - TimeDayOfWeek(lastDay) * 86400;
}

bool SameDate(datetime a, datetime b)
{
   return TimeYear(a)==TimeYear(b) && TimeMonth(a)==TimeMonth(b) && TimeDay(a)==TimeDay(b);
}

// XM server history is expected to use UTC+2 winter / UTC+3 summer.
// EU DST is assumed. The repeated autumn 03:00 server hour is excluded.
bool ServerTimeToUtc(datetime serverTime, datetime &utcTime)
{
   int year = TimeYear(serverTime);
   datetime marchSunday = LastSundayOfMonth(year, 3);
   datetime octoberSunday = LastSundayOfMonth(year, 10);
   int hourValue = TimeHour(serverTime);
   int offsetSeconds = 7200;

   if(SameDate(serverTime, marchSunday))
   {
      if(hourValue == 3) return false;
      offsetSeconds = (hourValue >= 4 ? 10800 : 7200);
   }
   else if(SameDate(serverTime, octoberSunday))
   {
      if(hourValue == 3) return false;
      offsetSeconds = (hourValue < 3 ? 10800 : 7200);
   }
   else if(serverTime > marchSunday && serverTime < octoberSunday)
   {
      offsetSeconds = 10800;
   }
   else
   {
      offsetSeconds = 7200;
   }

   utcTime = serverTime - offsetSeconds;
   return true;
}

bool CurrentOffsetMatchesSchedule()
{
   datetime serverNow = TimeCurrent();
   datetime gmtNow = TimeGMT();
   if(serverNow <= 0 || gmtNow <= 0) return false;
   datetime ignoredUtc = 0;
   if(!ServerTimeToUtc(serverNow, ignoredUtc)) return false;
   int expected = (int)(serverNow - ignoredUtc);
   int actual = (int)(serverNow - gmtNow);
   return (MathAbs(actual - expected) <= 120);
}

void LogRow(string eventName, string reason, int side,
            datetime signalUtc, datetime h4Utc,
            double signalClose, double hourOpenPrice,
            double entryPrice, double stopPrice, double targetPrice,
            double riskPrice, double atrPrice, double gapPrice,
            double h1Rsi, double h1Ema20, double h4Close,
            double h4Ema50, double h4Ema200,
            double eventPrice, double quoteBasedR, int holdingHours, int entryDelaySeconds)
{
   if(g_log == INVALID_HANDLE) return;
   datetime serverNow = TimeCurrent();
   datetime gmtNow = TimeGMT();
   int offset = (int)(serverNow - gmtNow);
   double spread = Ask - Bid;
   FileWrite(g_log,
      eventName, reason, DateText(gmtNow), DateText(serverNow), offset,
      Symbol(), "H4_H1PR_01", SideName(side), DateText(signalUtc), DateText(h4Utc),
      NumberText(signalClose, Digits), NumberText(hourOpenPrice, Digits),
      NumberText(entryPrice, Digits), NumberText(stopPrice, Digits),
      NumberText(targetPrice, Digits), NumberText(riskPrice, Digits),
      NumberText(atrPrice, Digits), NumberText(gapPrice, Digits),
      NumberText(h1Rsi, 2), NumberText(h1Ema20, Digits),
      NumberText(h4Close, Digits), NumberText(h4Ema50, Digits), NumberText(h4Ema200, Digits),
      DoubleToString(Bid, Digits), DoubleToString(Ask, Digits),
      DoubleToString(spread, Digits), NumberText(eventPrice, Digits),
      NumberText(quoteBasedR, 4), holdingHours, entryDelaySeconds);
   FileFlush(g_log);
}

bool OpenEventLog()
{
   if(!EnableEventCsv) return true;
   g_log = FileOpen(EventCsvName, FILE_CSV | FILE_READ | FILE_WRITE | FILE_SHARE_READ, ',');
   if(g_log == INVALID_HANDLE)
   {
      Print("H4H1PR01: cannot open event log; error=", GetLastError());
      return false;
   }
   bool fresh = (FileSize(g_log) == 0);
   FileSeek(g_log, 0, SEEK_END);
   if(fresh)
   {
      FileWrite(g_log,
         "event","reason","gmt_time","server_time","server_minus_gmt_seconds",
         "symbol","candidate","side","signal_h1_open_utc","h4_filter_bar_open_utc",
         "signal_close_bid","next_h1_open_bid","virtual_entry_price","virtual_stop",
         "virtual_target","initial_risk_price","signal_atr14","entry_gap_price",
         "signal_rsi14","signal_ema20","h4_close","h4_ema50","h4_ema200",
         "bid_now","ask_now","spread_now","event_price","quote_based_R_pre_fee",
         "holding_hours","entry_delay_seconds");
      FileFlush(g_log);
   }
   return true;
}

bool PushCompletedBar(UtcBar &outBars[], datetime bucket, datetime firstUtc, datetime lastUtc,
                      int count, int expectedCount, bool sequenceValid,
                      double o, double h, double l, double c)
{
   if(!sequenceValid || count != expectedCount) return false;
   if(firstUtc != bucket || lastUtc != bucket + (expectedCount-1)*M5_SECONDS) return false;
   int n = ArraySize(outBars);
   if(ArrayResize(outBars, n+1) != n+1) return false;
   outBars[n].time_utc = bucket;
   outBars[n].open = o;
   outBars[n].high = h;
   outBars[n].low = l;
   outBars[n].close = c;
   return true;
}

bool BuildUtcBars(int periodSeconds, int expectedM5Bars, UtcBar &outBars[])
{
   ArrayResize(outBars, 0);
   int total = iBars(Symbol(), PERIOD_M5);
   g_lastM5HistoryCount = total;
   if(total < expectedM5Bars + 1)
   {
      g_lastHistoryFailure = StringFormat("M5_HISTORY_TOO_SHORT_FOR_%d_MINUTES", periodSeconds/60);
      if(periodSeconds==H1_SECONDS) g_lastH1BuiltCount=0;
      if(periodSeconds==H4_SECONDS) g_lastH4BuiltCount=0;
      return false;
   }
   int limit = (int)MathMin(total-1, MaxM5HistoryBars);
   g_lastM5UsedCount = limit;

   bool active = false;
   bool sequenceValid = true;
   datetime bucket = 0, firstUtc = 0, lastUtc = 0;
   int count = 0;
   double o = 0, h = 0, l = 0, c = 0;

   for(int shift=limit; shift>=1; shift--)
   {
      datetime serverTime = iTime(Symbol(), PERIOD_M5, shift);
      datetime utcTime = 0;
      if(serverTime <= 0 || !ServerTimeToUtc(serverTime, utcTime) || utcTime % M5_SECONDS != 0)
      {
         if(active) PushCompletedBar(outBars,bucket,firstUtc,lastUtc,count,expectedM5Bars,sequenceValid,o,h,l,c);
         active = false;
         continue;
      }
      double barOpen = iOpen(Symbol(), PERIOD_M5, shift);
      double barHigh = iHigh(Symbol(), PERIOD_M5, shift);
      double barLow = iLow(Symbol(), PERIOD_M5, shift);
      double barClose = iClose(Symbol(), PERIOD_M5, shift);
      if(barOpen <= 0 || barHigh <= 0 || barLow <= 0 || barClose <= 0 || barHigh < barLow)
      {
         if(active) PushCompletedBar(outBars,bucket,firstUtc,lastUtc,count,expectedM5Bars,sequenceValid,o,h,l,c);
         active = false;
         continue;
      }
      datetime nextBucket = utcTime - (utcTime % periodSeconds);
      if(!active || nextBucket != bucket)
      {
         if(active) PushCompletedBar(outBars,bucket,firstUtc,lastUtc,count,expectedM5Bars,sequenceValid,o,h,l,c);
         active = true;
         bucket = nextBucket;
         firstUtc = utcTime;
         lastUtc = utcTime;
         count = 1;
         sequenceValid = (utcTime == bucket);
         o = barOpen; h = barHigh; l = barLow; c = barClose;
      }
      else
      {
         if(utcTime != lastUtc + M5_SECONDS) sequenceValid = false;
         lastUtc = utcTime;
         count++;
         if(barHigh > h) h = barHigh;
         if(barLow < l) l = barLow;
         c = barClose;
      }
   }
   if(active) PushCompletedBar(outBars,bucket,firstUtc,lastUtc,count,expectedM5Bars,sequenceValid,o,h,l,c);
   int builtCount = ArraySize(outBars);
   if(periodSeconds==H1_SECONDS) g_lastH1BuiltCount=builtCount;
   if(periodSeconds==H4_SECONDS) g_lastH4BuiltCount=builtCount;
   if(builtCount<=0)
      g_lastHistoryFailure = StringFormat("NO_COMPLETE_UTC_%d_MINUTE_BARS", periodSeconds/60);
   return (builtCount > 0);
}

bool BuildEMA(UtcBar &bars[], int period, double &out[])
{
   int n = ArraySize(bars);
   if(n <= 0) return false;
   ArrayResize(out,n);
   double alpha = 2.0 / (period + 1.0);
   out[0] = bars[0].close;
   for(int i=1;i<n;i++) out[i] = alpha*bars[i].close + (1.0-alpha)*out[i-1];
   return true;
}

bool BuildATR(UtcBar &bars[], int period, double &out[])
{
   int n = ArraySize(bars);
   ArrayResize(out,n);
   for(int i=0;i<n;i++) out[i] = EMPTY_DBL;
   if(n <= period) return false;
   double sum = 0;
   for(int i=1;i<=period;i++)
   {
      double tr = MathMax(bars[i].high-bars[i].low,
                   MathMax(MathAbs(bars[i].high-bars[i-1].close), MathAbs(bars[i].low-bars[i-1].close)));
      sum += tr;
   }
   double value = sum / period;
   out[period] = value;
   for(int j=period+1;j<n;j++)
   {
      double trj = MathMax(bars[j].high-bars[j].low,
                    MathMax(MathAbs(bars[j].high-bars[j-1].close), MathAbs(bars[j].low-bars[j-1].close)));
      value = (value*(period-1)+trj)/period;
      out[j] = value;
   }
   return true;
}

bool BuildRSI(UtcBar &bars[], int period, double &out[])
{
   int n = ArraySize(bars);
   ArrayResize(out,n);
   for(int i=0;i<n;i++) out[i] = EMPTY_DBL;
   if(n <= period) return false;
   double avgGain=0, avgLoss=0;
   for(int i=1;i<=period;i++)
   {
      double change = bars[i].close-bars[i-1].close;
      if(change>0) avgGain += change;
      else avgLoss -= change;
   }
   avgGain /= period;
   avgLoss /= period;
   out[period] = (avgLoss==0 ? 100.0 : 100.0-100.0/(1.0+avgGain/avgLoss));
   for(int j=period+1;j<n;j++)
   {
      double change = bars[j].close-bars[j-1].close;
      double gain = MathMax(change,0.0);
      double loss = MathMax(-change,0.0);
      avgGain = (avgGain*(period-1)+gain)/period;
      avgLoss = (avgLoss*(period-1)+loss)/period;
      out[j] = (avgLoss==0 ? 100.0 : 100.0-100.0/(1.0+avgGain/avgLoss));
   }
   return true;
}

bool RebuildHistory()
{
   g_lastM5HistoryCount = 0;
   g_lastM5UsedCount = 0;
   g_lastH1BuiltCount = 0;
   g_lastH4BuiltCount = 0;
   g_lastHistoryFailure = "UNKNOWN_HISTORY_BUILD_FAILURE";

   if(!BuildUtcBars(H1_SECONDS,12,g_h1))
   {
      if(g_lastHistoryFailure=="UNKNOWN_HISTORY_BUILD_FAILURE")
         g_lastHistoryFailure="H1_UTC_AGGREGATION_FAILED";
      return false;
   }
   if(!BuildUtcBars(H4_SECONDS,48,g_h4))
   {
      if(g_lastHistoryFailure=="UNKNOWN_HISTORY_BUILD_FAILURE")
         g_lastHistoryFailure="H4_UTC_AGGREGATION_FAILED";
      return false;
   }
   if(g_lastH1BuiltCount < MinH1Bars)
   {
      g_lastHistoryFailure="H1_COMPLETE_BAR_COUNT_BELOW_MINIMUM";
      return false;
   }
   if(g_lastH4BuiltCount < MinH4Bars)
   {
      g_lastHistoryFailure="H4_COMPLETE_BAR_COUNT_BELOW_MINIMUM";
      return false;
   }
   if(!BuildEMA(g_h1,20,g_h1Ema20) || !BuildATR(g_h1,14,g_h1Atr14) || !BuildRSI(g_h1,14,g_h1Rsi14))
   {
      g_lastHistoryFailure="H1_INDICATOR_BUILD_FAILED";
      return false;
   }
   if(!BuildEMA(g_h4,50,g_h4Ema50) || !BuildEMA(g_h4,200,g_h4Ema200))
   {
      g_lastHistoryFailure="H4_INDICATOR_BUILD_FAILED";
      return false;
   }
   g_lastHistoryFailure="OK";
   return true;
}

string HistoryDiagnosticText()
{
   return StringFormat("%s;M5_TOTAL=%d;M5_USED=%d;H1=%d/%d;H4=%d/%d;MAX_M5=%d",
      g_lastHistoryFailure,g_lastM5HistoryCount,g_lastM5UsedCount,
      g_lastH1BuiltCount,MinH1Bars,g_lastH4BuiltCount,MinH4Bars,MaxM5HistoryBars);
}

int LatestH4IndexAtOrBefore(datetime signalCloseUtc)
{
   for(int i=ArraySize(g_h4)-1;i>=0;i--)
      if(g_h4[i].time_utc + H4_SECONDS <= signalCloseUtc) return i;
   return -1;
}

bool GetM5OpenAtUtc(datetime wantedUtc, double &price)
{
   int total = iBars(Symbol(), PERIOD_M5);
   int limit = (int)MathMin(total, 30);
   for(int shift=0;shift<limit;shift++)
   {
      datetime serverTime = iTime(Symbol(), PERIOD_M5, shift);
      datetime utcTime = 0;
      if(serverTime<=0 || !ServerTimeToUtc(serverTime,utcTime)) continue;
      if(utcTime == wantedUtc)
      {
         price = iOpen(Symbol(), PERIOD_M5, shift);
         return (price > 0);
      }
   }
   return false;
}

void MarkSignalProcessed(datetime signalUtc)
{
   g_lastProcessedSignalUtc = signalUtc;
   GlobalVariableSet(Key("LAST_SIGNAL"),(double)g_lastProcessedSignalUtc);
}

void ResetVirtualPosition()
{
   g_virtualActive = false;
   g_virtualSide = 0;
   g_entry = 0; g_stop = 0; g_target = 0; g_risk = 0;
   g_entryAtr = 0; g_entrySpread = 0;
   g_signalTimeUtc = 0; g_entryTimeUtc = 0; g_entryHourUtc = 0;
   GlobalVariableSet(Key("ACTIVE"),0.0);
}

void CloseVirtualPosition(string reason, double exitPrice, datetime nowUtc, int elapsedHours)
{
   if(!g_virtualActive || g_risk<=0) return;
   double resultR = (g_virtualSide>0 ? (exitPrice-g_entry)/g_risk : (g_entry-exitPrice)/g_risk);
   LogRow("VIRTUAL_EXIT",reason,g_virtualSide,g_signalTimeUtc,0,
          EMPTY_DBL,EMPTY_DBL,g_entry,g_stop,g_target,g_risk,g_entryAtr,
          EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
          exitPrice,resultR,elapsedHours,0);
   int closedSide = g_virtualSide;
   ResetVirtualPosition();
   SavePersistentState();
   Print("H4H1PR01 virtual exit: ",reason," ",SideName(closedSide)," R=",DoubleToString(resultR,3));
}

void ManageVirtualPosition(datetime nowUtc, bool dataGap)
{
   if(!g_virtualActive) return;
   double exitPrice = EMPTY_DBL;
   string reason = "";
   if(g_virtualSide>0)
   {
      if(Bid <= g_stop) { exitPrice=Bid; reason="STOP"; }
      else if(Bid >= g_target) { exitPrice=Bid; reason="TARGET"; }
   }
   else
   {
      if(Ask >= g_stop) { exitPrice=Ask; reason="STOP"; }
      else if(Ask <= g_target) { exitPrice=Ask; reason="TARGET"; }
   }
   int elapsedHours = (int)MathMax(0,(nowUtc-g_entryHourUtc)/H1_SECONDS);
   if(reason=="" && dataGap) { exitPrice=(g_virtualSide>0 ? Bid : Ask); reason="DATA_GAP_EXIT"; }
   if(reason=="" && elapsedHours>=24) { exitPrice=(g_virtualSide>0 ? Bid : Ask); reason="TIME_EXIT_24H"; }
   if(reason!="") CloseVirtualPosition(reason,exitPrice,nowUtc,elapsedHours);
}

void LogSkip(string reason, datetime signalUtc, datetime h4Utc,
              double signalClose, double hourOpen, double atr, double gap,
              double rsiValue, double ema20, double h4Close, double ema50, double ema200,
              int trendSide, int delaySeconds)
{
   LogRow("SIGNAL_CHECK",reason,trendSide,signalUtc,h4Utc,signalClose,hourOpen,
          EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,atr,gap,rsiValue,ema20,
          h4Close,ema50,ema200,EMPTY_DBL,EMPTY_DBL,0,delaySeconds);
}

void ProcessLatestCompletedH1(datetime nowUtc, datetime currentHourUtc)
{
   if(!RebuildHistory())
   {
      LogRow("MONITOR_BLOCKED",HistoryDiagnosticText(),0,0,0,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,0,0);
      return;
   }
   int i = ArraySize(g_h1)-1;
   if(i < 20) return;
   datetime signalUtc = g_h1[i].time_utc;
   if(signalUtc <= g_lastProcessedSignalUtc) return;
   MarkSignalProcessed(signalUtc);

   datetime signalCloseUtc = signalUtc + H1_SECONDS;
   int delaySeconds = (int)(nowUtc-currentHourUtc);
   double openBid = EMPTY_DBL;
   if(currentHourUtc != signalCloseUtc)
   {
      LogSkip("NONCONSECUTIVE_OR_MISSED_H1_OPEN",signalUtc,0,g_h1[i].close,
              EMPTY_DBL,g_h1Atr14[i],EMPTY_DBL,g_h1Rsi14[i],g_h1Ema20[i],
              EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,0,delaySeconds);
      return;
   }
   if(delaySeconds < 0 || delaySeconds > MaxEntryDelaySeconds)
   {
      LogSkip("ENTRY_DELAY_EXCEEDED",signalUtc,0,g_h1[i].close,EMPTY_DBL,
              g_h1Atr14[i],EMPTY_DBL,g_h1Rsi14[i],g_h1Ema20[i],
              EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,0,delaySeconds);
      return;
   }
   if(!GetM5OpenAtUtc(currentHourUtc,openBid))
   {
      LogSkip("NEXT_H1_OPEN_M5_BAR_NOT_FOUND",signalUtc,0,g_h1[i].close,
              EMPTY_DBL,g_h1Atr14[i],EMPTY_DBL,g_h1Rsi14[i],g_h1Ema20[i],
              EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,0,delaySeconds);
      return;
   }

   double atrSignal = g_h1Atr14[i];
   double atrPrevious = g_h1Atr14[i-1];
   double emaPrevious = g_h1Ema20[i-1];
   double emaCurrent = g_h1Ema20[i];
   double rsiCurrent = g_h1Rsi14[i];
   double signalClose = g_h1[i].close;
   double highLowRange = g_h1[i].high-g_h1[i].low;
   if(atrSignal<=0 || atrPrevious<=0 || highLowRange<=0 || emaPrevious==EMPTY_DBL || emaCurrent==EMPTY_DBL || rsiCurrent==EMPTY_DBL)
   {
      LogSkip("INDICATOR_NOT_READY",signalUtc,0,signalClose,openBid,atrSignal,EMPTY_DBL,
              rsiCurrent,emaCurrent,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,0,delaySeconds);
      return;
   }

   int h4Index = LatestH4IndexAtOrBefore(signalCloseUtc);
   if(h4Index<0 || g_h4Ema200[h4Index]==EMPTY_DBL)
   {
      LogSkip("NO_COMPLETED_UTC_H4_FILTER_BAR",signalUtc,0,signalClose,openBid,
              atrSignal,EMPTY_DBL,rsiCurrent,emaCurrent,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,0,delaySeconds);
      return;
   }
   double h4Close = g_h4[h4Index].close;
   double h4Ema50 = g_h4Ema50[h4Index];
   double h4Ema200 = g_h4Ema200[h4Index];
   datetime h4Utc = g_h4[h4Index].time_utc;
   int trendSide = 0;
   if(h4Close>h4Ema50 && h4Ema50>h4Ema200) trendSide=1;
   else if(h4Close<h4Ema50 && h4Ema50<h4Ema200) trendSide=-1;

   double closeLocation = (g_h1[i].close-g_h1[i].low)/highLowRange;
   bool touchLong = (MathAbs(g_h1[i-1].low-emaPrevious) <= 0.15*atrPrevious);
   bool touchShort = (MathAbs(g_h1[i-1].high-emaPrevious) <= 0.15*atrPrevious);
   bool longSignal = trendSide==1 && touchLong &&
                     g_h1[i].close>g_h1[i-1].high && g_h1[i].close>emaCurrent &&
                     g_h1[i].close>g_h1[i].open && closeLocation>=0.60 &&
                     rsiCurrent>=48.0 && rsiCurrent<=70.0;
   bool shortSignal = trendSide==-1 && touchShort &&
                      g_h1[i].close<g_h1[i-1].low && g_h1[i].close<emaCurrent &&
                      g_h1[i].close<g_h1[i].open && closeLocation<=0.40 &&
                      rsiCurrent>=30.0 && rsiCurrent<=52.0;
   int side = (longSignal ? 1 : (shortSignal ? -1 : 0));
   if(side==0)
   {
      LogSkip("NO_FROZEN_H1_TRIGGER",signalUtc,h4Utc,signalClose,openBid,atrSignal,
              EMPTY_DBL,rsiCurrent,emaCurrent,h4Close,h4Ema50,h4Ema200,trendSide,delaySeconds);
      return;
   }
   if(g_virtualActive)
   {
      LogSkip("VIRTUAL_POSITION_ALREADY_OPEN",signalUtc,h4Utc,signalClose,openBid,atrSignal,
              EMPTY_DBL,rsiCurrent,emaCurrent,h4Close,h4Ema50,h4Ema200,side,delaySeconds);
      return;
   }

   double gap = MathAbs(openBid-signalClose);
   if(gap > 0.75*atrSignal)
   {
      LogSkip("ENTRY_GAP_OVER_0_75_ATR",signalUtc,h4Utc,signalClose,openBid,atrSignal,
              gap,rsiCurrent,emaCurrent,h4Close,h4Ema50,h4Ema200,side,delaySeconds);
      return;
   }

   double spreadNow = Ask-Bid;
   double entryPrice = (side>0 ? Ask : Bid);
   double priorExtreme = (side>0 ? g_h1[i-1].low : g_h1[i-1].high);
   for(int j=i-2;j>=i-3;j--)
   {
      if(side>0) priorExtreme = MathMin(priorExtreme,g_h1[j].low);
      else priorExtreme = MathMax(priorExtreme,g_h1[j].high);
   }
   double stopPrice = (side>0 ? priorExtreme-0.10*atrSignal : priorExtreme+spreadNow+0.10*atrSignal);
   double riskPrice = (side>0 ? entryPrice-stopPrice : stopPrice-entryPrice);
   double riskAtr = riskPrice/atrSignal;
   if(riskPrice<=0 || riskAtr<0.60 || riskAtr>2.80)
   {
      LogSkip("INITIAL_RISK_OUTSIDE_0_60_TO_2_80_ATR",signalUtc,h4Utc,signalClose,
              openBid,atrSignal,gap,rsiCurrent,emaCurrent,h4Close,h4Ema50,h4Ema200,
              side,delaySeconds);
      return;
   }
   double targetPrice = (side>0 ? entryPrice+2.0*riskPrice : entryPrice-2.0*riskPrice);

   g_virtualActive = true;
   g_virtualSide = side;
   g_entry = entryPrice;
   g_stop = stopPrice;
   g_target = targetPrice;
   g_risk = riskPrice;
   g_entryAtr = atrSignal;
   g_entrySpread = spreadNow;
   g_signalTimeUtc = signalUtc;
   g_entryTimeUtc = nowUtc;
   g_entryHourUtc = currentHourUtc;
   SavePersistentState();
   LogRow("VIRTUAL_ENTRY","FROZEN_RULES_PASSED",side,signalUtc,h4Utc,
          signalClose,openBid,entryPrice,stopPrice,targetPrice,riskPrice,atrSignal,
          gap,rsiCurrent,emaCurrent,h4Close,h4Ema50,h4Ema200,entryPrice,
          EMPTY_DBL,0,delaySeconds);
   Print("H4H1PR01 virtual entry: ",SideName(side)," entry=",DoubleToString(entryPrice,Digits),
         " SL=",DoubleToString(stopPrice,Digits)," TP=",DoubleToString(targetPrice,Digits),
         " spread=",DoubleToString(spreadNow,Digits),". No order was sent.");
}

int OnInit()
{
   if(Symbol()!=ExpectedSymbol)
   {
      Print("H4H1PR01 refused to start: chart symbol must exactly match ",ExpectedSymbol,"; current=",Symbol());
      return INIT_FAILED;
   }
   if(RequireDemoAccount && AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("H4H1PR01 refused to start: attach this research monitor to an XM DEMO account only.");
      return INIT_FAILED;
   }
   g_prefix = "H4H1PR01_"+IntegerToString(AccountNumber())+"_"+Symbol()+"_";
   if(!OpenEventLog()) return INIT_FAILED;
   // TimeCurrent() can be stale while markets are closed. Start safely in a
   // blocked state and resume only after a fresh chart tick confirms the offset.
   g_offsetGuardBlocked = !CurrentOffsetMatchesSchedule();
   if(g_offsetGuardBlocked)
      LogRow("MONITOR_BLOCKED","WAITING_FOR_FRESH_SERVER_UTC_OFFSET_CONFIRMATION",0,0,0,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,0,0);
   LoadPersistentState();

   datetime nowUtc=TimeGMT();
   datetime hourUtc=nowUtc-(nowUtc%H1_SECONDS);
   if(g_lastSeenHourUtc<=0) g_lastSeenHourUtc=hourUtc;
   if(!RebuildHistory())
   {
      LogRow("MONITOR_START",HistoryDiagnosticText(),0,0,0,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,0,0);
      Print("H4H1PR01 history diagnostic: ",HistoryDiagnosticText());
   }
   else if(g_lastProcessedSignalUtc<=0)
   {
      // Do not backfill old historical entries when the monitor is first attached.
      g_lastProcessedSignalUtc=g_h1[ArraySize(g_h1)-1].time_utc;
   }
   SavePersistentState();
   LogRow("MONITOR_START","NO_ORDER_VIRTUAL_MONITOR_ONLY",0,0,0,
          EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
          EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
          EMPTY_DBL,EMPTY_DBL,0,0);
   Print("H4H1PR01 started. UTC-aligned bars are built from completed M5 BID candles. Virtual entries only; no trading functions are present.");
   return INIT_SUCCEEDED;
}

void OnTick()
{
   if(g_log==INVALID_HANDLE && EnableEventCsv) return;
   if(!CurrentOffsetMatchesSchedule())
   {
      if(!g_offsetGuardBlocked)
      {
         LogRow("MONITOR_BLOCKED","SERVER_UTC_OFFSET_SCHEDULE_MISMATCH",0,0,0,
                EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
                EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
                EMPTY_DBL,EMPTY_DBL,0,0);
         g_offsetGuardBlocked=true;
      }
      return;
   }
   bool offsetWasBlocked = g_offsetGuardBlocked;
   g_offsetGuardBlocked=false;
   if(offsetWasBlocked)
      LogRow("MONITOR_RESUMED","FRESH_SERVER_UTC_OFFSET_CONFIRMED",0,0,0,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,0,0);
   if(Bid<=0 || Ask<=Bid) return;
   datetime nowUtc=TimeGMT();
   datetime currentHourUtc=nowUtc-(nowUtc%H1_SECONDS);
   bool dataGap=false;
   if(g_lastSeenHourUtc<=0) g_lastSeenHourUtc=currentHourUtc;
   else if(currentHourUtc>g_lastSeenHourUtc)
   {
      dataGap=((currentHourUtc-g_lastSeenHourUtc)>3*H1_SECONDS);
      g_lastSeenHourUtc=currentHourUtc;
      GlobalVariableSet(Key("LAST_SEEN_HR"),(double)g_lastSeenHourUtc);
   }
   ManageVirtualPosition(nowUtc,dataGap);

   if(iBars(Symbol(),PERIOD_M5)>0)
   {
      datetime expectedSignal = currentHourUtc-H1_SECONDS;
      if(expectedSignal>g_lastProcessedSignalUtc && currentHourUtc!=g_lastAttemptHourUtc)
      {
         g_lastAttemptHourUtc = currentHourUtc;
         ProcessLatestCompletedH1(nowUtc,currentHourUtc);
      }
   }
}

void OnDeinit(const int reason)
{
   SavePersistentState();
   if(g_log!=INVALID_HANDLE)
   {
      LogRow("MONITOR_STOP","VIRTUAL_STATE_PERSISTED",0,0,0,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,EMPTY_DBL,
             EMPTY_DBL,EMPTY_DBL,0,0);
      FileFlush(g_log);
      FileClose(g_log);
      g_log=INVALID_HANDLE;
   }
   Print("H4H1PR01 stopped. Virtual state persisted. No orders were sent.");
}
