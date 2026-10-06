#property strict
#property version   "2.0"
#property description "XAUUSD M5/H1 range-breakout-retest EA. Auto orders are disabled by default."

input string SymbolName = "";
input int    SignalTimeframe = PERIOD_M5;
input int    TrendTimeframe = PERIOD_H1;

// --- Entry logic
input int    RangeLookbackBars = 12;
input double MinRangeAtr = 0.60;
input double MaxRangeAtr = 3.20;
input double BreakoutAtr = 0.08;
input double BreakoutBodyAtr = 0.30;
input double BreakoutCloseLocation = 0.60;
input double MaxBreakoutBodyAtr = 1.80;
input int    MaxRetestBars = 6;
input int    MinRetestBars = 1;
input double RetestToleranceAtr = 0.20;
input double MaxPenetrationAtr = 0.20;
input double RetestCloseBufferAtr = 0.05;
input double ConfirmBufferAtr = 0.02;
input double ConfirmBodyAtr = 0.25;
input double MinConfirmCloseLocation = 0.60;
input double MaxConfirmBodyAtr = 1.50;
input double MaxExtensionAtr = 1.80;
input double MinH1Agreement = 0.60;
input double H1BuyRsiMin = 45.0;
input double H1BuyRsiMax = 75.0;
input double H1SellRsiMin = 25.0;
input double H1SellRsiMax = 55.0;

// --- Risk / exit
input double RiskPercent = 0.25;
input double MaxDailyLossPercent = 1.50;
input double MaxAccountDrawdownPercent = 8.00;
input double StopBufferAtr = 0.15;
input double TriggerStopPadAtr = 0.05;
input double MinStopAtr = 0.80;
input double MaxStopAtr = 2.00;
input double TakeProfitR = 2.00;
input int    MaxHoldBars = 96;
input double MaxEntryDistanceAtr = 0.20;

// --- Execution safety
input double MaxSpreadPrice = 0.60;
input int    SlippagePoints = 30;
input int    MaxOpenPositions = 1;
input int    CooldownBars = 2;
input bool   UseSessionFilter = true;
input int    SessionStartJstHour = 21;
input int    SessionStartJstMinute = 0;
input int    SessionEndJstHour = 0;
input int    SessionEndJstMinute = 0;
input bool   AllowAutoOrders = false;
input bool   CloseOnOppositeSignal = false;
input int    MagicNumber = 26100601;
input string OrderComment = "XAUUSD-EA-V1";

datetime g_lastSignalBarOpen = 0;
bool g_sessionWarned = false;

string ProcessedBarKey(string sym)
{
   return "XAUUSD_EA_V1:ProcessedBar:" + IntegerToString(AccountNumber()) + ":" + sym;
}

datetime LastTradeOpenTime(string sym)
{
   datetime latest = 0;

   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;

      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber)
         continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL)
         continue;

      if(OrderOpenTime() > latest)
         latest = OrderOpenTime();
   }

   for(int j = OrdersTotal() - 1; j >= 0; j--)
   {
      if(!OrderSelect(j, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber)
         continue;

      int liveType = OrderType();
      if(liveType != OP_BUY && liveType != OP_SELL)
         continue;

      if(OrderOpenTime() > latest)
         latest = OrderOpenTime();
   }

   return latest;
}

//---------------------------------------------------------
// Symbol / time helpers
//---------------------------------------------------------
string TradeSymbol()
{
   string configured = SymbolName;
   StringTrimLeft(configured);
   StringTrimRight(configured);
   if(StringLen(configured) > 0)
      return configured;
   return Symbol();
}

bool IsGoldSymbol(string sym)
{
   return StringFind(sym, "XAU") >= 0 ||
          StringFind(sym, "xau") >= 0 ||
          StringFind(sym, "GOLD") >= 0 ||
          StringFind(sym, "Gold") >= 0 ||
          StringFind(sym, "gold") >= 0;
}

