#property strict
#property version   "1.0"
#property description "EURUSD M15 H1 trend-pullback AI monitor. Sends completed-bar data to Render. No order execution."

input string ApiBaseUrl = "https://gold-ai-trader-2uny.onrender.com";
input string ApiKey = "CHANGE_ME";
input string SymbolName = "";
input bool   EnableSignalRequests = true;
input int    TimerSeconds = 5;
input int    RequestTimeoutMs = 65000;
input int    RetrySeconds = 30;
input int    MaxRetryMinutes = 12;
input int    MagicNumber = 26100501;

datetime g_lastClosedM15Open = 0;
datetime g_lastAttemptAt = 0;
bool g_apiConfigReady = false;

string TrimText(string value)
{
   value = StringTrimLeft(value);
   value = StringTrimRight(value);
   return value;
}

string TradeSymbol()
{
   string configured = TrimText(SymbolName);
   if(StringLen(configured) > 0) return configured;
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

   Print("EURUSDTrendPullbackMonitor: config url_ok=", (urlOk ? "true" : "false"),
         " key_ok=", (keyOk ? "true" : "false"),
         " timeout_ms=", RequestTimeoutMs);

   if(!urlOk || !keyOk)
   {
      Print("EURUSDTrendPullbackMonitor: API configuration is incomplete.");
      return false;
   }

   if(RequestTimeoutMs < 1000 || TimerSeconds < 1 || RetrySeconds < 5 || MaxRetryMinutes < 1)
      return false;

   return true;
}

bool SymbolReady(string sym)
{
   if(!SymbolSelect(sym, true))
   {
      Print("EURUSDTrendPullbackMonitor: SymbolSelect failed. symbol=", sym,
            " error=", GetLastError());
      return false;
   }

   int m15Bars = iBars(sym, PERIOD_M15);
   int h1Bars = iBars(sym, PERIOD_H1);
   if(m15Bars < 300 || h1Bars < 300)
   {
      Print("EURUSDTrendPullbackMonitor: insufficient history M15=", m15Bars,
            " H1=", h1Bars);
      return false;
   }

   datetime m15Open = iTime(sym, PERIOD_M15, 1);
   datetime h1Open = iTime(sym, PERIOD_H1, 1);
   return (m15Open > 0 && h1Open > 0);
}

int OpenPositions(string sym)
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

double DailyRealizedPnl(string sym)
{
   datetime dayStart = StrToTime(TimeToString(TimeCurrent(), TIME_DATE));
   double realized = 0.0;
   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderSymbol() != sym || OrderMagicNumber() != MagicNumber) continue;
      if(OrderCloseTime() < dayStart) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      realized += OrderProfit() + OrderSwap() + OrderCommission();
   }
   return realized;
}

double PeakEquity(string sym)
{
   string key = "EURUSDTrendPullbackMonitor:PeakEquity:" +
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
      if(openTime <= 0) continue;

      datetime closeTime = openTime + 900;
      double open = iOpen(sym, PERIOD_M15, shift);
      double high = iHigh(sym, PERIOD_M15, shift);
      double low = iLow(sym, PERIOD_M15, shift);
      double close = iClose(sym, PERIOD_M15, shift);
      long volume = iVolume(sym, PERIOD_M15, shift);

      if(!(open > 0.0 && high >= low && high >= open && high >= close &&
           low <= open && low <= close)) continue;

      if(!first) out += ",";
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
      if(openTime <= 0) continue;

      datetime closeTime = openTime + 3600;
      double open = iOpen(sym, PERIOD_H1, shift);
      double high = iHigh(sym, PERIOD_H1, shift);
      double low = iLow(sym, PERIOD_H1, shift);
      double close = iClose(sym, PERIOD_H1, shift);
      long volume = iVolume(sym, PERIOD_H1, shift);

      if(!(open > 0.0 && high >= low && high >= open && high >= close &&
           low <= open && low <= close)) continue;

      if(!first) out += ",";
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

bool BuildSignalPayload(string &payload, datetime &closedBarOpen, datetime &closedBarTime)
{
   string sym = TradeSymbol();
   if(!SymbolReady(sym)) return false;

   RefreshRates();

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);
   double spread = ask - bid;

   if(!(digits >= 3 && digits <= 6) || !(point > 0.0) ||
      !(bid > 0.0) || !(ask > 0.0) || ask < bid) return false;

   closedBarOpen = iTime(sym, PERIOD_M15, 1);
   if(closedBarOpen <= 0) return false;
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
        h1Rsi14 >= 0.0 && h1Rsi14 <= 100.0)) return false;

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
      equity > 0.0 && point > 0.0 && tickSize > 0.0 && tickValue > 0.0 &&
      minLot > 0.0 && maxLot >= minLot && lotStep > 0.0;

   double spreadPoints = spread / point;

   payload = "{";
   payload += "\"symbol\":\"" + JsonEscape(sym) + "\",";
   payload += "\"timeframe\":\"M15\",";
   payload += "\"features\":{";
   payload += "\"bid\":" + JsonNumber(bid, digits) + ",";
   payload += "\"ask\":" + JsonNumber(ask, digits) + ",";
   payload += "\"point\":" + JsonNumber(point, digits) + ",";
   payload += "\"spread\":" + JsonNumber(spread, digits) + ",";
   payload += "\"spread_points\":" + JsonNumber(spreadPoints, 2) + ",";
   payload += "\"bar_time\":" + IntegerToString((int)closedBarTime) + ",";
   payload += "\"m15\":{";
   payload += "\"ema20\":" + JsonNumber(m15Ema20, digits) + ",";
   payload += "\"ema50\":" + JsonNumber(m15Ema50, digits) + ",";
   payload += "\"rsi14\":" + JsonNumber(m15Rsi14, 2) + ",";
   payload += "\"atr14\":" + JsonNumber(m15Atr14, digits);
   payload += "},";
   payload += "\"h1\":{";
   payload += "\"close\":" + JsonNumber(h1Close, digits) + ",";
   payload += "\"ema20\":" + JsonNumber(h1Ema20, digits) + ",";
   payload += "\"ema50\":" + JsonNumber(h1Ema50, digits) + ",";
   payload += "\"ema200\":" + JsonNumber(h1Ema200, digits) + ",";
   payload += "\"rsi14\":" + JsonNumber(h1Rsi14, 2) + ",";
   payload += "\"atr14\":" + JsonNumber(h1Atr14, digits);
   payload += "},";
   payload += "\"recent_m15\":" + RecentM15Json(sym, digits) + ",";
   payload += "\"recent_h1\":" + RecentH1Json(sym, digits);
   payload += "},";
   payload += "\"account\":{";
   payload += "\"equity\":" + JsonNumber(equity, 2) + ",";
   payload += "\"balance\":" + JsonNumber(balance, 2) + ",";
   payload += "\"open_positions\":" + IntegerToString(OpenPositions(sym)) + ",";
   payload += "\"daily_pnl_pct\":" + JsonNumber(dailyPnlPct, 4) + ",";
   payload += "\"drawdown_pct\":" + JsonNumber(drawdownPct, 4) + ",";
   payload += "\"tick_size\":" + JsonNumber(tickSize, digits) + ",";
   payload += "\"tick_value\":" + JsonNumber(tickValue, 8) + ",";
   payload += "\"min_lot\":" + JsonNumber(minLot, 8) + ",";
   payload += "\"max_lot\":" + JsonNumber(maxLot, 8) + ",";
   payload += "\"lot_step\":" + JsonNumber(lotStep, 8) + ",";
   payload += "\"point\":" + JsonNumber(point, digits) + ",";
   payload += "\"digits\":" + IntegerToString(digits) + ",";
   payload += "\"stop_level_points\":" + IntegerToString(stopLevelPoints) + ",";
   payload += "\"freeze_level_points\":" + IntegerToString(freezeLevelPoints) + ",";
   payload += "\"trade_allowed\":" + IntegerToString(tradeAllowed) + ",";
   payload += "\"risk_data_ready\":" + (riskDataReady ? "true" : "false");
   payload += "}";
   payload += "}";
   return true;
}

