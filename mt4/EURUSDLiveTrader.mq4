// Safety telemetry gate revision: validated server-side safety fields before execution is enabled.
#property strict
#property version   "0.1"
#property description "EURUSD M15 live executor. Dual-gated server approval + local safety guard. Auto trading is OFF by default."

input string ApiBaseUrl = "https://gold-ai-trader-2uny.onrender.com";
input string ApiKey = "CHANGE_ME";
input string SymbolName = "";
input bool   EnableSignalRequests = true;
input bool   AllowAutoOrders = false;
input int    TimerSeconds = 5;
input int    SafetyCheckSeconds = 30;
input int    RequestTimeoutMs = 15000;
input int    RetrySeconds = 30;
input int    MaxRetryMinutes = 12;
input int    MaxHoldSeconds = 3600;
input double MaxSpreadPips = 1.20;
input double MaxExecutionDeviationPips = 0.50;
input int    SlippagePoints = 3;
input int    MagicNumber = 26100301;

datetime g_lastClosedM15Open = 0;
datetime g_lastAttemptAt = 0;
datetime g_lastSafetyCheckAt = 0;
string g_lastSignalId = "";
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

   Print("EURUSDAIMonitor: config check url_ok=",
         (urlOk ? "true" : "false"),
         " key_ok=",
         (keyOk ? "true" : "false"),
         " timeout_ms=",
         RequestTimeoutMs);

   if(!urlOk)
   {
      Print("EURUSDAIMonitor: ApiBaseUrl must start with https://");
      return false;
   }

   if(!keyOk)
   {
      Print("EURUSDAIMonitor: ApiKey is not configured or is too short.");
      return false;
   }

   if(RequestTimeoutMs < 1000)
   {
      Print("EURUSDAIMonitor: RequestTimeoutMs must be >= 1000.");
      return false;
   }

   if(TimerSeconds < 1)
   {
      Print("EURUSDAIMonitor: TimerSeconds must be >= 1.");
      return false;
   }

   if(RetrySeconds < 5)
   {
      Print("EURUSDAIMonitor: RetrySeconds must be >= 5.");
      return false;
   }

   if(MaxRetryMinutes < 1)
   {
      Print("EURUSDAIMonitor: MaxRetryMinutes must be >= 1.");
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
      Print("EURUSDAIMonitor: SymbolSelect failed for ", sym,
            " error=", GetLastError());
      return false;
   }

   int m15Bars = iBars(sym, PERIOD_M15);
   int h1Bars = iBars(sym, PERIOD_H1);

   if(m15Bars < 300 || h1Bars < 300)
   {
      Print("EURUSDAIMonitor: insufficient history. M15=", m15Bars,
            " H1=", h1Bars);
      return false;
   }

   datetime m15Open = iTime(sym, PERIOD_M15, 1);
   datetime h1Open = iTime(sym, PERIOD_H1, 1);

   if(m15Open <= 0 || h1Open <= 0)
   {
      Print("EURUSDAIMonitor: price history is not ready.");
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
   string key = "EURUSDAIMonitor:PeakEquity:" +
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
      Print("EURUSDAIMonitor: invalid market snapshot.");
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
      Print("EURUSDAIMonitor: indicator snapshot is invalid.");
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
      Print("EURUSDAIMonitor: duplicate_bar accepted. path=", path);
      return true;
   }

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("EURUSDAIMonitor: WebRequest failed HTTP=",
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

// --------------------------------------------------------
// JSON helpers for server response
// --------------------------------------------------------
string JsonExtractString(string textValue, string key)
{
   string marker = "\""+key+"\":\"";
   int start = StringFind(textValue, marker);
   if(start < 0) return "";
   start += StringLen(marker);
   int end = StringFind(textValue, "\"", start);
   if(end < 0) return "";
   return StringSubstr(textValue, start, end - start);
}

double JsonExtractNumber(string textValue, string key)
{
   string marker = "\""+key+"\":";
   int start = StringFind(textValue, marker);
   if(start < 0) return 0.0;
   start += StringLen(marker);

   while(start < StringLen(textValue))
   {
      int ch = StringGetCharacter(textValue, start);
      if(ch == 32 || ch == 9 || ch == 13 || ch == 10) start++;
      else break;
   }

   int end = start;
   while(end < StringLen(textValue))
   {
      int ch = StringGetCharacter(textValue, end);
      if(ch == 44 || ch == 125 || ch == 32 || ch == 9 || ch == 13 || ch == 10) break;
      end++;
   }

   return StrToDouble(StringSubstr(textValue, start, end - start));
}

bool JsonHasTrue(string textValue, string key)
{
   return StringFind(textValue, "\""+key+"\":true") >= 0;
}

string JsonObjectSection(string textValue, string key, string nextKey)
{
   string startMarker = "\""+key+"\":{";
   int start = StringFind(textValue, startMarker);
   if(start < 0) return "";
   start += StringLen(startMarker);

   string endMarker = ",\""+nextKey+"\":";
   int end = StringFind(textValue, endMarker, start);
   if(end < 0) end = StringLen(textValue);

   return StringSubstr(textValue, start, end - start);
}

int CountManagedPositions(string sym)
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber) continue;
      int type = OrderType();
      if(type == OP_BUY || type == OP_SELL) count++;
   }
   return count;
}