bool IsNewSignalBar(string sym)
{
   datetime openTime = iTime(sym, SignalTimeframe, 1);
   if(openTime <= 0)
      return false;

   string key = ProcessedBarKey(sym);
   if(GlobalVariableCheck(key))
   {
      datetime persisted = (datetime)GlobalVariableGet(key);
      if(openTime <= persisted)
      {
         g_lastSignalBarOpen = persisted;
         return false;
      }
   }

   if(openTime == g_lastSignalBarOpen)
      return false;

   g_lastSignalBarOpen = openTime;
   GlobalVariableSet(key, (double)openTime);
   return true;
}

bool IsLastSunday(int year, int month, datetime day)
{
   MqlDateTime dt;
   TimeToStruct(day, dt);
   int days = TimeDay(day);
   int dow = TimeDayOfWeek(day);
   return dow == 0 && days >= 25;
}

int LastSundayDay(int year, int month)
{
   int lastDay = 31;
   if(month == 4 || month == 6 || month == 9 || month == 11) lastDay = 30;
   if(month == 2) lastDay = ((year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)) ? 29 : 28;
   for(int d = lastDay; d >= lastDay - 6; d--)
   {
      datetime t = StringToTime(IntegerToString(year) + "." +
                                StringFormat("%02d", month) + "." +
                                StringFormat("%02d", d) + " 00:00");
      if(TimeDayOfWeek(t) == 0)
         return d;
   }
   return lastDay;
}

int XmServerUtcOffsetHours(datetime serverTime)
{
   MqlDateTime dt;
   TimeToStruct(serverTime, dt);
   int year = dt.year;
   int marchSunday = LastSundayDay(year, 3);
   int octoberSunday = LastSundayDay(year, 10);

   datetime dstStart = StringToTime(IntegerToString(year) + ".03." +
                                    StringFormat("%02d", marchSunday) + " 04:00");
   datetime dstEnd = StringToTime(IntegerToString(year) + ".10." +
                                  StringFormat("%02d", octoberSunday) + " 04:00");

   return (serverTime >= dstStart && serverTime < dstEnd) ? 3 : 2;
}

bool InSession(datetime signalBarOpen)
{
   if(!UseSessionFilter)
      return true;

   if(SessionStartJstHour < 0 || SessionStartJstHour > 23 ||
      SessionEndJstHour < 0 || SessionEndJstHour > 23 ||
      SessionStartJstMinute < 0 || SessionStartJstMinute > 59 ||
      SessionEndJstMinute < 0 || SessionEndJstMinute > 59)
      return false;

   int offset = XmServerUtcOffsetHours(signalBarOpen);
   datetime utc = signalBarOpen - offset * 3600;
   datetime jst = utc + 9 * 3600;

   MqlDateTime dt;
   TimeToStruct(jst, dt);
   int currentMinutes = dt.hour * 60 + dt.min;
   int startMinutes = SessionStartJstHour * 60 + SessionStartJstMinute;
   int endMinutes = SessionEndJstHour * 60 + SessionEndJstMinute;

   if(startMinutes == endMinutes)
      return true;

   if(startMinutes < endMinutes)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;

   return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

//---------------------------------------------------------
// Account / risk helpers
//---------------------------------------------------------
string PeakEquityKey(string sym)
{
   return "XAUUSD_EA_V1:PeakEquity:" + IntegerToString(AccountNumber()) + ":" + sym;
}

double PeakEquity(string sym)
{
   double equity = AccountEquity();
   string key = PeakEquityKey(sym);

   if(!GlobalVariableCheck(key))
   {
      GlobalVariableSet(key, equity);
      return equity;
   }

   double peak = GlobalVariableGet(key);
   if(equity > peak)
   {
      peak = equity;
      GlobalVariableSet(key, peak);
   }

   return peak;
}

double DailyRealizedPnl(string sym)
{
   datetime dayStart = StrToTime(TimeToString(TimeCurrent(), TIME_DATE));
   double realized = 0.0;

   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;

      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber)
         continue;

      if(OrderCloseTime() < dayStart)
         continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL)
         continue;

      realized += OrderProfit() + OrderSwap() + OrderCommission();
   }

   return realized;
}

double DailyPnlPercent(string sym)
{
   double balance = AccountBalance();
   double realized = DailyRealizedPnl(sym);
   double dayStartBalance = balance - realized;

   if(dayStartBalance <= 0.0)
      return 0.0;

   return ((AccountEquity() - dayStartBalance) / dayStartBalance) * 100.0;
}

