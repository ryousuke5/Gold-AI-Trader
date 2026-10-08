// Safety telemetry gate revision: validated server-side safety fields before execution is enabled.
#property strict
#property version   "1.4"
#property description "EURUSD M15 deterministic monitor V1. AI disabled. No order execution."

input string ApiBaseUrl = "https://gold-ai-trader-1.onrender.com";
input string ApiKey = "CHANGE_ME";
input string SymbolName = "";
input bool   EnableSignalRequests = true;
input int    TimerSeconds = 5;
input int    RequestTimeoutMs = 65000;
input int    RetrySeconds = 30;
input int    MaxRetryMinutes = 12;
input int    MagicNumber = 26100301;

datetime g_lastClosedM15Open = 0;
datetime g_lastAttemptAt = 0;
datetime g_retryExpiredBarOpen = 0;
bool g_apiConfigReady = false;

//---------------------------------------------------------
// String helpers
//---------------------------------------------------------
string TrimText(string value)
{
   value = StringTrimLeft(value);
   value = StringTrimRight(value);
   return value;
}

string TradeSymbol()
{
   string configured = TrimText(SymbolName);
   if(StringLen(configured) > 0)
      return configured;

   return Symbol();
}

bool IsEurUsdSymbol(string sym)
{
   if(StringFind(sym, "EURUSD") >= 0) return true;
   if(StringFind(sym, "eurusd") >= 0) return true;
   if(StringFind(sym, "EurUsd") >= 0) return true;
   return false;
}

string NormalizeBaseUrl()
{
   string base = TrimText(ApiBaseUrl);
   while(StringLen(base) > 0 && StringSubstr(base, StringLen(base) - 1, 1) == "/")
      base = StringSubstr(base, 0, StringLen(base) - 1);
   return base;
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

string JsonNumber(double value, int digits)
{
   return DoubleToString(value, digits);
}

bool IsValidApiConfiguration()
{
   string base = NormalizeBaseUrl();
   bool urlOk = (StringFind(base, "https://") == 0);
   bool keyOk = (StringLen(TrimText(ApiKey)) >= 16 && TrimText(ApiKey) != "CHANGE_ME");

   Print("EURUSDAIMonitorV13V12: config check url_ok=",
         (urlOk ? "true" : "false"),
         " key_ok=",
         (keyOk ? "true" : "false"),
         " timeout_ms=",
         RequestTimeoutMs);

   if(!urlOk)
   {
      Print("EURUSDAIMonitorV13: ApiBaseUrl must start with https://");
      return false;
   }

   if(!keyOk)
   {
      Print("EURUSDAIMonitorV13: ApiKey is not configured or is too short.");
      return false;
   }

   if(RequestTimeoutMs < 1000)
   {
      Print("EURUSDAIMonitorV13: RequestTimeoutMs must be >= 1000.");
      return false;
   }

   if(TimerSeconds < 1)
   {
      Print("EURUSDAIMonitorV13: TimerSeconds must be >= 1.");
      return false;
   }

   if(RetrySeconds < 5)
   {
      Print("EURUSDAIMonitorV13: RetrySeconds must be >= 5.");
      return false;
   }

   if(MaxRetryMinutes < 1)
   {
      Print("EURUSDAIMonitorV13: MaxRetryMinutes must be >= 1.");
      return false;
   }

   return true;
}

//---------------------------------------------------------
// Market helpers
//---------------------------------------------------------
bool SymbolReady(string sym)
{
   if(!SymbolSelect(sym, true))
   {
      Print("EURUSDAIMonitorV13: SymbolSelect failed for ", sym,
            " error=", GetLastError());
      return false;
   }

   int m15Bars = iBars(sym, PERIOD_M15);
   int h1Bars = iBars(sym, PERIOD_H1);

   if(m15Bars < 300 || h1Bars < 300)
   {
      Print("EURUSDAIMonitorV13: insufficient history. M15=", m15Bars,
            " H1=", h1Bars);
      return false;
   }

   datetime m15Open = iTime(sym, PERIOD_M15, 1);
   datetime h1Open = iTime(sym, PERIOD_H1, 1);

   if(m15Open <= 0 || h1Open <= 0)
   {
      Print("EURUSDAIMonitorV13: price history is not ready.");
      return false;
   }

   return true;
}

int OpenPositions(string sym)
{
   int count = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderSymbol() != sym)
         continue;

      if(OrderMagicNumber() != MagicNumber)
         continue;

      int type = OrderType();
      if(type == OP_BUY || type == OP_SELL)
         count++;
   }

   return count;
}

