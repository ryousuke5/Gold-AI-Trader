#property strict
#property version   "2.0"
#property description "XAUUSD AI Test V2 - one-shot OpenAI integration test. No orders."

input string ApiBaseUrl = "https://gold-ai-trader-2uny.onrender.com";
input string ApiKey = "CHANGE_ME";
input string SymbolName = "";
input bool   RequireGoldSymbol = true;
input bool   EnableSignalRequests = true;
input bool   AllowAutoOrders = false;
input int    TimerSeconds = 5;
input int    MagicNumber = 26092801;
input double MaxSpreadPrice = 0.50;
input int    RequestTimeoutMs = 8000;

datetime g_lastClosedM5Bar = 0;
datetime g_lastAttemptedM5Bar = 0;
datetime g_lastAttemptAt = 0;
int g_retrySeconds = 30;
bool g_apiConfigReady = false;
bool g_apiConfigWarningLogged = false;
bool g_aiTestDoneLocal = false;

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

bool IsGoldSymbol(string sym)
{
   if(!RequireGoldSymbol)
      return true;

   if(StringFind(sym, "XAU") >= 0)
      return true;
   if(StringFind(sym, "xau") >= 0)
      return true;
   if(StringFind(sym, "GOLD") >= 0)
      return true;
   if(StringFind(sym, "gold") >= 0)
      return true;

   return false;
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
   bool urlOk = (StringFind(TrimText(ApiBaseUrl), "https://") == 0);
   bool keyOk = (StringLen(TrimText(ApiKey)) >= 16 && TrimText(ApiKey) != "CHANGE_ME");

   Print("GoldAITrader: API config check. url_ok=",
         (urlOk ? "true" : "false"),
         " key_ok=",
         (keyOk ? "true" : "false"));

   if(!urlOk)
   {
      Print("GoldAITrader: ApiBaseUrl must start with https://");
      return false;
   }

   if(!keyOk)
   {
      Print("GoldAITrader: ApiKey is not configured or is too short.");
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
      Print("GoldAITrader: SymbolSelect failed for ", sym,
            " error=", GetLastError());
      return false;
   }

   int m5Bars = iBars(sym, PERIOD_M5);
   int h1Bars = iBars(sym, PERIOD_H1);

   if(m5Bars < 100 || h1Bars < 250)
   {
      Print("GoldAITrader: insufficient history. M5=", m5Bars,
            " H1=", h1Bars);
      return false;
   }

   datetime m5Time = iTime(sym, PERIOD_M5, 1);
   datetime h1Time = iTime(sym, PERIOD_H1, 1);

   if(m5Time <= 0 || h1Time <= 0)
   {
      Print("GoldAITrader: price history is not ready.");
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

double PeakEquity()
{
   string key = "GoldAITrader:PeakEquity";
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

//---------------------------------------------------------
// Build API payload
//---------------------------------------------------------
bool BuildSignalPayload(string &payload)
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
   double spreadPoints = 0.0;

   if(spread > MaxSpreadPrice)
      Print("GoldAITrader: spread is above local observation threshold. spread=", DoubleToString(spread, digits), " max=", DoubleToString(MaxSpreadPrice, digits));

   if(point > 0.0)
      spreadPoints = spread / point;

   datetime closedBarOpen = iTime(sym, PERIOD_M5, 1);
   if(closedBarOpen <= 0)
      return false;

   datetime closedBarTime = closedBarOpen + 300;

   double m5Ema20 = iMA(sym, PERIOD_M5, 20, 0, MODE_EMA, PRICE_CLOSE, 1);
   double m5Ema50 = iMA(sym, PERIOD_M5, 50, 0, MODE_EMA, PRICE_CLOSE, 1);
   double m5Rsi14 = iRSI(sym, PERIOD_M5, 14, PRICE_CLOSE, 1);
   double m5Atr14 = iATR(sym, PERIOD_M5, 14, 1);

   int highShift = iHighest(sym, PERIOD_M5, MODE_HIGH, 20, 1);
   int lowShift = iLowest(sym, PERIOD_M5, MODE_LOW, 20, 1);

   double m5High20 = 0.0;
   double m5Low20 = 0.0;

   if(highShift >= 0)
      m5High20 = iHigh(sym, PERIOD_M5, highShift);

   if(lowShift >= 0)
      m5Low20 = iLow(sym, PERIOD_M5, lowShift);

   double h1Ema20 = iMA(sym, PERIOD_H1, 20, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Ema50 = iMA(sym, PERIOD_H1, 50, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Ema200 = iMA(sym, PERIOD_H1, 200, 0, MODE_EMA, PRICE_CLOSE, 1);
   double h1Rsi14 = iRSI(sym, PERIOD_H1, 14, PRICE_CLOSE, 1);
   double h1Atr14 = iATR(sym, PERIOD_H1, 14, 1);

   double equity = AccountEquity();
   double balance = AccountBalance();
   double dailyPnl = DailyRealizedPnl(sym);

   double dayStartBalance = balance - dailyPnl;
   double dailyPnlPct = 0.0;

   if(dayStartBalance > 0.0)
      dailyPnlPct = ((equity - dayStartBalance) / dayStartBalance) * 100.0;

   double peakEquity = PeakEquity();
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

   string json = "";

   json += "{";
   json += "\"symbol\":\"" + JsonEscape(sym) + "\",";
   json += "\"timeframe\":\"M5\",";
   json += "\"features\":{";
   json += "\"bid\":" + JsonNumber(bid, digits) + ",";
   json += "\"ask\":" + JsonNumber(ask, digits) + ",";
   json += "\"point\":" + JsonNumber(point, digits) + ",";
   json += "\"spread\":" + JsonNumber(spread, digits) + ",";
   json += "\"spread_points\":" + JsonNumber(spreadPoints, 2) + ",";
   json += "\"bar_time\":" + IntegerToString((int)closedBarTime) + ",";
   json += "\"m5\":{";
   json += "\"ema20\":" + JsonNumber(m5Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(m5Ema50, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(m5Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(m5Atr14, digits) + ",";
   json += "\"high20\":" + JsonNumber(m5High20, digits) + ",";
   json += "\"low20\":" + JsonNumber(m5Low20, digits);
   json += "},";
   json += "\"h1\":{";
   json += "\"ema20\":" + JsonNumber(h1Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(h1Ema50, digits) + ",";
   json += "\"ema200\":" + JsonNumber(h1Ema200, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(h1Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(h1Atr14, digits);
   json += "},";
   json += "\"recent_m5\":[],";
   json += "\"recent_h1\":[]";
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
   string url = ApiBaseUrl + path;

   string headers = "Content-Type: application/json\r\n";
   headers += "X-Gold-API-Key: " + TrimText(ApiKey) + "\r\n";
   headers += "X-Request-Id: " + IntegerToString((int)GetTickCount()) + "\r\n";

   Print("GoldAITrader V1.6: request header length=", StringLen(headers),
         " api_key_length=", StringLen(TrimText(ApiKey)));

   uchar postData[];
   uchar result[];
   string resultHeaders = "";

   int payloadLength = StringLen(payload);
   ArrayResize(postData, payloadLength);

   if(payloadLength > 0)
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
      Print("GoldAITrader: duplicate_bar accepted as already processed. path=", path);
      return true;
   }

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("GoldAITrader: WebRequest failed. HTTP=",
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
// Main timer
//---------------------------------------------------------
void OnTimer()
{
   if(!EnableSignalRequests)
      return;

   if(!g_apiConfigReady)
   {
      if(!g_apiConfigWarningLogged)
      {
         Print("GoldAITrader: signal requests paused until ApiBaseUrl and ApiKey are configured.");
         g_apiConfigWarningLogged = true;
      }
      return;
   }

   string sym = TradeSymbol();

   if(!IsGoldSymbol(sym))
      return;

   if(!SymbolReady(sym))
      return;

   datetime closedBar = iTime(sym, PERIOD_M5, 1);

   if(closedBar <= 0)
      return;

   if(closedBar == g_lastClosedM5Bar)
      return;

   datetime now = TimeCurrent();

   if(closedBar == g_lastAttemptedM5Bar &&
      g_lastAttemptAt > 0 &&
      (now - g_lastAttemptAt) < g_retrySeconds)
      return;

   g_lastAttemptedM5Bar = closedBar;
   g_lastAttemptAt = now;

   string payload = "";
   string response = "";

   if(!BuildSignalPayload(payload))
      return;

   Print("GoldAITrader AI TEST V2: local ApiKey length=", StringLen(TrimText(ApiKey)),
         " url_length=", StringLen(TrimText(ApiBaseUrl)));

   if(!g_aiTestDoneLocal)
   {
      string aiTestResponse = "";
      if(PostJson("/api/gold/ai-test", payload, aiTestResponse))
      {
         g_aiTestDoneLocal = true;
         Print("GoldAITrader AI TEST V2: AI test response = ", aiTestResponse);
      }
      else
      {
         Print("GoldAITrader AI TEST V2: AI test request failed; will retry.");
      }
      return;
   }

   Print("GoldAITrader AI TEST V2: one-shot AI test already completed for this EA instance.");
   return;

   if(PostJson("/api/gold/signal", payload, response))
   {
      g_lastClosedM5Bar = closedBar;
      Print("GoldAITrader: signal response = ", response);

      if(AllowAutoOrders)
      {
         Print("GoldAITrader: AllowAutoOrders=true is ignored in V1.2 analysis bridge. No orders are sent.");
      }
   }
}

//---------------------------------------------------------
// EA lifecycle
//---------------------------------------------------------
int OnInit()
{
   string sym = TradeSymbol();

   Print("GoldAITrader V1.6 BUILD=20260930B: starting initialization. symbol=", sym,
         " api=", ApiBaseUrl,
         " timer=", TimerSeconds,
         " timeoutMs=", RequestTimeoutMs,
         " signalRequests=", (EnableSignalRequests ? "true" : "false"),
         " autoOrders=", (AllowAutoOrders ? "requested-but-disabled" : "off"));

   g_apiConfigReady = IsValidApiConfiguration();

   if(!g_apiConfigReady)
   {
      Print("GoldAITrader: API configuration is incomplete. EA will stay attached, but signal requests are paused.");
   }

   if(!IsGoldSymbol(sym))
   {
      Print("GoldAITrader: chart symbol is not recognized as gold: ", sym);
      return INIT_FAILED;
   }

   ResetLastError();

   if(!SymbolSelect(sym, true))
   {
      Print("GoldAITrader: SymbolSelect failed during initialization. error=", GetLastError(),
            " symbol=", sym);
      return INIT_FAILED;
   }

   if(TimerSeconds < 1)
   {
      Print("GoldAITrader: TimerSeconds must be >= 1. current=", TimerSeconds);
      return INIT_FAILED;
   }

   if(RequestTimeoutMs < 1000)
   {
      Print("GoldAITrader: RequestTimeoutMs must be >= 1000. current=", RequestTimeoutMs);
      return INIT_FAILED;
   }

   ResetLastError();

   if(!EventSetTimer(TimerSeconds))
   {
      Print("GoldAITrader: EventSetTimer failed. error=", GetLastError(),
            " timer=", TimerSeconds);
      return INIT_FAILED;
   }

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   double tickSize = MarketInfo(sym, MODE_TICKSIZE);
   double tickValue = MarketInfo(sym, MODE_TICKVALUE);
   double minLot = MarketInfo(sym, MODE_MINLOT);
   double lotStep = MarketInfo(sym, MODE_LOTSTEP);

   Print(
      "GoldAITrader initialized.",
      " symbol=", sym,
      " digits=", digits,
      " point=", DoubleToString(point, 10),
      " tickSize=", DoubleToString(tickSize, 10),
      " tickValue=", DoubleToString(tickValue, 8),
      " minLot=", DoubleToString(minLot, 8),
      " lotStep=", DoubleToString(lotStep, 8),
      " autoOrders=", (AllowAutoOrders ? "requested-but-disabled" : "off")
   );

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
}