int OldestManagedPositionAgeSeconds(string sym)
{
   datetime oldest = 0;
   datetime now = TimeCurrent();

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber) continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;

      if(oldest == 0 || OrderOpenTime() < oldest)
         oldest = OrderOpenTime();
   }

   if(oldest <= 0) return 0;
   return MathMax(0, (int)(now - oldest));
}

bool CloseManagedPositions(string reason)
{
   string sym = TradeSymbol();
   bool allOk = true;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber) continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;

      RefreshRates();
      double closePrice = type == OP_BUY ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
      if(closePrice <= 0.0)
      {
         allOk = false;
         continue;
      }

      ResetLastError();
      bool ok = OrderClose(OrderTicket(), OrderLots(), closePrice, SlippagePoints, clrNONE);
      int err = GetLastError();

      if(!ok)
      {
         Print("EURUSDLiveTrader: OrderClose failed ticket=", OrderTicket(),
               " error=", err, " reason=", reason);
         allOk = false;
      }
      else
      {
         Print("EURUSDLiveTrader: position closed ticket=", OrderTicket(),
               " reason=", reason);
      }
   }

   return allOk;
}

bool LocalNewOrderSafetyAllowed(string sym)
{
   datetime utcNow = TimeGMT();
   int day = TimeDayOfWeek(utcNow);
   int minutes = TimeHour(utcNow) * 60 + TimeMinute(utcNow);

   // Conservative UTC safety windows. The server remains the primary gate.
   if(day == 5 && minutes >= 20 * 60) return false;
   if(day == 0 && minutes >= 21 * 60 && minutes < 22 * 60 + 30) return false;
   if(minutes >= 21 * 60 + 55 && minutes < 22 * 60 + 15) return false;

   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);
   double spreadPips = (ask > bid && bid > 0.0) ? (ask - bid) / 0.0001 : 999.0;
   if(spreadPips > MaxSpreadPips) return false;

   return true;
}

bool RunServerSafetyCheck(string sym, string &response, bool &newOrdersAllowed)
{
   double gapPrice = 0.0;
   double gapAtr = 0.0;
   bool gapKnown = false;
   datetime fridayCloseTime = 0;
   datetime mondayOpenTime = 0;
   WeekendGapMetrics(sym, gapPrice, gapAtr, gapKnown, fridayCloseTime, mondayOpenTime);

   string payload = "{";
   payload += "\"safety\":{";
   payload += "\"oldest_position_age_seconds\":" + IntegerToString(OldestManagedPositionAgeSeconds(sym)) + ",";
   payload += "\"weekend_gap_known\":" + (gapKnown ? "true" : "false") + ",";
   payload += "\"weekend_gap_price\":" + JsonNumber(gapPrice, 5) + ",";
   payload += "\"weekend_gap_atr\":" + JsonNumber(gapAtr, 4) + ",";
   payload += "\"gap_reference_time\":" + IntegerToString((int)mondayOpenTime);
   payload += "}}";

   if(!PostJson("/api/eurusd/safety-check", payload, response))
   {
      newOrdersAllowed = false;
      return false;
   }

   if(JsonHasTrue(response, "forceClose"))
   {
      if(!CloseManagedPositions("server_safety_force_close"))
         return false;
   }

   newOrdersAllowed = JsonHasTrue(response, "newOrdersAllowed");
   if(!newOrdersAllowed)
      Print("EURUSDLiveTrader: server safety blocks new orders. response=", response);

   return true;
}