double AccountDrawdownPercent(string sym)
{
   double peak = PeakEquity(sym);
   double equity = AccountEquity();

   if(peak <= 0.0)
      return 0.0;

   return ((peak - equity) / peak) * 100.0;
}

int OpenPositions(string sym)
{
   int count = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber)
         continue;

      int type = OrderType();
      if(type == OP_BUY || type == OP_SELL)
         count++;
   }

   return count;
}

bool IsTradingRiskAllowed(string sym)
{
   if(MaxDailyLossPercent > 0.0 && DailyPnlPercent(sym) <= -MathAbs(MaxDailyLossPercent))
   {
      Print("XAUUSD EA: daily loss limit reached. daily_pnl_pct=",
            DoubleToString(DailyPnlPercent(sym), 2));
      return false;
   }

   if(MaxAccountDrawdownPercent > 0.0 && AccountDrawdownPercent(sym) >= MathAbs(MaxAccountDrawdownPercent))
   {
      Print("XAUUSD EA: account drawdown limit reached. dd_pct=",
            DoubleToString(AccountDrawdownPercent(sym), 2));
      return false;
   }

   return true;
}

//---------------------------------------------------------
// Market data helpers
//---------------------------------------------------------
bool HistoryReady(string sym)
{
   if(!SymbolSelect(sym, true))
   {
      Print("XAUUSD EA: SymbolSelect failed. symbol=", sym,
            " error=", GetLastError());
      return false;
   }

   int signalBars = iBars(sym, SignalTimeframe);
   int trendBars = iBars(sym, TrendTimeframe);

   if(signalBars < 300 || trendBars < 300)
   {
      Print("XAUUSD EA: insufficient history. signalBars=", signalBars,
            " trendBars=", trendBars);
      return false;
   }

   return iTime(sym, SignalTimeframe, 1) > 0 &&
          iTime(sym, TrendTimeframe, 1) > 0;
}

bool ValidOhlc(string sym, int timeframe, int shift)
{
   double o = iOpen(sym, timeframe, shift);
   double h = iHigh(sym, timeframe, shift);
   double l = iLow(sym, timeframe, shift);
   double c = iClose(sym, timeframe, shift);

   return o > 0.0 &&
          h >= l &&
          h >= o &&
          h >= c &&
          l <= o &&
          l <= c;
}

double AverageVolume(string sym, int timeframe, int startShift, int count)
{
   if(count <= 0)
      return 0.0;

   double sum = 0.0;
   int used = 0;

   for(int shift = startShift; shift < startShift + count; shift++)
   {
      long v = iVolume(sym, timeframe, shift);
      if(v >= 0)
      {
         sum += (double)v;
         used++;
      }
   }

   return used > 0 ? sum / used : 0.0;
}

double HighestHigh(string sym, int timeframe, int startShift, int count)
{
   double high = -DBL_MAX;

   for(int shift = startShift; shift < startShift + count; shift++)
      high = MathMax(high, iHigh(sym, timeframe, shift));

   return high;
}

double LowestLow(string sym, int timeframe, int startShift, int count)
{
   double low = DBL_MAX;

   for(int shift = startShift; shift < startShift + count; shift++)
      low = MathMin(low, iLow(sym, timeframe, shift));

   return low;
}

//---------------------------------------------------------
// Trade calculations
//---------------------------------------------------------
double NormalizePrice(string sym, double price)
{
   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   return NormalizeDouble(price, digits);
}

double NormalizeLot(string sym, double lots)
{
   double minLot = MarketInfo(sym, MODE_MINLOT);
   double maxLot = MarketInfo(sym, MODE_MAXLOT);
   double step = MarketInfo(sym, MODE_LOTSTEP);

   if(step <= 0.0)
      return 0.0;

   lots = MathMax(minLot, MathMin(maxLot, lots));

   double steps = MathFloor((lots - minLot + 1e-12) / step);
   double normalized = minLot + steps * step;

   if(normalized < minLot)
      normalized = minLot;
   if(normalized > maxLot)
      normalized = maxLot;

   int lotDigits = 2;
   if(step >= 1.0) lotDigits = 0;
   else if(step >= 0.1) lotDigits = 1;
   else if(step < 0.01) lotDigits = 3;

   if(normalized < minLot - 1e-12)
      return 0.0;

   return NormalizeDouble(normalized, lotDigits);
}

