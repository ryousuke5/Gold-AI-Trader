#property strict
#property version   "1.2"
#property description "XAUUSD AI Trader V1 - XM MT4 analysis bridge. Auto trading is intentionally disabled."

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
   if(StringFind(ApiBaseUrl, "https://") != 0)
   {
      Print("GoldAITrader: ApiBaseUrl must start with https://");
      return false;
   }

   if(StringLen(TrimText(ApiKey)) < 16 || ApiKey == "CHANGE_ME")
   {
      Print("GoldAITrader: ApiKey is not configured.");
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

   StringConcatenate(
      json,
      "{",
      "\"symbol\":\"", JsonEscape(sym), "\",",
      "\"timeframe\":\"M5\",",
      "\"features\":{",
         "\"bid\":", JsonNumber(bid, digits), ",",
         "\"ask\":", JsonNumber(ask, digits), ",",
         "\"point\":", JsonNumber(point, digits), ",",
         "\"spread\":", JsonNumber(spread, digits), ",",
         "\"spread_points\":", JsonNumber(spreadPoints, 2), ",",
         "\"bar_time\":", IntegerToString((int)closedBarTime), ",",
         "\"m5\":{",
            "\"ema20\":", JsonNumber(m5Ema20, digits), ",",
            "\"ema50\":", JsonNumber(m5Ema50, digits), ",",
            "\"rsi14\":", JsonNumber(m5Rsi14, 2), ",",
            "\"atr14\":", JsonNumber(m5Atr14, digits), ",",
            "\"high20\":", JsonNumber(m5High20, digits), ",",
            "\"low20\":", JsonNumber(m5Low20, digits),
         "},",
         "\"h1\":{",
            "\"ema20\":", JsonNumber(h1Ema20, digits), ",",
            "\"ema50\":", JsonNumber(h1Ema50, digits), ",",
            "\"ema200\":", JsonNumber(h1Ema200, digits), ",",
            "\"rsi14\":", JsonNumber(h1Rsi14, 2), ",",
            "\"atr14\":", JsonNumber(h1Atr14, digits),
         "},",
         "\"recent_m5\":[],",
         "\"recent_h1\":[]",
      "},",
      "\"account\":{",
         "\"equity\":", JsonNumber(equity, 2), ",",
         "\"balance\":", JsonNumber(balance, 2), ",",
         "\"open_positions\":", IntegerToString(OpenPositions(sym)), ",",
         "\"daily_pnl_pct\":", JsonNumber(dailyPnlPct, 4), ",",
         "\"drawdown_pct\":", JsonNumber(drawdownPct, 4), ",",
         "\"tick_size\":", JsonNumber(tickSize, digits), ",",
         "\"tick_value\":", JsonNumber(tickValue, 8), ",",
         "\"min_lot\":", JsonNumber(minLot, 8), ",",
         "\"max_lot\":", JsonNumber(maxLot, 8), ",",
         "\"lot_step\":", JsonNumber(lotStep, 8), ",",
         "\"point\":", JsonNumber(point, digits), ",",
         "\"digits\":", IntegerToString(digits), ",",
         "\"stop_level_points\":", IntegerToString(stopLevelPoints), ",",
         "\"freeze_level_points\":", IntegerToString(freezeLevelPoints), ",",
         "\"trade_allowed\":", IntegerToString(tradeAllowed), ",",
         "\"risk_data_ready\":", (riskDataReady ? "true" : "false"),
      "}",
      "}"
   );

   payload = json;
   return true;
}

//---------------------------------------------------------
// HTTP
//---------------------------------------------------------
bool PostJson(string path, string payload, string &response)
{
   string url = ApiBaseUrl + path;

   string headers = "";
   StringConcatenate(
      headers,
      "Content-Type: application/json\r\n",
      "X-Gold-API-Key: ", ApiKey, "\r\n",
      "X-Request-Id: ", IntegerToString((int)GetTickCount()), "\r\n"
   );

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

   g_lastClosedM5Bar = closedBar;

   string payload = "";
   string response = "";

   if(!BuildSignalPayload(payload))
      return;

   if(PostJson("/api/gold/signal", payload, response))
   {
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

   if(!IsValidApiConfiguration())
      return INIT_FAILED;

   if(!IsGoldSymbol(sym))
   {
      Print("GoldAITrader: chart symbol is not recognized as gold: ", sym);
      return INIT_FAILED;
   }

   if(!SymbolSelect(sym, true))
      return INIT_FAILED;

   if(TimerSeconds < 1)
      return INIT_FAILED;

   if(RequestTimeoutMs < 1000)
      return INIT_FAILED;

   ResetLastError();

   if(!EventSetTimer(TimerSeconds))
   {
      Print("GoldAITrader: EventSetTimer failed. error=", GetLastError());
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