bool PostJson(string path, string payload, string &response)
{
   string url = NormalizeBaseUrl() + path;
   string headers = "Content-Type: application/json\r\n";
   headers += "X-Gold-API-Key: " + TrimText(ApiKey) + "\r\n";
   headers += "X-Request-Id: EURUSD-TREND-PULLBACK-" + IntegerToString(GetTickCount()) + "\r\n";

   uchar postData[];
   uchar result[];
   string resultHeaders = "";

   int payloadLength = StringLen(payload);
   if(payloadLength <= 0) return false;

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
      return true;

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("EURUSDTrendPullbackMonitor: WebRequest failed HTTP=", httpCode,
            " error=", errorCode, " response=", response);
      return false;
   }
   return true;
}

void OnTimer()
{
   if(!EnableSignalRequests || !g_apiConfigReady) return;

   string sym = TradeSymbol();
   if(!IsEurUsdSymbol(sym) || !SymbolReady(sym)) return;

   datetime currentClosedBarOpen = iTime(sym, PERIOD_M15, 1);
   if(currentClosedBarOpen <= 0) return;

   if(currentClosedBarOpen != g_lastClosedM15Open)
   {
      g_lastClosedM15Open = currentClosedBarOpen;
      g_lastAttemptAt = 0;
   }

   if(g_lastAttemptAt > 0 && (TimeCurrent() - g_lastAttemptAt) < RetrySeconds) return;

   datetime maxRetryUntil = currentClosedBarOpen + MaxRetryMinutes * 60;
   if(TimeCurrent() > maxRetryUntil) return;

   string payload = "";
   datetime closedBarOpen = 0;
   datetime closedBarTime = 0;
   if(!BuildSignalPayload(payload, closedBarOpen, closedBarTime)) return;

   g_lastAttemptAt = TimeCurrent();

   string response = "";
   if(PostJson("/api/eurusd/pullback-signal", payload, response))
   {
      Print("EURUSDTrendPullbackMonitor: signal processed bar_open=",
            TimeToString(closedBarOpen, TIME_DATE|TIME_MINUTES),
            " response=", response);
   }
   else
   {
      Print("EURUSDTrendPullbackMonitor: signal request failed bar_open=",
            TimeToString(closedBarOpen, TIME_DATE|TIME_MINUTES));
   }
}

int OnInit()
{
   string sym = TradeSymbol();

   Print("EURUSDTrendPullbackMonitor 1.0 starting. symbol=", sym,
         " api=", NormalizeBaseUrl(),
         " timer=", TimerSeconds,
         " timeoutMs=", RequestTimeoutMs,
         " signalRequests=", (EnableSignalRequests ? "true" : "false"),
         " order_execution=false");

   if(!IsEurUsdSymbol(sym))
      return INIT_FAILED;

   g_apiConfigReady = IsValidApiConfiguration();

   if(!SymbolSelect(sym, true))
      return INIT_FAILED;

   if(!EventSetTimer(TimerSeconds))
      return INIT_FAILED;

   Print("EURUSDTrendPullbackMonitor: attached. Monitor-only mode; no OrderSend/OrderClose logic.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}