double DailyRealizedPnl(string sym)
{
   datetime dayStart = StrToTime(TimeToString(TimeCurrent(), TIME_DATE));
   double realized = 0.0;

   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;

      if(OrderSymbol() != sym)
         continue;

      if(OrderMagicNumber() != MagicNumber)
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

double PeakEquity(string sym)
{
   string key = "EURUSDAIMonitorV13:PeakEquity:" +
                IntegerToString(AccountNumber()) + ":" + sym;
   double equity = AccountEquity();

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

string RecentM15Json(string sym, int digits)
{
   string out = "[";
   bool first = true;

   for(int shift = 80; shift >= 1; shift--)
   {
      datetime openTime = iTime(sym, PERIOD_M15, shift);
      if(openTime <= 0)
         continue;

      datetime closeTime = openTime + 900;
      double open = iOpen(sym, PERIOD_M15, shift);
      double high = iHigh(sym, PERIOD_M15, shift);
      double low = iLow(sym, PERIOD_M15, shift);
      double close = iClose(sym, PERIOD_M15, shift);
      long volume = iVolume(sym, PERIOD_M15, shift);

      if(!(open > 0.0 && high >= low && high >= open && high >= close && low <= open && low <= close))
         continue;

      if(!first)
         out += ",";
      first = false;

      out += "{";
      out += "\"time\":" + IntegerToString((int)closeTime) + ",";
      out += "\"open\":" + JsonNumber(open, digits) + ",";
      out += "\"high\":" + JsonNumber(high, digits) + ",";
      out += "\"low\":" + JsonNumber(low, digits) + ",";
      out += "\"close\":" + JsonNumber(close, digits) + ",";
      out += "\"volume\":" + DoubleToString((double)volume, 0);
      out += "}";
   }

   out += "]";
   return out;
}

string RecentH1Json(string sym, int digits)
{
   string out = "[";
   bool first = true;

   for(int shift = 80; shift >= 1; shift--)
   {
      datetime openTime = iTime(sym, PERIOD_H1, shift);
      if(openTime <= 0)
         continue;

      datetime closeTime = openTime + 3600;
      double open = iOpen(sym, PERIOD_H1, shift);
      double high = iHigh(sym, PERIOD_H1, shift);
      double low = iLow(sym, PERIOD_H1, shift);
      double close = iClose(sym, PERIOD_H1, shift);
      long volume = iVolume(sym, PERIOD_H1, shift);

      if(!(open > 0.0 && high >= low && high >= open && high >= close && low <= open && low <= close))
         continue;

      if(!first)
         out += ",";
      first = false;

      out += "{";
      out += "\"time\":" + IntegerToString((int)closeTime) + ",";
      out += "\"open\":" + JsonNumber(open, digits) + ",";
      out += "\"high\":" + JsonNumber(high, digits) + ",";
      out += "\"low\":" + JsonNumber(low, digits) + ",";
      out += "\"close\":" + JsonNumber(close, digits) + ",";
      out += "\"volume\":" + DoubleToString((double)volume, 0);
      out += "}";
   }

   out += "]";
   return out;
}

// --------------------------------------------------------
// Safety telemetry
// --------------------------------------------------------
int OldestOpenPositionAgeSeconds(string sym)
{
   datetime oldest = 0;
   datetime now = TimeCurrent();

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber)
         continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL)
         continue;

      datetime openTime = OrderOpenTime();
      if(openTime <= 0)
         continue;

      if(oldest == 0 || openTime < oldest)
         oldest = openTime;
   }

   if(oldest <= 0)
      return 0;

   return MathMax(0, (int)(now - oldest));
}