bool ReportExecutionResult(string signalId, string side, string status, int ticket,
                           double requestedPrice, double filledPrice, double volume,
                           double stopLoss, double takeProfit, string brokerError)
{
   if(StringLen(signalId) == 0) return false;

   string payload = "{";
   payload += "\"signal_id\":\"" + JsonEscape(signalId) + "\",";
   payload += "\"idempotency_key\":\"EURUSD-" + JsonEscape(signalId) + "\",";
   payload += "\"side\":\"" + JsonEscape(side) + "\",";
   payload += "\"status\":\"" + JsonEscape(status) + "\",";
   payload += "\"mt4_ticket\":" + IntegerToString(ticket) + ",";
   payload += "\"requested_price\":" + JsonNumber(requestedPrice, 5) + ",";
   payload += "\"filled_price\":" + JsonNumber(filledPrice, 5) + ",";
   payload += "\"volume\":" + DoubleToString(volume, 2) + ",";
   payload += "\"stop_loss\":" + JsonNumber(stopLoss, 5) + ",";
   payload += "\"take_profit\":" + JsonNumber(takeProfit, 5) + ",";
   payload += "\"broker_error\":\"" + JsonEscape(brokerError) + "\"";
   payload += "}";

   string response = "";
   return PostJson("/api/eurusd/execution-result", payload, response);
}

bool ExecuteApprovedSignal(string response)
{
   if(!AllowAutoOrders)
   {
      Print("EURUSDLiveTrader: AllowAutoOrders=false; no OrderSend executed.");
      return true;
   }

   if(!JsonHasTrue(response, "order_allowed"))
      return true;

   string decisionSection = JsonObjectSection(response, "decision", "risk");
   string riskSection = JsonObjectSection(response, "risk", "fundamental_sources");

   string signalId = JsonExtractString(response, "signal_id");
   string side = JsonExtractString(decisionSection, "decision");
   double entry = JsonExtractNumber(decisionSection, "entry");
   double stopLoss = JsonExtractNumber(decisionSection, "stop_loss");
   double takeProfit = JsonExtractNumber(decisionSection, "take_profit");
   double lots = JsonExtractNumber(riskSection, "lots");

   if(StringLen(signalId) == 0 || (side != "BUY" && side != "SELL")) return false;
   if(!(lots > 0.0) || !(entry > 0.0) || !(stopLoss > 0.0) || !(takeProfit > 0.0)) return false;

   string sym = TradeSymbol();
   if(CountManagedPositions(sym) > 0) return true;
   if(!LocalNewOrderSafetyAllowed(sym)) return true;

   RefreshRates();

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double ask = MarketInfo(sym, MODE_ASK);
   double bid = MarketInfo(sym, MODE_BID);
   double current = side == "BUY" ? ask : bid;
   double deviationPips = current > 0.0 ? MathAbs(current - entry) / 0.0001 : 999.0;

   if(deviationPips > MaxExecutionDeviationPips)
   {
      ReportExecutionResult(signalId, side, "REJECTED", 0, current, 0, lots, stopLoss, takeProfit, "execution_price_deviation");
      return true;
   }

   double minLot = MarketInfo(sym, MODE_MINLOT);
   double maxLot = MarketInfo(sym, MODE_MAXLOT);
   double lotStep = MarketInfo(sym, MODE_LOTSTEP);
   double normalizedLots = lots;

   if(lotStep > 0.0)
      normalizedLots = MathFloor(normalizedLots / lotStep + 1e-9) * lotStep;

   normalizedLots = MathMax(minLot, MathMin(maxLot, normalizedLots));
   normalizedLots = NormalizeDouble(normalizedLots, 2);

   if(normalizedLots < minLot || normalizedLots > maxLot)
      return false;

   int orderType = side == "BUY" ? OP_BUY : OP_SELL;
   double orderPrice = side == "BUY" ? ask : bid;

   ResetLastError();
   double freeMargin = AccountFreeMarginCheck(sym, orderType, normalizedLots);
   int marginError = GetLastError();

   if(freeMargin <= 0.0 || marginError != 0)
   {
      ReportExecutionResult(signalId, side, "REJECTED", 0, orderPrice, 0, normalizedLots,
                            stopLoss, takeProfit, "margin_check_failed");
      return true;
   }

   ResetLastError();
   int ticket = OrderSend(
      sym,
      orderType,
      normalizedLots,
      NormalizeDouble(orderPrice, digits),
      SlippagePoints,
      NormalizeDouble(stopLoss, digits),
      NormalizeDouble(takeProfit, digits),
      "EURUSD-LT",
      MagicNumber,
      0,
      clrNONE
   );
   int err = GetLastError();

   if(ticket < 0)
   {
      ReportExecutionResult(signalId, side, "REJECTED", 0, orderPrice, 0, normalizedLots,
                            stopLoss, takeProfit, "OrderSend_error_" + IntegerToString(err));
      return true;
   }

   double filledPrice = orderPrice;
   if(OrderSelect(ticket, SELECT_BY_TICKET))
      filledPrice = OrderOpenPrice();

   g_lastSignalId = signalId;
   Print("EURUSDLiveTrader: ORDER FILLED ticket=", ticket,
         " side=", side, " lots=", DoubleToString(normalizedLots, 2),
         " entry=", DoubleToString(filledPrice, digits));

   ReportExecutionResult(signalId, side, "FILLED", ticket, orderPrice, filledPrice,
                         normalizedLots, stopLoss, takeProfit, "");
   return true;
}