double RiskPerLot(string sym, double entry, double stop)
{
   double tickSize = MarketInfo(sym, MODE_TICKSIZE);
   double tickValue = MarketInfo(sym, MODE_TICKVALUE);

   if(tickSize <= 0.0 || tickValue <= 0.0)
      return 0.0;

   double ticks = MathAbs(entry - stop) / tickSize;
   return ticks * tickValue;
}

double CalculateLots(string sym, double entry, double stop)
{
   if(RiskPercent <= 0.0)
      return 0.0;

   double moneyRisk = AccountEquity() * (RiskPercent / 100.0);
   double riskPerLot = RiskPerLot(sym, entry, stop);

   if(moneyRisk <= 0.0 || riskPerLot <= 0.0)
      return 0.0;

   double rawLots = moneyRisk / riskPerLot;
   double minLot = MarketInfo(sym, MODE_MINLOT);
   if(rawLots < minLot - 1e-12)
      return 0.0;

   return NormalizeLot(sym, rawLots);
}

bool StopsMeetBrokerRules(string sym, int type, double entry, double stop, double target)
{
   double point = MarketInfo(sym, MODE_POINT);
   double stopLevel = MarketInfo(sym, MODE_STOPLEVEL) * point;
   double freezeLevel = MarketInfo(sym, MODE_FREEZELEVEL) * point;
   double required = MathMax(stopLevel, freezeLevel);

   if(point <= 0.0)
      return false;

   if(type == OP_BUY)
      return entry - stop > required && target - entry > required;

   if(type == OP_SELL)
      return stop - entry > required && entry - target > required;

   return false;
}

bool PriceDriftAllowed(string sym, double signalClose, double atr)
{
   if(MaxEntryDistanceAtr <= 0.0)
      return true;

   RefreshRates();

   double current = MarketInfo(sym, MODE_BID);
   if(current <= 0.0 || atr <= 0.0)
      return false;

   return MathAbs(current - signalClose) <= MaxEntryDistanceAtr * atr;
}

bool CooldownAllowed()
{
   if(CooldownBars <= 0)
      return true;

   string sym = TradeSymbol();
   datetime lastTradeOpen = LastTradeOpenTime(sym);
   if(lastTradeOpen <= 0)
      return true;

   int lastShift = iBarShift(sym, SignalTimeframe, lastTradeOpen, false);
   int currentShift = iBarShift(sym, SignalTimeframe, iTime(sym, SignalTimeframe, 1), false);

   if(lastShift < 0 || currentShift < 0)
      return true;

   return (lastShift - currentShift) >= CooldownBars + 1;
}

//---------------------------------------------------------
// Signal engine
//---------------------------------------------------------
int H1SlopeAgreement(string sym, int direction)
{
   int good = 0;
   int total = 0;

   for(int shift = 1; shift < 6; shift++)
   {
      double currentClose = iClose(sym, TrendTimeframe, shift);
      double previousClose = iClose(sym, TrendTimeframe, shift + 1);
      if(currentClose <= 0.0 || previousClose <= 0.0)
         continue;

      total++;
      double delta = currentClose - previousClose;
      if((direction == 1 && delta > 0.0) ||
         (direction == -1 && delta < 0.0))
         good++;
   }

   if(total <= 0)
      return 0;

   return (int)MathRound((double)good / (double)total * 100.0);
}

bool RetestOhlcValid(string sym, int shift)
{
   if(shift < 1)
      return false;

   double o = iOpen(sym, SignalTimeframe, shift);
   double h = iHigh(sym, SignalTimeframe, shift);
   double l = iLow(sym, SignalTimeframe, shift);
   double c = iClose(sym, SignalTimeframe, shift);

   return o > 0.0 && h >= l && h >= o && h >= c && l <= o && l <= c;
}