bool WeekendGapMetrics(string sym, double &gapPrice, double &gapAtr, bool &known, datetime &fridayCloseTime, datetime &mondayOpenTime)
{
   gapPrice = 0.0;
   gapAtr = 0.0;
   known = false;
   fridayCloseTime = 0;
   mondayOpenTime = 0;

   datetime latestOpen = iTime(sym, PERIOD_M15, 1);
   if(latestOpen <= 0)
      return false;

   if(TimeDayOfWeek(latestOpen) != 1)
      return true;

   int mondayYear = TimeYear(latestOpen);
   int mondayMonth = TimeMonth(latestOpen);
   int mondayDay = TimeDay(latestOpen);

   int firstMondayShift = -1;
   int maxScan = MathMin(600, iBars(sym, PERIOD_M15) - 1);

   for(int shift = maxScan; shift >= 1; shift--)
   {
      datetime t = iTime(sym, PERIOD_M15, shift);
      if(t <= 0)
         continue;

      if(TimeDayOfWeek(t) != 1)
         continue;

      if(TimeYear(t) == mondayYear &&
         TimeMonth(t) == mondayMonth &&
         TimeDay(t) == mondayDay)
      {
         firstMondayShift = shift;
         break;
      }
   }

   if(firstMondayShift < 1)
      return true;

   mondayOpenTime = iTime(sym, PERIOD_M15, firstMondayShift);
   double mondayOpenPrice = iOpen(sym, PERIOD_M15, firstMondayShift);
   if(!(mondayOpenTime > 0 && mondayOpenPrice > 0.0))
      return true;

   int fridayShift = -1;
   for(int shift = firstMondayShift + 1; shift <= maxScan; shift++)
   {
      datetime t = iTime(sym, PERIOD_M15, shift);
      if(t <= 0 || t >= mondayOpenTime)
         continue;

      if(TimeDayOfWeek(t) == 5)
      {
         fridayShift = shift;
         break;
      }
   }

   if(fridayShift < 0)
      return true;

   fridayCloseTime = iTime(sym, PERIOD_M15, fridayShift) + 900;
   double fridayClose = iClose(sym, PERIOD_M15, fridayShift);
   double atr = iATR(sym, PERIOD_M15, 14, 1);

   if(!(fridayClose > 0.0 && atr > 0.0))
      return true;

   gapPrice = MathAbs(mondayOpenPrice - fridayClose);
   gapAtr = gapPrice / atr;
   known = true;
   return true;
}