//---------------------------------------------------------
// Main timer
//---------------------------------------------------------
void OnTimer()
{
   string sym = TradeSymbol();

   if(!IsEurUsdSymbol(sym) || !SymbolReady(sym))
      return;

   if(OldestManagedPositionAgeSeconds(sym) > MaxHoldSeconds)
      CloseManagedPositions("local_max_hold");

   datetime utcNow = TimeGMT();
   int utcDay = TimeDayOfWeek(utcNow);
   int utcMinutes = TimeHour(utcNow) * 60 + TimeMinute(utcNow);
   if(utcDay == 5 && utcMinutes >= (20 * 60 + 30))
      CloseManagedPositions("local_weekend_force_close");

   datetime now = TimeCurrent();
   if(g_lastSafetyCheckAt == 0 || (now - g_lastSafetyCheckAt) >= SafetyCheckSeconds)
   {
      string safetyResponse = "";
      bool serverNewOrdersAllowed = false;
      if(!RunServerSafetyCheck(sym, safetyResponse, serverNewOrdersAllowed))
      {
         Print("EURUSDLiveTrader: server safety check failed; order path stays fail-closed.");
         return;
      }
      if(CountManagedPositions(sym) == 0 && !serverNewOrdersAllowed)
         return;
      g_lastSafetyCheckAt = now;
   }

   if(!EnableSignalRequests || !g_apiConfigReady)
      return;

   if(CountManagedPositions(sym) > 0)
      return;

   if(!LocalNewOrderSafetyAllowed(sym))
      return;

   datetime currentClosedBarOpen = iTime(sym, PERIOD_M15, 1);
   if(currentClosedBarOpen <= 0 || currentClosedBarOpen == g_lastClosedM15Open)
      return;

   g_lastClosedM15Open = currentClosedBarOpen;

   if(g_lastAttemptAt > 0 && (TimeCurrent() - g_lastAttemptAt) < RetrySeconds)
      return;

   datetime maxRetryUntil = currentClosedBarOpen + MaxRetryMinutes * 60;
   if(TimeCurrent() > maxRetryUntil)
      return;

   string payload = "";
   datetime closedBarOpen = 0;
   datetime closedBarTime = 0;

   if(!BuildSignalPayload(payload, closedBarOpen, closedBarTime))
      return;

   g_lastAttemptAt = TimeCurrent();

   string response = "";
   if(!PostJson("/api/eurusd/signal", payload, response))
      return;

   Print("EURUSDLiveTrader: signal response=", response);
   ExecuteApprovedSignal(response);
}

//---------------------------------------------------------
// EA lifecycle
//---------------------------------------------------------
int OnInit()
{
   string sym = TradeSymbol();

   Print("EURUSDLiveTrader 0.1 starting. symbol=", sym,
         " api=", NormalizeBaseUrl(),
         " allowAutoOrders=", (AllowAutoOrders ? "true" : "false"),
         " safetyCheckSeconds=", SafetyCheckSeconds,
         " maxHoldSeconds=", MaxHoldSeconds,
         " maxSpreadPips=", DoubleToString(MaxSpreadPips, 2),
         " server_gate_required=true",
         " local_gate_required=true");

   if(!IsEurUsdSymbol(sym))
      return INIT_FAILED;

   g_apiConfigReady = IsValidApiConfiguration();

   if(!SymbolSelect(sym, true))
      return INIT_FAILED;

   if(TimerSeconds < 1 || SafetyCheckSeconds < 5 || RequestTimeoutMs < 1000 ||
      MaxHoldSeconds < 60 || MaxSpreadPips <= 0.0 || MaxExecutionDeviationPips <= 0.0 ||
      SlippagePoints < 0)
   {
      return INIT_FAILED;
   }

   if(!EventSetTimer(TimerSeconds))
      return INIT_FAILED;

   if(!g_apiConfigReady)
      Print("EURUSDLiveTrader: API config incomplete; order path is disabled.");

   Print("EURUSDLiveTrader: attached. AllowAutoOrders is OFF by default.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}