int GetSignal(string sym, double &entry, double &stop, double &target, double &atr, string &reason)
{
   entry = 0.0;
   stop = 0.0;
   target = 0.0;
   atr = 0.0;
   reason = "";

   if(!HistoryReady(sym))
   {
      reason = "history_not_ready";
      return -1;
   }

   datetime signalOpen = iTime(sym, SignalTimeframe, 1);
   if(signalOpen <= 0)
   {
      reason = "signal_bar_missing";
      return -1;
   }

   if(UseSessionFilter && !InSession(signalOpen))
   {
      reason = "outside_session";
      return 0;
   }

   double m5Atr = iATR(sym, SignalTimeframe, 14, 1);
   double h1Close = iClose(sym, TrendTimeframe, 1);
   double h1Ema20 = iMA(sym, TrendTimeframe, 20, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Ema50 = iMA(sym, TrendTimeframe, 50, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Ema200 = iMA(sym, TrendTimeframe, 200, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Rsi = iRSI(sym, TrendTimeframe, 14, PRICE_CLOSE, 1);
   double m5Ema20 = iMA(sym, SignalTimeframe, 20, 0, MODE_EMA, PRICE_CLOSE, 1);
   double m5Ema50 = iMA(sym, SignalTimeframe, 50, 0, MODE_EMA, PRICE_CLOSE, 1);

   if(m5Atr <= 0.0 || h1Close <= 0.0 || h1Ema20 <= 0.0 ||
      h1Ema50 <= 0.0 || h1Ema200 <= 0.0 || m5Ema20 <= 0.0 ||
      m5Ema50 <= 0.0 || h1Rsi < 0.0 || h1Rsi > 100.0)
   {
      reason = "indicator_not_ready";
      return -1;
   }

   int upAgreement = H1SlopeAgreement(sym, 1);
   int downAgreement = H1SlopeAgreement(sym, -1);

   bool trendUp =
      h1Close > h1Ema20 &&
      h1Ema20 > h1Ema50 &&
      h1Ema50 > h1Ema200 &&
      h1Rsi >= H1BuyRsiMin &&
      h1Rsi <= H1BuyRsiMax &&
      upAgreement >= (int)MathRound(MinH1Agreement * 100.0);

   bool trendDown =
      h1Close < h1Ema20 &&
      h1Ema20 < h1Ema50 &&
      h1Ema50 < h1Ema200 &&
      h1Rsi >= H1SellRsiMin &&
      h1Rsi <= H1SellRsiMax &&
      downAgreement >= (int)MathRound(MinH1Agreement * 100.0);

   if(!trendUp && !trendDown)
   {
      reason = "h1_trend_filter";
      return 0;
   }

   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);
   double spread = ask - bid;

   if(bid <= 0.0 || ask <= 0.0 || ask < bid)
   {
      reason = "price_not_ready";
      return -1;
   }

   if(spread > MaxSpreadPrice)
   {
      reason = "spread_filter";
      return 0;
   }

   const int confirmationShift = 1;
   const int retestShift = 2;

   if(!RetestOhlcValid(sym, confirmationShift) ||
      !RetestOhlcValid(sym, retestShift))
   {
      reason = "invalid_retest_sequence";
      return 0;
   }

   double retestHigh = iHigh(sym, SignalTimeframe, retestShift);
   double retestLow = iLow(sym, SignalTimeframe, retestShift);
   double retestClose = iClose(sym, SignalTimeframe, retestShift);

   if(retestHigh <= 0.0 || retestLow <= 0.0 || retestClose <= 0.0)
   {
      reason = "retest_data_missing";
      return 0;
   }

   double confirmationOpen = iOpen(sym, SignalTimeframe, confirmationShift);
   double confirmationHigh = iHigh(sym, SignalTimeframe, confirmationShift);
   double confirmationLow = iLow(sym, SignalTimeframe, confirmationShift);
   double confirmationClose = iClose(sym, SignalTimeframe, confirmationShift);

   double confirmationRange = confirmationHigh - confirmationLow;
   double confirmationBodyAtr = MathAbs(confirmationClose - confirmationOpen) / m5Atr;
   if(confirmationRange <= 0.0 ||
      confirmationBodyAtr < ConfirmBodyAtr ||
      confirmationBodyAtr > MaxConfirmBodyAtr)
   {
      reason = "confirmation_body_filter";
      return 0;
   }

   double confirmationCloseLocation =
      (confirmationClose - confirmationLow) / confirmationRange;

   for(int breakoutShift = MinRetestBars + 2;
       breakoutShift <= MaxRetestBars + 2;
       breakoutShift++)
   {
      int oldestNeeded = breakoutShift + RangeLookbackBars;

      if(iBars(sym, SignalTimeframe) <= oldestNeeded + 2)
         continue;

      double rangeHigh = HighestHigh(sym, SignalTimeframe, breakoutShift + 1, RangeLookbackBars);
      double rangeLow = LowestLow(sym, SignalTimeframe, breakoutShift + 1, RangeLookbackBars);
      double rangeWidth = rangeHigh - rangeLow;

      if(!(rangeWidth > 0.0))
         continue;

      double rangeAtr = rangeWidth / m5Atr;
      if(rangeAtr < MinRangeAtr || rangeAtr > MaxRangeAtr)
         continue;

      double breakoutOpen = iOpen(sym, SignalTimeframe, breakoutShift);
      double breakoutHigh = iHigh(sym, SignalTimeframe, breakoutShift);
      double breakoutLow = iLow(sym, SignalTimeframe, breakoutShift);
      double breakoutClose = iClose(sym, SignalTimeframe, breakoutShift);
      double breakoutRange = breakoutHigh - breakoutLow;

      if(!(breakoutRange > 0.0 && breakoutOpen > 0.0 &&
           breakoutClose > 0.0))
         continue;

      double breakoutBodyAtr = MathAbs(breakoutClose - breakoutOpen) / m5Atr;
      if(breakoutBodyAtr < BreakoutBodyAtr ||
         breakoutBodyAtr > MaxBreakoutBodyAtr)
         continue;

      double breakoutCloseLocation =
         (breakoutClose - breakoutLow) / breakoutRange;

      bool buyBreak =
         trendUp &&
         breakoutClose > breakoutOpen &&
         breakoutClose >= rangeHigh + BreakoutAtr * m5Atr &&
         breakoutCloseLocation >= BreakoutCloseLocation;

      bool sellBreak =
         trendDown &&
         breakoutClose < breakoutOpen &&
         breakoutClose <= rangeLow - BreakoutAtr * m5Atr &&
         breakoutCloseLocation <= 1.0 - BreakoutCloseLocation;

      if(!buyBreak && !sellBreak)
         continue;

      int type = buyBreak ? OP_BUY : OP_SELL;
      double level = buyBreak ? rangeHigh : rangeLow;

      bool retestTouch = buyBreak
         ? retestLow <= level + RetestToleranceAtr * m5Atr &&
           retestLow >= level - MaxPenetrationAtr * m5Atr &&
           retestClose >= level - RetestCloseBufferAtr * m5Atr
         : retestHigh >= level - RetestToleranceAtr * m5Atr &&
           retestHigh <= level + MaxPenetrationAtr * m5Atr &&
           retestClose <= level + RetestCloseBufferAtr * m5Atr;

      if(!retestTouch)
         continue;

      bool confirmOk = buyBreak
         ? confirmationClose >
              MathMax(level, retestHigh) + ConfirmBufferAtr * m5Atr &&
           confirmationClose > confirmationOpen &&
           confirmationCloseLocation >= MinConfirmCloseLocation
         : confirmationClose <
              MathMin(level, retestLow) - ConfirmBufferAtr * m5Atr &&
           confirmationClose < confirmationOpen &&
           confirmationCloseLocation <= 1.0 - MinConfirmCloseLocation;

      if(!confirmOk)
         continue;

      double extension = buyBreak
         ? (confirmationClose - m5Ema20) / m5Atr
         : (m5Ema20 - confirmationClose) / m5Atr;

      if(extension < -0.50 || extension > MaxExtensionAtr)
         continue;

      entry = type == OP_BUY ? ask : bid;
      stop = type == OP_BUY
         ? retestLow - StopBufferAtr * m5Atr
         : retestHigh + StopBufferAtr * m5Atr;

      double stopDistance = MathAbs(entry - stop);
      double stopAtr = stopDistance / m5Atr;

      if(stopAtr < MinStopAtr || stopAtr > MaxStopAtr)
         continue;

      target = type == OP_BUY
         ? entry + TakeProfitR * stopDistance
         : entry - TakeProfitR * stopDistance;

      if(!StopsMeetBrokerRules(sym, type, entry, stop, target))
         continue;

      if(!PriceDriftAllowed(sym, confirmationClose, m5Atr))
      {
         reason = "entry_drift_filter";
         return 0;
      }

      atr = m5Atr;
      reason = buyBreak ? "BUY_break_retest_confirmed" : "SELL_break_retest_confirmed";
      return type == OP_BUY ? 1 : 2;
   }

   reason = "no_valid_break_retest";
   return 0;
}

//---------------------------------------------------------
// Order execution
//---------------------------------------------------------
bool CloseOppositePositions(string sym, int signalType)
{
   if(!CloseOnOppositeSignal)
      return true;

   bool ok = true;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber)
         continue;

      int type = OrderType();
      if((signalType == OP_BUY && type != OP_SELL) ||
         (signalType == OP_SELL && type != OP_BUY))
         continue;

      RefreshRates();

      double closePrice = type == OP_BUY
         ? MarketInfo(sym, MODE_BID)
         : MarketInfo(sym, MODE_ASK);

      ResetLastError();
      if(!OrderClose(OrderTicket(), OrderLots(), closePrice, SlippagePoints, clrNONE))
      {
         int errorCode = GetLastError();
         Print("XAUUSD EA: failed to close opposite order. ticket=",
               OrderTicket(), " error=", errorCode);
         ok = false;
      }
   }

   return ok;
}