//---------------------------------------------------------
// Build EURUSD M15 signal payload
//---------------------------------------------------------
bool BuildSignalPayload(string &payload, datetime &closedBarOpen, datetime &closedBarTime)
{
   string sym = TradeSymbol();

   if(!SymbolReady(sym))
      return false;

   RefreshRates();

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);
   double spread = ask - bid;

   if(!(digits >= 3 && digits <= 6) || !(point > 0.0) || !(bid > 0.0) || !(ask > 0.0) || ask < bid)
   {
      Print("EURUSDAIMonitorV13: invalid market snapshot.");
      return false;
   }

   closedBarOpen = iTime(sym, PERIOD_M15, 1);
   if(closedBarOpen <= 0)
      return false;

   closedBarTime = closedBarOpen + 900;

   double m15Ema20 = iMA(sym, PERIOD_M15, 20, 0, MODE_EMA, PRICE_CLOSE, 1);
   double m15Ema50 = iMA(sym, PERIOD_M15, 50, 0, MODE_EMA, PRICE_CLOSE, 1);
   double m15Rsi14 = iRSI(sym, PERIOD_M15, 14, PRICE_CLOSE, 1);
   double m15Atr14 = iATR(sym, PERIOD_M15, 14, 1);

   double h1Close = iClose(sym, PERIOD_H1, 1);
   double h1Ema20 = iMA(sym, PERIOD_H1, 20, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Ema50 = iMA(sym, PERIOD_H1, 50, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Ema200 = iMA(sym, PERIOD_H1, 200, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Rsi14 = iRSI(sym, PERIOD_H1, 14, PRICE_CLOSE, 1);
   double h1Atr14 = iATR(sym, PERIOD_H1, 14, 1);

   if(!(m15Ema20 > 0.0 && m15Ema50 > 0.0 && m15Atr14 > 0.0 &&
        h1Close > 0.0 && h1Ema20 > 0.0 && h1Ema50 > 0.0 &&
        h1Ema200 > 0.0 && h1Atr14 > 0.0 &&
        m15Rsi14 >= 0.0 && m15Rsi14 <= 100.0 &&
        h1Rsi14 >= 0.0 && h1Rsi14 <= 100.0))
   {
      Print("EURUSDAIMonitorV13: indicator snapshot is invalid.");
      return false;
   }

   double equity = AccountEquity();
   double balance = AccountBalance();
   double dailyPnl = DailyRealizedPnl(sym);

   double dayStartBalance = balance - dailyPnl;
   double dailyPnlPct = 0.0;
   if(dayStartBalance > 0.0)
      dailyPnlPct = ((equity - dayStartBalance) / dayStartBalance) * 100.0;

   double peakEquity = PeakEquity(sym);
   double drawdownPct = 0.0;
   if(peakEquity > 0.0)
      drawdownPct = ((peakEquity - equity) / peakEquity) * 100.0;

   double tickSize = MarketInfo(sym, MODE_TICKSIZE);
   double tickValue = MarketInfo(sym, MODE_TICKVALUE);
   double minLot = MarketInfo(sym, MODE_MINLOT);
   double maxLot = MarketInfo(sym, MODE_MAXLOT);
   double lotStep = MarketInfo(sym, MODE_LOTSTEP);
   int stopLevelPoints = (int)MarketInfo(sym, MODE_STOPLEVEL);
   int freezeLevelPoints = (int)MarketInfo(sym, MODE_FREEZELEVEL);
   int tradeAllowed = (int)MarketInfo(sym, MODE_TRADEALLOWED);

   bool riskDataReady =
      (equity > 0.0 &&
       point > 0.0 &&
       tickSize > 0.0 &&
       tickValue > 0.0 &&
       minLot > 0.0 &&
       maxLot >= minLot &&
       lotStep > 0.0);

   double spreadPoints = spread / point;

   string json = "";
   json += "{";
   json += "\"symbol\":\"" + JsonEscape(sym) + "\",";
   json += "\"timeframe\":\"M15\",";
   json += "\"features\":{";
   json += "\"bid\":" + JsonNumber(bid, digits) + ",";
   json += "\"ask\":" + JsonNumber(ask, digits) + ",";
   json += "\"point\":" + JsonNumber(point, digits) + ",";
   json += "\"spread\":" + JsonNumber(spread, digits) + ",";
   json += "\"spread_points\":" + JsonNumber(spreadPoints, 2) + ",";
   json += "\"bar_time\":" + IntegerToString((int)closedBarTime) + ",";
   json += "\"m15\":{";
   json += "\"ema20\":" + JsonNumber(m15Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(m15Ema50, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(m15Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(m15Atr14, digits);
   json += "},";
   json += "\"h1\":{";
   json += "\"close\":" + JsonNumber(h1Close, digits) + ",";
   json += "\"ema20\":" + JsonNumber(h1Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(h1Ema50, digits) + ",";
   json += "\"ema200\":" + JsonNumber(h1Ema200, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(h1Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(h1Atr14, digits);
   json += "},";
   json += "\"recent_m15\":" + RecentM15Json(sym, digits) + ",";
   json += "\"recent_h1\":" + RecentH1Json(sym, digits);
   json += "},";
   double weekendGapPrice = 0.0;
   double weekendGapAtr = 0.0;
   bool weekendGapKnown = false;
   datetime fridayCloseTime = 0;
   datetime mondayOpenTime = 0;
   WeekendGapMetrics(sym, weekendGapPrice, weekendGapAtr, weekendGapKnown, fridayCloseTime, mondayOpenTime);
   int oldestPositionAge = OldestOpenPositionAgeSeconds(sym);
   json += "\"safety\":{";
   json += "\"weekend_gap_known\":" + (weekendGapKnown ? "true" : "false") + ",";
   json += "\"weekend_gap_price\":" + JsonNumber(weekendGapPrice, digits) + ",";
   json += "\"weekend_gap_atr\":" + JsonNumber(weekendGapAtr, 4) + ",";
   json += "\"gap_reference_time\":" + IntegerToString((int)mondayOpenTime) + ",";
   json += "\"friday_close_time\":" + IntegerToString((int)fridayCloseTime) + ",";
   json += "\"oldest_position_age_seconds\":" + IntegerToString(oldestPositionAge);
   json += "},";
   json += "\"account\":{";
   json += "\"equity\":" + JsonNumber(equity, 2) + ",";
   json += "\"balance\":" + JsonNumber(balance, 2) + ",";
   json += "\"open_positions\":" + IntegerToString(OpenPositions(sym)) + ",";
   json += "\"daily_pnl_pct\":" + JsonNumber(dailyPnlPct, 4) + ",";
   json += "\"drawdown_pct\":" + JsonNumber(drawdownPct, 4) + ",";
   json += "\"tick_size\":" + JsonNumber(tickSize, digits) + ",";
   json += "\"tick_value\":" + JsonNumber(tickValue, 8) + ",";
   json += "\"min_lot\":" + JsonNumber(minLot, 8) + ",";
   json += "\"max_lot\":" + JsonNumber(maxLot, 8) + ",";
   json += "\"lot_step\":" + JsonNumber(lotStep, 8) + ",";
   json += "\"point\":" + JsonNumber(point, digits) + ",";
   json += "\"digits\":" + IntegerToString(digits) + ",";
   json += "\"stop_level_points\":" + IntegerToString(stopLevelPoints) + ",";
   json += "\"freeze_level_points\":" + IntegerToString(freezeLevelPoints) + ",";
   json += "\"trade_allowed\":" + IntegerToString(tradeAllowed) + ",";
   json += "\"risk_data_ready\":" + (riskDataReady ? "true" : "false");
   json += "}";
   json += "}";

   payload = json;
   return true;
}

//---------------------------------------------------------
// HTTP
//---------------------------------------------------------
bool ProbeHealth()
{
   string url = NormalizeBaseUrl() + "/health";
   string headers = "X-Request-Id: EURUSD-HEALTH-" +
                    IntegerToString((int)GetTickCount()) + "\r\n";
   uchar postData[];
   uchar result[];
   string resultHeaders = "";

   ResetLastError();

   int httpCode = WebRequest(
      "GET",
      url,
      headers,
      MathMin(RequestTimeoutMs, 15000),
      postData,
      result,
      resultHeaders
   );

   int errorCode = GetLastError();
   string response = CharArrayToString(result, 0, -1, CP_UTF8);

   Print("EURUSDAIMonitorV13: health probe HTTP=",
         httpCode,
         " error=",
         errorCode,
         " response_length=",
         StringLen(response));

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("EURUSDAIMonitorV13: health probe failed. ",
            "Check MT4 WebRequest allow-list: ",
            NormalizeBaseUrl());
      return false;
   }

   return true;
}

bool PostJson(string path, string payload, string &response)
{
   string url = NormalizeBaseUrl() + path;

   string headers = "Content-Type: application/json\r\n";
   headers += "X-Gold-API-Key: " + TrimText(ApiKey) + "\r\n";
   headers += "X-Request-Id: EURUSD-M15-" + IntegerToString((int)GetTickCount()) + "\r\n";

   uchar postData[];
   uchar result[];
   string resultHeaders = "";

   int payloadLength = StringLen(payload);
   if(payloadLength <= 0)
      return false;

   ArrayResize(postData, payloadLength);
   StringToCharArray(payload, postData, 0, payloadLength, CP_UTF8);

   ResetLastError();

   int httpCode = WebRequest(
      "POST",
      url,
      headers,
      RequestTimeoutMs,
      postData,
      result,
      resultHeaders
   );

   int errorCode = GetLastError();
   response = CharArrayToString(result, 0, -1, CP_UTF8);

   if(httpCode == 409 && StringFind(response, "\"error\":\"duplicate_bar\"") >= 0)
   {
      Print("EURUSDAIMonitorV13: duplicate_bar accepted. path=", path);
      return true;
   }

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("EURUSDAIMonitorV13: WebRequest failed HTTP=",
            httpCode,
            " error=",
            errorCode,
            " path=",
            path,
            " response=",
            response);
      return false;
   }

   return true;
}

//---------------------------------------------------------
// Signal send core
//---------------------------------------------------------
bool SendCurrentBar(bool bypassRetryWindow)
{
   if(!EnableSignalRequests || !g_apiConfigReady)
   {
      Print("EURUSDAIMonitorV13: send skipped. enable=",
            (EnableSignalRequests ? "true" : "false"),
            " config_ready=",
            (g_apiConfigReady ? "true" : "false"));
      return false;
   }

   string sym = TradeSymbol();

   if(!IsEurUsdSymbol(sym))
   {
      Print("EURUSDAIMonitorV13: send skipped. non-EURUSD symbol=", sym);
      return false;
   }

   if(!SymbolReady(sym))
   {
      Print("EURUSDAIMonitorV13: send skipped. SymbolReady=false symbol=", sym);
      return false;
   }

   datetime currentClosedBarOpen = iTime(sym, PERIOD_M15, 1);

   if(currentClosedBarOpen <= 0)
   {
      Print("EURUSDAIMonitorV13: send skipped. invalid current closed M15 bar.");
      return false;
   }

   if(currentClosedBarOpen != g_lastClosedM15Open)
   {
      g_lastClosedM15Open = currentClosedBarOpen;
      g_lastAttemptAt = 0;
   }

   if(!bypassRetryWindow &&
      g_lastAttemptAt > 0 &&
      (TimeCurrent() - g_lastAttemptAt) < RetrySeconds)
   {
      return false;
   }

   datetime maxRetryUntil =
      currentClosedBarOpen + MaxRetryMinutes * 60;

   if(!bypassRetryWindow && TimeCurrent() > maxRetryUntil)
   {
      if(g_retryExpiredBarOpen != currentClosedBarOpen)
      {
         Print("EURUSDAIMonitorV13: send skipped. retry window expired.",
               " bar_open=",
               TimeToString(currentClosedBarOpen, TIME_DATE|TIME_MINUTES),
               " max_retry_until=",
               TimeToString(maxRetryUntil, TIME_DATE|TIME_MINUTES));
         g_retryExpiredBarOpen = currentClosedBarOpen;
      }
      return false;
   }

   string payload = "";
   datetime closedBarOpen = 0;
   datetime closedBarTime = 0;

   if(!BuildSignalPayload(payload, closedBarOpen, closedBarTime))
   {
      Print("EURUSDAIMonitorV13: send skipped. BuildSignalPayload=false.");
      return false;
   }

   g_lastAttemptAt = TimeCurrent();

   string response = "";
   bool ok = PostJson("/api/eurusd/signal", payload, response);

   if(ok)
   {
      Print("EURUSDAIMonitorV13: EURUSD M15 signal processed.",
            " bar_open=",
            TimeToString(closedBarOpen, TIME_DATE|TIME_MINUTES),
            " bar_close=",
            TimeToString(closedBarTime, TIME_DATE|TIME_MINUTES),
            " response=", response);
      return true;
   }

   Print("EURUSDAIMonitorV13: EURUSD M15 signal request failed.",
         " bar_open=",
         TimeToString(closedBarOpen, TIME_DATE|TIME_MINUTES));
   return false;
}

//---------------------------------------------------------
// Main timer
//---------------------------------------------------------
void OnTimer()
{
   SendCurrentBar(false);
}

//---------------------------------------------------------
// EA lifecycle
//---------------------------------------------------------
int OnInit()
{
   string sym = TradeSymbol();

   Print("EURUSDAIMonitorV13 AI-FREE 1.4: starting.",
         " symbol=", sym,
         " api=", NormalizeBaseUrl(),
         " timer=", TimerSeconds,
         " timeoutMs=", RequestTimeoutMs,
         " retries=", RetrySeconds,
         " maxRetryMinutes=", MaxRetryMinutes,
         " signalRequests=", (EnableSignalRequests ? "true" : "false"),
         " order_execution=false");

   if(!IsEurUsdSymbol(sym))
   {
      Print("EURUSDAIMonitorV13: symbol must contain EURUSD. current=", sym);
      return INIT_FAILED;
   }

   g_apiConfigReady = IsValidApiConfiguration();

   if(!g_apiConfigReady)
   {
      Print("EURUSDAIMonitorV13: API configuration incomplete. Signal requests paused.");
   }

   if(!SymbolSelect(sym, true))
   {
      Print("EURUSDAIMonitorV13: SymbolSelect failed. error=", GetLastError(),
            " symbol=", sym);
      return INIT_FAILED;
   }

   if(!EventSetTimer(TimerSeconds))
   {
      Print("EURUSDAIMonitorV13: EventSetTimer failed. error=", GetLastError());
      return INIT_FAILED;
   }

   Print("EURUSDAIMonitorV13: timer started. interval_seconds=", TimerSeconds);

   bool healthOk = ProbeHealth();
   if(!healthOk)
   {
      Print("EURUSDAIMonitorV13: startup connectivity test failed. ",
            "No signal request will be attempted until WebRequest is allowed.");
   }
   else
   {
      Print("EURUSDAIMonitorV13: startup connectivity test passed.");
      Print("EURUSDAIMonitorV13: sending the current completed M15 bar immediately (startup bypass).");
      SendCurrentBar(true);
   }

   Print("EURUSDAIMonitorV13: attached. Monitor-only mode; no OrderSend/OrderClose logic.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}