bool ExecuteSignal(string sym, int signalType, double entry, double stop, double target, datetime signalBar)
{
   if(!AllowAutoOrders)
   {
      Print("XAUUSD EA: break-retest signal detected but auto orders are OFF. type=",
            signalType == OP_BUY ? "BUY" : "SELL",
            " entry=", DoubleToString(entry, (int)MarketInfo(sym, MODE_DIGITS)),
            " sl=", DoubleToString(stop, (int)MarketInfo(sym, MODE_DIGITS)),
            " tp=", DoubleToString(target, (int)MarketInfo(sym, MODE_DIGITS)));
      return true;
   }

   if(OpenPositions(sym) >= MathMax(1, MaxOpenPositions))
   {
      Print("XAUUSD EA: max open positions reached.");
      return false;
   }

   RefreshRates();
   double liveBid = MarketInfo(sym, MODE_BID);
   double liveAsk = MarketInfo(sym, MODE_ASK);
   if(liveBid <= 0.0 || liveAsk <= 0.0 || liveAsk < liveBid)
      return false;
   if((liveAsk - liveBid) > MaxSpreadPrice)
   {
      Print("XAUUSD EA: execution spread widened above limit. spread=",
            DoubleToString(liveAsk - liveBid, (int)MarketInfo(sym, MODE_DIGITS)));
      return false;
   }

   if(!IsTradeAllowed())
   {
      Print("XAUUSD EA: terminal/broker trade permission is not available.");
      return false;
   }

   if((int)MarketInfo(sym, MODE_TRADEALLOWED) == 0)
   {
      Print("XAUUSD EA: symbol trade permission is not available.");
      return false;
   }

   if(!IsTradingRiskAllowed(sym))
      return false;

   if(!CloseOppositePositions(sym, signalType))
      return false;

   double lots = CalculateLots(sym, entry, stop);
   if(lots <= 0.0)
   {
      Print("XAUUSD EA: lot calculation failed.");
      return false;
   }

   double freeMargin = AccountFreeMarginCheck(sym, signalType, lots);
   if(freeMargin <= 0.0)
   {
      Print("XAUUSD EA: insufficient free margin for lots=",
            DoubleToString(lots, 2));
      return false;
   }

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double sendPrice = signalType == OP_BUY
      ? MarketInfo(sym, MODE_ASK)
      : MarketInfo(sym, MODE_BID);

   sendPrice = NormalizePrice(sym, sendPrice);
   stop = NormalizePrice(sym, stop);
   target = NormalizePrice(sym, target);

   if(!StopsMeetBrokerRules(sym, signalType, sendPrice, stop, target))
   {
      Print("XAUUSD EA: broker stop/freeze rules failed again at execution time.");
      return false;
   }

   ResetLastError();

   int ticket = OrderSend(
      sym,
      signalType,
      lots,
      sendPrice,
      SlippagePoints,
      stop,
      target,
      OrderComment,
      MagicNumber,
      0,
      clrNONE
   );

   int errorCode = GetLastError();

   if(ticket < 0)
   {
      Print("XAUUSD EA: OrderSend failed. error=", errorCode,
            " lots=", DoubleToString(lots, 2),
            " price=", DoubleToString(sendPrice, digits),
            " sl=", DoubleToString(stop, digits),
            " tp=", DoubleToString(target, digits));
      return false;
   }

   Print("XAUUSD EA: order opened. ticket=", ticket,
         " type=", signalType == OP_BUY ? "BUY" : "SELL",
         " lots=", DoubleToString(lots, 2),
         " price=", DoubleToString(sendPrice, digits));

   return true;
}

//---------------------------------------------------------
// Monitoring
//---------------------------------------------------------
void Evaluate()
{
   string sym = TradeSymbol();

   if(!IsGoldSymbol(sym))
      return;

   if(!HistoryReady(sym))
      return;

   if(!IsNewSignalBar(sym))
      return;

   if(OpenPositions(sym) >= MathMax(1, MaxOpenPositions))
      return;

   if(!IsTradingRiskAllowed(sym))
      return;

   if(!CooldownAllowed())
      return;

   double entry = 0.0;
   double stop = 0.0;
   double target = 0.0;
   double atr = 0.0;
   string reason = "";

   int signalType = GetSignal(sym, entry, stop, target, atr, reason);

   Print("XAUUSD EA: bar=", TimeToString(iTime(sym, SignalTimeframe, 1), TIME_DATE|TIME_MINUTES),
         " signal=", signalType == 1 ? "BUY" : signalType == 2 ? "SELL" : signalType == 0 ? "WAIT" : "ERROR",
         " reason=", reason);

   if(signalType != OP_BUY && signalType != OP_SELL)
      return;

   datetime signalBar = iTime(sym, SignalTimeframe, 1);

   if(ExecuteSignal(sym, signalType, entry, stop, target, signalBar))
      return;
}

//---------------------------------------------------------
// EA lifecycle
//---------------------------------------------------------
int OnInit()
{
   string sym = TradeSymbol();

   Print("XAUUSD Trend Breakout EA V1.0 starting. symbol=", sym,
         " signalTF=", SignalTimeframe,
         " trendTF=", TrendTimeframe,
         " riskPct=", DoubleToString(RiskPercent, 3),
         " maxSpread=", DoubleToString(MaxSpreadPrice, 2),
         " session_jst=21:00-00:00", 
         " autoOrders=", AllowAutoOrders ? "ON" : "OFF");

   if(!IsGoldSymbol(sym))
   {
      Print("XAUUSD EA: chart symbol is not recognized as gold: ", sym);
      return INIT_FAILED;
   }

   if(SignalTimeframe != PERIOD_M5 || TrendTimeframe != PERIOD_H1)
   {
      Print("XAUUSD EA: V1 is intentionally fixed to M5 signal + H1 trend. Use M5 chart.");
      return INIT_FAILED;
   }

   if(RiskPercent <= 0.0 || RiskPercent > 2.0)
   {
      Print("XAUUSD EA: RiskPercent must be >0 and <=2. Current=",
            DoubleToString(RiskPercent, 3));
      return INIT_FAILED;
   }

   if(TakeProfitR < 1.0)
   {
      Print("XAUUSD EA: TakeProfitR must be >= 1.0.");
      return INIT_FAILED;
   }

   if(MaxOpenPositions < 1)
      return INIT_FAILED;

   if(!SymbolSelect(sym, true))
      return INIT_FAILED;

   PeakEquity(sym);
   string processedKey = ProcessedBarKey(sym);
   if(GlobalVariableCheck(processedKey))
      g_lastSignalBarOpen = (datetime)GlobalVariableGet(processedKey);

   Print("XAUUSD EA: initialized. Attach to the broker's XAUUSD/GOLD M5 chart. processed_bar=",
         TimeToString(g_lastSignalBarOpen, TIME_DATE|TIME_MINUTES));
   return INIT_SUCCEEDED;
}

void OnTick()
{
   Evaluate();
}
