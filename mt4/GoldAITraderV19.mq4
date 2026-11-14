#property strict
#property version   "1.9"
#property description "XAUUSD AI Trader V1.9 - XM MT4 analysis bridge with market safety gate. Auto trading is intentionally disabled."

input string ApiBaseUrl = "https://gold-ai-trader-1.onrender.com";
input string ApiKey = "CHANGE_ME";
input string SymbolName = "";
input bool   RequireGoldSymbol = true;
input bool   EnableSignalRequests = true;
input bool   RunAITestOnce = false;
input bool   AllowAutoOrders = false;
// Research-only virtual position recorder. Off by default; never sends trade orders.
input bool   EnableForwardShadowTelemetry = false;
input string ForwardShadowApiBaseUrl = "";
input string ForwardShadowApiKey = "";
input double ForwardShadowExpectedStopSlippagePrice = 0.05;
input string ForwardShadowCostModelVersion = "XM_KIWAMI_ENTRY_SPREAD_PROXY_CONFIGURED_SLIP_V1";
input int    TimerSeconds = 1;
input int    MagicNumber = 26092801;
input double MaxSpreadPrice = 0.50;
input int    RequestTimeoutMs = 8000;
input int    MarketReopenGapSeconds = 7200;
input int    MarketReopenLockMinutes = 30;
input double MaxTickJumpPrice = 3.00;
input double TickRecoveryBandPrice = 0.50;
input int    TickRecoverySamples = 3;
input int    MaxQuoteAgeSeconds = 30;
input bool   EnableSafetyHeartbeat = true;
input int    SafetyHeartbeatSeconds = 15;

datetime g_lastClosedM5Bar = 0;
datetime g_lastAttemptedM5Bar = 0;
datetime g_lastAttemptAt = 0;
int g_retrySeconds = 30;
bool g_apiConfigReady = false;
bool g_apiConfigWarningLogged = false;
string g_signalFlowStatus = "INITIALIZING";
string g_signalFlowReason = "not_started";

datetime g_lastObservedTickUtc = 0;
datetime g_lastSafetyHeartbeatAttemptUtc = 0;
double g_lastAcceptedMid = 0.0;
datetime g_reopenLockUntilUtc = 0;
bool g_tickAnomalyActive = false;
double g_recoveryMid = 0.0;
int g_recoveryStableCount = 0;
double g_marketSafetyBid = 0.0;
double g_marketSafetyAsk = 0.0;
double g_marketSafetyMid = 0.0;
double g_marketSafetySpread = 0.0;
datetime g_marketSafetyQuoteTimeUtc = 0;
bool g_marketSafetyAllowed = false;
string g_marketSafetyReason = "not_initialized";
string g_lastMarketSafetyLog = "";

// One virtual shadow position only. No broker order/ticket is created.
bool g_shadowActive = false;
bool g_shadowRecovered = false;
string g_shadowEntryId = "";
int g_shadowSide = 0; // BUY=1, SELL=-1
double g_shadowEntryPrice = 0.0;
double g_shadowSignalBid = 0.0;
double g_shadowStopBid = 0.0;
double g_shadowTargetBid = 0.0;
double g_shadowExpectedStopFill = 0.0;
double g_shadowEffectiveRisk = 0.0;
double g_shadowEntryBid = 0.0;
double g_shadowEntryAsk = 0.0;
double g_shadowEntrySpread = 0.0;
datetime g_shadowSignalTimeUtc = 0;
datetime g_shadowEntryTimeUtc = 0;
datetime g_shadowCurrentBarOpenServer = 0;
datetime g_shadowCurrentBarStartUtc = 0;
datetime g_shadowLastTickUtc = 0;
int g_shadowBarsSinceEntry = 0;
double g_shadowBidOpen = 0.0, g_shadowBidHigh = 0.0, g_shadowBidLow = 0.0, g_shadowBidClose = 0.0;
double g_shadowAskOpen = 0.0, g_shadowAskHigh = 0.0, g_shadowAskLow = 0.0, g_shadowAskClose = 0.0;

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
// Convert broker-server candle timestamps to UTC before sending to the API.
// TimeGMT follows the terminal computer's clock settings, so the PC clock must be synchronized.
bool GetServerUtcOffsetSeconds(int &offsetSeconds)
{
   datetime serverNow = TimeCurrent();
   datetime utcNow = TimeGMT();
   if(serverNow <= 0 || utcNow <= 0)
      return false;

   int rawOffset = (int)(serverNow - utcNow);
   int roundedOffset = (int)(MathRound((double)rawOffset / 900.0) * 900.0);

   // Accept quarter-hour offsets only; fail closed if the machine clock or broker offset looks wrong.
   if(MathAbs(rawOffset - roundedOffset) > 120 || MathAbs(roundedOffset) > 14 * 3600)
      return false;

   offsetSeconds = roundedOffset;
   return true;
}

string ServerTimeUtcEpochJson(datetime serverTime)
{
   int offsetSeconds = 0;
   if(serverTime <= 0 || !GetServerUtcOffsetSeconds(offsetSeconds))
      return "null";
   return IntegerToString((int)(serverTime - offsetSeconds));
}

string MarketSafetyKey(string suffix)
{
   string sym = TradeSymbol();
   StringReplace(sym, "#", "_");
   StringReplace(sym, ".", "_");
   return "GTV19:" + IntegerToString(AccountNumber()) + ":" + StringSubstr(sym, 0, 10) + ":" + suffix;
}

void LoadMarketSafetyState()
{
   string key = MarketSafetyKey("LAST_TICK_UTC");
   bool hasPersistedTick = GlobalVariableCheck(key);
   if(hasPersistedTick) g_lastObservedTickUtc = (datetime)GlobalVariableGet(key);
   else
   {
      g_reopenLockUntilUtc = TimeGMT() + 30 * 60;
      Print("[GOLD MARKET SAFETY] first_startup_warmup_started duration_minutes=30");
   }
   key = MarketSafetyKey("LAST_MID");
   if(GlobalVariableCheck(key)) g_lastAcceptedMid = GlobalVariableGet(key);
   key = MarketSafetyKey("REOPEN_LOCK_UTC");
   if(GlobalVariableCheck(key))
   {
      datetime persistedLockUntil = (datetime)GlobalVariableGet(key);
      if(persistedLockUntil > g_reopenLockUntilUtc)
         g_reopenLockUntilUtc = persistedLockUntil;
   }
   key = MarketSafetyKey("ANOMALY_ACTIVE");
   if(GlobalVariableCheck(key)) g_tickAnomalyActive = (GlobalVariableGet(key) > 0.5);
   key = MarketSafetyKey("RECOVERY_MID");
   if(GlobalVariableCheck(key)) g_recoveryMid = GlobalVariableGet(key);
   key = MarketSafetyKey("RECOVERY_COUNT");
   if(GlobalVariableCheck(key)) g_recoveryStableCount = (int)GlobalVariableGet(key);
}

void SaveMarketSafetyState()
{
   GlobalVariableSet(MarketSafetyKey("LAST_TICK_UTC"), (double)g_lastObservedTickUtc);
   GlobalVariableSet(MarketSafetyKey("LAST_MID"), g_lastAcceptedMid);
   GlobalVariableSet(MarketSafetyKey("REOPEN_LOCK_UTC"), (double)g_reopenLockUntilUtc);
   GlobalVariableSet(MarketSafetyKey("ANOMALY_ACTIVE"), g_tickAnomalyActive ? 1.0 : 0.0);
   GlobalVariableSet(MarketSafetyKey("RECOVERY_MID"), g_recoveryMid);
   GlobalVariableSet(MarketSafetyKey("RECOVERY_COUNT"), (double)g_recoveryStableCount);
}

void UpdateMarketSafety(string sym)
{
   RefreshRates();
   int offsetSeconds = 0;
   bool offsetOk = GetServerUtcOffsetSeconds(offsetSeconds);
   datetime nowUtc = TimeGMT();
   datetime tickServerTime = (datetime)MarketInfo(sym, MODE_TIME);
   datetime tickUtc = 0;
   if(offsetOk && tickServerTime > 0)
      tickUtc = tickServerTime - offsetSeconds;

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   int reopenGapSeconds = MathMax(1800, MathMin(7200, MarketReopenGapSeconds));
   int reopenLockMinutes = MathMax(30, MarketReopenLockMinutes);
   double maxSpreadPrice = MathMin(0.50, MathMax(0.0, MaxSpreadPrice));
   double maxTickJumpPrice = MathMin(3.00, MathMax(0.01, MaxTickJumpPrice));
   double recoveryBandPrice = MathMin(0.50, MathMax(0.01, TickRecoveryBandPrice));
   int recoverySamplesRequired = MathMax(3, TickRecoverySamples);
   int maxQuoteAgeSeconds = MathMin(30, MathMax(1, MaxQuoteAgeSeconds));
   g_marketSafetyBid = MarketInfo(sym, MODE_BID);
   g_marketSafetyAsk = MarketInfo(sym, MODE_ASK);
   g_marketSafetySpread = g_marketSafetyAsk - g_marketSafetyBid;
   g_marketSafetyMid = (g_marketSafetyBid + g_marketSafetyAsk) / 2.0;
   g_marketSafetyQuoteTimeUtc = tickUtc;

   string reason = "ok";
   bool quoteValid = (g_marketSafetyBid > 0.0 &&
                      g_marketSafetyAsk >= g_marketSafetyBid &&
                      g_marketSafetySpread >= 0.0 &&
                      g_marketSafetyMid > 0.0);

   if(!offsetOk)
      reason = "server_utc_offset_invalid";
   else if(!quoteValid || tickUtc <= 0)
      reason = "quote_invalid";
   else
   {
      int quoteAgeSeconds = (int)(nowUtc - tickUtc);
      if(quoteAgeSeconds < -10)
         reason = "quote_time_invalid";
      else if(quoteAgeSeconds > maxQuoteAgeSeconds)
         reason = "quote_stale";

      if(g_lastObservedTickUtc > 0 && tickUtc < g_lastObservedTickUtc)
         reason = "tick_time_reversed";

      if(tickUtc > g_lastObservedTickUtc)
      {
         if(g_lastObservedTickUtc > 0 &&
            (tickUtc - g_lastObservedTickUtc) >= reopenGapSeconds)
         {
            g_reopenLockUntilUtc = tickUtc + reopenLockMinutes * 60;
            Print("[GOLD MARKET SAFETY] weekly_reopen_lock_started gap_seconds=",
                  (int)(tickUtc - g_lastObservedTickUtc),
                  " lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS),
                  " duration_minutes=", reopenLockMinutes);
         }
         else if(g_lastObservedTickUtc <= 0 &&
                 TimeDayOfWeek(nowUtc) == 0 &&
                 TimeHour(nowUtc) >= 20 &&
                 TimeHour(nowUtc) <= 23)
         {
            // First install / lost terminal state fallback around the observed Sunday reopen window.
            g_reopenLockUntilUtc = nowUtc + reopenLockMinutes * 60;
            Print("[GOLD MARKET SAFETY] first_observation_sunday_reopen_lock_started");
         }

         if(g_tickAnomalyActive)
         {
            if(g_marketSafetySpread <= maxSpreadPrice &&
               MathAbs(g_marketSafetyMid - g_recoveryMid) <= recoveryBandPrice)
            {
               g_recoveryStableCount++;
               g_recoveryMid = g_marketSafetyMid;
            }
            else
            {
               g_recoveryMid = g_marketSafetyMid;
               g_recoveryStableCount = (g_marketSafetySpread <= maxSpreadPrice ? 1 : 0);
            }

            if(g_recoveryStableCount >= recoverySamplesRequired)
            {
               g_tickAnomalyActive = false;
               g_lastAcceptedMid = g_marketSafetyMid;
               g_recoveryStableCount = 0;
               Print("[GOLD MARKET SAFETY] tick_anomaly_recovered stable_ticks=",
                     recoverySamplesRequired,
                     " mid=", DoubleToString(g_marketSafetyMid, digits));
            }
         }
         else if(g_lastAcceptedMid > 0.0 &&
                 MathAbs(g_marketSafetyMid - g_lastAcceptedMid) > maxTickJumpPrice)
         {
            g_tickAnomalyActive = true;
            g_recoveryMid = g_marketSafetyMid;
            g_recoveryStableCount = (g_marketSafetySpread <= maxSpreadPrice ? 1 : 0);
            Print("[GOLD MARKET SAFETY] tick_anomaly_detected previous_mid=",
                  DoubleToString(g_lastAcceptedMid, digits),
                  " current_mid=", DoubleToString(g_marketSafetyMid, digits),
                  " jump=", DoubleToString(MathAbs(g_marketSafetyMid - g_lastAcceptedMid), digits),
                  " threshold=", DoubleToString(maxTickJumpPrice, digits));
         }
         else
         {
            g_lastAcceptedMid = g_marketSafetyMid;
         }

         g_lastObservedTickUtc = tickUtc;
         SaveMarketSafetyState();
      }

      if(reason == "ok" && g_reopenLockUntilUtc > nowUtc)
         reason = "market_reopen_lock";
      if(reason == "ok" && g_tickAnomalyActive)
         reason = "tick_anomaly_recovery";
      if(reason == "ok" && g_marketSafetySpread > maxSpreadPrice)
         reason = "spread_too_wide";
   }

   g_marketSafetyAllowed = (reason == "ok");
   g_marketSafetyReason = reason;

   string logState = (g_marketSafetyAllowed ? "allowed" : "blocked") + ":" + g_marketSafetyReason;
   if(logState != g_lastMarketSafetyLog)
   {
      Print("[GOLD MARKET SAFETY] state=", logState,
            " spread=", DoubleToString(g_marketSafetySpread, digits),
            " quote_age_seconds=", (tickUtc > 0 ? (int)(nowUtc - tickUtc) : -1),
            " stable_ticks=", g_recoveryStableCount,
            " anomaly_active=", (g_tickAnomalyActive ? "true" : "false"),
            " reopen_lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS));
      g_lastMarketSafetyLog = logState;
   }
}

// Build API payload
//---------------------------------------------------------
bool BuildSignalPayload(string &payload)
{
   string sym = TradeSymbol();

   if(!SymbolReady(sym))
      return false;

   RefreshRates();

   int serverUtcOffsetSeconds = 0;
   if(!GetServerUtcOffsetSeconds(serverUtcOffsetSeconds))
   {
      Print("GoldAITrader: UTC offset validation failed; skipping signal request.");
      return false;
   }

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   double bid = g_marketSafetyBid;
   double ask = g_marketSafetyAsk;
   double spread = g_marketSafetySpread;
   double spreadPoints = 0.0;

   if(spread > MaxSpreadPrice)
      Print("GoldAITrader: spread is above local observation threshold. spread=", DoubleToString(spread, digits), " max=", DoubleToString(MaxSpreadPrice, digits));

   if(point > 0.0)
      spreadPoints = spread / point;

   datetime closedBarOpen = iTime(sym, PERIOD_M5, 1);
   if(closedBarOpen <= 0)
      return false;

   datetime closedBarTime = closedBarOpen + 300;
   datetime closedBarTimeUtc = closedBarTime - serverUtcOffsetSeconds;
   // Log enough information to verify UTC conversion in MT4's Experts log before API deployment.
   Print("[GOLD UTC DIAG] server_utc_offset_seconds=", serverUtcOffsetSeconds,
         " server_time=", TimeToString(TimeCurrent(), TIME_DATE|TIME_SECONDS),
         " terminal_gmt=", TimeToString(TimeGMT(), TIME_DATE|TIME_SECONDS),
         " bar_time_utc=", TimeToString(closedBarTimeUtc, TIME_DATE|TIME_SECONDS),
         " bar_time_epoch=", IntegerToString((int)closedBarTimeUtc));

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
   json += "\"market_safety\":{";
   json += "\"allowed\":" + (g_marketSafetyAllowed ? "true" : "false") + ",";
   json += "\"reason\":\"" + JsonEscape(g_marketSafetyReason) + "\",";
   json += "\"quote_time_utc\":" + IntegerToString((int)g_marketSafetyQuoteTimeUtc) + ",";
   json += "\"mid_price\":" + JsonNumber(g_marketSafetyMid, digits) + ",";
   json += "\"spread_price\":" + JsonNumber(g_marketSafetySpread, digits) + ",";
   json += "\"stable_tick_count\":" + IntegerToString(g_recoveryStableCount) + ",";
   json += "\"anomaly_active\":" + (g_tickAnomalyActive ? "true" : "false") + ",";
   json += "\"reopen_lock_until_utc\":" + IntegerToString((int)g_reopenLockUntilUtc);
   json += "},";
   json += "\"features\":{";
   json += "\"bid\":" + JsonNumber(bid, digits) + ",";
   json += "\"ask\":" + JsonNumber(ask, digits) + ",";
   json += "\"point\":" + JsonNumber(point, digits) + ",";
   json += "\"spread\":" + JsonNumber(spread, digits) + ",";
   json += "\"spread_points\":" + JsonNumber(spreadPoints, 2) + ",";
   json += "\"server_utc_offset_seconds\":" + IntegerToString(serverUtcOffsetSeconds) + ",";
   // Send the completed M5 close time as UTC epoch seconds.
   json += "\"bar_time\":" + IntegerToString((int)closedBarTimeUtc) + ",";
   json += "\"m5\":{";
   json += "\"ema20\":" + JsonNumber(m5Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(m5Ema50, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(m5Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(m5Atr14, digits) + ",";
   json += "\"high20\":" + JsonNumber(m5High20, digits) + ",";
   json += "\"low20\":" + JsonNumber(m5Low20, digits);
   json += "},";
   json += "\"h1\":{";
   json += "\"close\":" + JsonNumber(iClose(sym, PERIOD_H1, 1), digits) + ",";
   json += "\"ema20\":" + JsonNumber(h1Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(h1Ema50, digits) + ",";
   json += "\"ema200\":" + JsonNumber(h1Ema200, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(h1Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(h1Atr14, digits);
   json += "},";

   // Send the completed M5/H1 bars required by GOLD V2. Times are close-times,
   // matching the backtest convention and preventing the current forming bar from entering the setup.
   json += "\"recent_m5\":[";
   bool firstM5 = true;
   for(int shiftM5 = 24; shiftM5 >= 1; shiftM5--)
   {
      datetime barOpenM5 = iTime(sym, PERIOD_M5, shiftM5);
      if(barOpenM5 <= 0)
         continue;

      if(!firstM5)
         json += ",";

      json += "{\"time\":" + IntegerToString((int)(barOpenM5 + 300 - serverUtcOffsetSeconds));
      json += ",\"open\":" + JsonNumber(iOpen(sym, PERIOD_M5, shiftM5), digits);
      json += ",\"high\":" + JsonNumber(iHigh(sym, PERIOD_M5, shiftM5), digits);
      json += ",\"low\":" + JsonNumber(iLow(sym, PERIOD_M5, shiftM5), digits);
      json += ",\"close\":" + JsonNumber(iClose(sym, PERIOD_M5, shiftM5), digits);
      json += ",\"volume\":" + JsonNumber(iVolume(sym, PERIOD_M5, shiftM5), 0);
      json += "}";
      firstM5 = false;
   }
   json += "],";

   json += "\"recent_h1\":[";
   bool firstH1 = true;
   for(int shiftH1 = 24; shiftH1 >= 1; shiftH1--)
   {
      datetime barOpenH1 = iTime(sym, PERIOD_H1, shiftH1);
      if(barOpenH1 <= 0)
         continue;

      if(!firstH1)
         json += ",";

      json += "{\"time\":" + IntegerToString((int)(barOpenH1 + 3600 - serverUtcOffsetSeconds));
      json += ",\"open\":" + JsonNumber(iOpen(sym, PERIOD_H1, shiftH1), digits);
      json += ",\"high\":" + JsonNumber(iHigh(sym, PERIOD_H1, shiftH1), digits);
      json += ",\"low\":" + JsonNumber(iLow(sym, PERIOD_H1, shiftH1), digits);
      json += ",\"close\":" + JsonNumber(iClose(sym, PERIOD_H1, shiftH1), digits);
      json += ",\"volume\":" + JsonNumber(iVolume(sym, PERIOD_H1, shiftH1), 0);
      // H1 EMA/ATR values are calculated on the same completed candle (shift >= 1).
      json += ",\"ema20\":" + JsonNumber(iMA(sym, PERIOD_H1, 20, 0, MODE_EMA, PRICE_CLOSE, shiftH1), digits);
      json += ",\"ema50\":" + JsonNumber(iMA(sym, PERIOD_H1, 50, 0, MODE_EMA, PRICE_CLOSE, shiftH1), digits);
      json += ",\"ema200\":" + JsonNumber(iMA(sym, PERIOD_H1, 200, 0, MODE_EMA, PRICE_CLOSE, shiftH1), digits);
      json += ",\"atr14\":" + JsonNumber(iATR(sym, PERIOD_H1, 14, shiftH1), digits);
      json += "}";
      firstH1 = false;
   }
   json += "]";
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

   if(StringFind(path, "/api/gold/market-safety") < 0)
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
// Research-only Forward/Paper shadow telemetry. No trading functions.
//---------------------------------------------------------
bool JsonFindValueStart(string json, string key, int &valueStart)
{
   string marker = "\"" + key + "\"";
   int keyPos = StringFind(json, marker);
   if(keyPos < 0) return false;
   int colon = StringFind(json, ":", keyPos + StringLen(marker));
   if(colon < 0) return false;
   int pos = colon + 1;
   while(pos < StringLen(json))
   {
      int ch = StringGetCharacter(json, pos);
      if(ch != 32 && ch != 9 && ch != 10 && ch != 13) break;
      pos++;
   }
   if(pos >= StringLen(json)) return false;
   valueStart = pos;
   return true;
}

bool JsonExtractObjectField(string json, string key, string &objectJson)
{
   objectJson = "";
   int start = 0;
   if(!JsonFindValueStart(json, key, start)) return false;
   if(StringGetCharacter(json, start) != 123) return false;

   int depth = 0;
   bool inString = false;
   bool escaped = false;
   for(int i = start; i < StringLen(json); i++)
   {
      int ch = StringGetCharacter(json, i);
      if(inString)
      {
         if(escaped) escaped = false;
         else if(ch == 92) escaped = true;
         else if(ch == 34) inString = false;
         continue;
      }
      if(ch == 34) inString = true;
      else if(ch == 123) depth++;
      else if(ch == 125)
      {
         depth--;
         if(depth == 0)
         {
            objectJson = StringSubstr(json, start, i - start + 1);
            return true;
         }
      }
   }
   return false;
}

bool JsonExtractStringField(string json, string key, string &value)
{
   value = "";
   int start = 0;
   if(!JsonFindValueStart(json, key, start)) return false;
   if(StringGetCharacter(json, start) != 34) return false;
   bool escaped = false;
   for(int i = start + 1; i < StringLen(json); i++)
   {
      int ch = StringGetCharacter(json, i);
      if(escaped)
      {
         if(ch == 34 || ch == 92 || ch == 47) value += CharToString((uchar)ch);
         else if(ch == 110) value += "\n";
         else if(ch == 114) value += "\r";
         else if(ch == 116) value += "\t";
         else value += CharToString((uchar)ch);
         escaped = false;
      }
      else if(ch == 92) escaped = true;
      else if(ch == 34) return true;
      else value += CharToString((uchar)ch);
   }
   return false;
}

bool JsonExtractNumberField(string json, string key, double &value)
{
   value = 0.0;
   int start = 0;
   if(!JsonFindValueStart(json, key, start)) return false;
   int end = start;
   while(end < StringLen(json))
   {
      int ch = StringGetCharacter(json, end);
      if(ch == 44 || ch == 125 || ch == 93 || ch == 32 || ch == 9 || ch == 10 || ch == 13) break;
      end++;
   }
   if(end <= start) return false;
   string raw = TrimText(StringSubstr(json, start, end - start));
   if(raw == "" || raw == "null") return false;
   value = StringToDouble(raw);
   return true;
}

bool JsonExtractBoolField(string json, string key, bool &value)
{
   value = false;
   int start = 0;
   if(!JsonFindValueStart(json, key, start)) return false;
   string raw = StringSubstr(json, start, 5);
   if(StringSubstr(raw, 0, 4) == "true") { value = true; return true; }
   if(StringSubstr(raw, 0, 5) == "false") { value = false; return true; }
   return false;
}

string UtcIsoFromEpoch(datetime epochUtc)
{
   if(epochUtc <= 0) return "";
   MqlDateTime dt;
   if(!TimeToStruct(epochUtc, dt)) return "";
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
}

datetime CurrentQuoteTimeUtc(string sym)
{
   datetime serverTime = (datetime)MarketInfo(sym, MODE_TIME);
   int offsetSeconds = 0;
   if(serverTime <= 0 || !GetServerUtcOffsetSeconds(offsetSeconds)) return 0;
   return serverTime - offsetSeconds;
}

string UrlHostOnly(string url)
{
   string value = TrimText(url);
   if(StringFind(value, "https://") == 0) value = StringSubstr(value, 8);
   else if(StringFind(value, "http://") == 0) value = StringSubstr(value, 7);
   int slash = StringFind(value, "/");
   if(slash >= 0) value = StringSubstr(value, 0, slash);
   StringToLower(value);
   return value;
}

string ShadowGlobalKey(string suffix)
{
   return MarketSafetyKey("SHADOW_" + suffix);
}

string BuildShadowEntryId()
{
   string sym = TradeSymbol();
   StringReplace(sym, "#", "_");
   StringReplace(sym, ".", "_");
   return "shadow-" + IntegerToString(AccountNumber()) + "-" +
          StringSubstr(sym, 0, 10) + "-" +
          IntegerToString((int)g_shadowSignalTimeUtc) + "-" +
          (g_shadowSide > 0 ? "BUY" : "SELL");
}

void PersistShadowState()
{
   if(!g_shadowActive) return;
   GlobalVariableSet(ShadowGlobalKey("ACTIVE"), 1.0);
   GlobalVariableSet(ShadowGlobalKey("SIDE"), (double)g_shadowSide);
   GlobalVariableSet(ShadowGlobalKey("ENTRY_PRICE"), g_shadowEntryPrice);
   GlobalVariableSet(ShadowGlobalKey("SIGNAL_BID"), g_shadowSignalBid);
   GlobalVariableSet(ShadowGlobalKey("STOP_BID"), g_shadowStopBid);
   GlobalVariableSet(ShadowGlobalKey("TARGET_BID"), g_shadowTargetBid);
   GlobalVariableSet(ShadowGlobalKey("EXPECTED_STOP_FILL"), g_shadowExpectedStopFill);
   GlobalVariableSet(ShadowGlobalKey("EFFECTIVE_RISK"), g_shadowEffectiveRisk);
   GlobalVariableSet(ShadowGlobalKey("ENTRY_BID"), g_shadowEntryBid);
   GlobalVariableSet(ShadowGlobalKey("ENTRY_ASK"), g_shadowEntryAsk);
   GlobalVariableSet(ShadowGlobalKey("ENTRY_SPREAD"), g_shadowEntrySpread);
   GlobalVariableSet(ShadowGlobalKey("SIGNAL_UTC"), (double)g_shadowSignalTimeUtc);
   GlobalVariableSet(ShadowGlobalKey("ENTRY_UTC"), (double)g_shadowEntryTimeUtc);
   GlobalVariableSet(ShadowGlobalKey("BAR_OPEN_SERVER"), (double)g_shadowCurrentBarOpenServer);
   GlobalVariableSet(ShadowGlobalKey("BAR_START_UTC"), (double)g_shadowCurrentBarStartUtc);
   GlobalVariableSet(ShadowGlobalKey("LAST_TICK_UTC"), (double)g_shadowLastTickUtc);
   GlobalVariableSet(ShadowGlobalKey("BARS_COUNT"), (double)g_shadowBarsSinceEntry);
   GlobalVariableSet(ShadowGlobalKey("BID_OPEN"), g_shadowBidOpen);
   GlobalVariableSet(ShadowGlobalKey("BID_HIGH"), g_shadowBidHigh);
   GlobalVariableSet(ShadowGlobalKey("BID_LOW"), g_shadowBidLow);
   GlobalVariableSet(ShadowGlobalKey("BID_CLOSE"), g_shadowBidClose);
   GlobalVariableSet(ShadowGlobalKey("ASK_OPEN"), g_shadowAskOpen);
   GlobalVariableSet(ShadowGlobalKey("ASK_HIGH"), g_shadowAskHigh);
   GlobalVariableSet(ShadowGlobalKey("ASK_LOW"), g_shadowAskLow);
   GlobalVariableSet(ShadowGlobalKey("ASK_CLOSE"), g_shadowAskClose);
}

double ShadowGlobal(string suffix, double fallback = 0.0)
{
   string key = ShadowGlobalKey(suffix);
   if(!GlobalVariableCheck(key)) return fallback;
   return GlobalVariableGet(key);
}

void LoadShadowState()
{
   if(!EnableForwardShadowTelemetry) return;
   if(ShadowGlobal("ACTIVE", 0.0) < 0.5) return;
   g_shadowSide = (int)ShadowGlobal("SIDE");
   g_shadowEntryPrice = ShadowGlobal("ENTRY_PRICE");
   g_shadowSignalBid = ShadowGlobal("SIGNAL_BID");
   g_shadowStopBid = ShadowGlobal("STOP_BID");
   g_shadowTargetBid = ShadowGlobal("TARGET_BID");
   g_shadowExpectedStopFill = ShadowGlobal("EXPECTED_STOP_FILL");
   g_shadowEffectiveRisk = ShadowGlobal("EFFECTIVE_RISK");
   g_shadowEntryBid = ShadowGlobal("ENTRY_BID");
   g_shadowEntryAsk = ShadowGlobal("ENTRY_ASK");
   g_shadowEntrySpread = ShadowGlobal("ENTRY_SPREAD");
   g_shadowSignalTimeUtc = (datetime)ShadowGlobal("SIGNAL_UTC");
   g_shadowEntryTimeUtc = (datetime)ShadowGlobal("ENTRY_UTC");
   g_shadowCurrentBarOpenServer = (datetime)ShadowGlobal("BAR_OPEN_SERVER");
   g_shadowCurrentBarStartUtc = (datetime)ShadowGlobal("BAR_START_UTC");
   g_shadowLastTickUtc = (datetime)ShadowGlobal("LAST_TICK_UTC");
   g_shadowBarsSinceEntry = (int)ShadowGlobal("BARS_COUNT");
   g_shadowBidOpen = ShadowGlobal("BID_OPEN");
   g_shadowBidHigh = ShadowGlobal("BID_HIGH");
   g_shadowBidLow = ShadowGlobal("BID_LOW");
   g_shadowBidClose = ShadowGlobal("BID_CLOSE");
   g_shadowAskOpen = ShadowGlobal("ASK_OPEN");
   g_shadowAskHigh = ShadowGlobal("ASK_HIGH");
   g_shadowAskLow = ShadowGlobal("ASK_LOW");
   g_shadowAskClose = ShadowGlobal("ASK_CLOSE");
   if(g_shadowSide == 1 || g_shadowSide == -1)
   {
      g_shadowEntryId = BuildShadowEntryId();
      g_shadowActive = true;
      g_shadowRecovered = true;
      Print("[GOLD SHADOW] restored_virtual_position entry_id=", g_shadowEntryId,
            " side=", (g_shadowSide > 0 ? "BUY" : "SELL"),
            " last_tick_utc=", TimeToString(g_shadowLastTickUtc, TIME_DATE|TIME_SECONDS));
   }
}

void ClearShadowState()
{
   string suffixes[24] = {
      "ACTIVE","SIDE","ENTRY_PRICE","SIGNAL_BID","STOP_BID","TARGET_BID",
      "EXPECTED_STOP_FILL","EFFECTIVE_RISK","ENTRY_BID","ENTRY_ASK","ENTRY_SPREAD",
      "SIGNAL_UTC","ENTRY_UTC","BAR_OPEN_SERVER","BAR_START_UTC","LAST_TICK_UTC",
      "BARS_COUNT","BID_OPEN","BID_HIGH","BID_LOW","BID_CLOSE",
      "ASK_OPEN","ASK_HIGH","ASK_LOW"
   };
   for(int i = 0; i < ArraySize(suffixes); i++)
      GlobalVariableDel(ShadowGlobalKey(suffixes[i]));
   GlobalVariableDel(ShadowGlobalKey("ASK_CLOSE"));
   g_shadowActive = false;
   g_shadowRecovered = false;
   g_shadowEntryId = "";
   g_shadowSide = 0;
   g_shadowLastTickUtc = 0;
}

bool PostForwardShadowJson(string json, string &response)
{
   response = "";
   string baseUrl = TrimText(ForwardShadowApiBaseUrl);
   int baseLength = StringLen(baseUrl);
   if(baseLength > 0 && StringSubstr(baseUrl, baseLength - 1, 1) == "/")
      baseUrl = StringSubstr(baseUrl, 0, baseLength - 1);
   if(StringFind(baseUrl, "https://") != 0 ||
      UrlHostOnly(baseUrl) == UrlHostOnly(ApiBaseUrl) ||
      StringLen(TrimText(ForwardShadowApiKey)) < 16 ||
      TrimText(ForwardShadowApiKey) == "CHANGE_ME" ||
      TrimText(ForwardShadowApiKey) == TrimText(ApiKey))
   {
      Print("[GOLD SHADOW] rejected_send: require a separate HTTPS research host and API key");
      return false;
   }

   string url = baseUrl + "/api/gold/forward-shadow/event";
   string headers = "Content-Type: application/json\r\n";
   headers += "X-Gold-API-Key: " + TrimText(ForwardShadowApiKey) + "\r\n";
   headers += "X-Request-Id: shadow-" + IntegerToString((int)GetTickCount()) + "\r\n";
   uchar postData[];
   uchar result[];
   string resultHeaders = "";
   int payloadLength = StringLen(json);
   ArrayResize(postData, payloadLength);
   if(payloadLength > 0)
      StringToCharArray(json, postData, 0, payloadLength, CP_UTF8);
   ResetLastError();
   int httpCode = WebRequest("POST", url, headers, RequestTimeoutMs,
                             postData, result, resultHeaders);
   int errorCode = GetLastError();
   response = CharArrayToString(result, 0, -1, CP_UTF8);
   if(httpCode < 200 || httpCode >= 300)
   {
      Print("[GOLD SHADOW] event_post_failed HTTP=", httpCode,
            " error=", errorCode, " response=", response);
      return false;
   }
   return (StringFind(response, "\"persisted\":true") >= 0);
}

bool SendShadowGap(datetime fromUtc, datetime toUtc, string reason)
{
   if(!g_shadowActive || fromUtc <= 0 || toUtc <= fromUtc) return true;
   int seconds = (int)(toUtc - fromUtc);
   if(seconds > 2678400) return false;
   string json = "{";
   json += "\"event_type\":\"GAP\",";
   json += "\"entry_id\":\"" + JsonEscape(g_shadowEntryId) + "\",";
   json += "\"symbol\":\"" + JsonEscape(TradeSymbol()) + "\",";
   json += "\"strategy_version\":\"gold-m5-h1-v2\",";
   json += "\"side\":\"" + (g_shadowSide > 0 ? "BUY" : "SELL") + "\",";
   json += "\"payload\":{";
   json += "\"from_time_utc\":\"" + UtcIsoFromEpoch(fromUtc) + "\",";
   json += "\"to_time_utc\":\"" + UtcIsoFromEpoch(toUtc) + "\",";
   json += "\"gap_seconds\":" + IntegerToString(seconds) + ",";
   json += "\"reason\":\"" + JsonEscape(reason) + "\"";
   json += "}}";
   string response = "";
   return PostForwardShadowJson(json, response);
}

bool SendShadowBar(datetime eventTimeUtc, bool isPartial, int durationSeconds)
{
   if(!g_shadowActive || eventTimeUtc <= 0) return false;
   int duration = MathMax(1, MathMin(300, durationSeconds));
   int nextIndex = g_shadowBarsSinceEntry + 1;
   int digits = (int)MarketInfo(TradeSymbol(), MODE_DIGITS);
   double closeSpread = g_shadowAskClose - g_shadowBidClose;
   if(closeSpread < 0.0) return false;
   string json = "{";
   json += "\"event_type\":\"BAR\",";
   json += "\"entry_id\":\"" + JsonEscape(g_shadowEntryId) + "\",";
   json += "\"symbol\":\"" + JsonEscape(TradeSymbol()) + "\",";
   json += "\"strategy_version\":\"gold-m5-h1-v2\",";
   json += "\"side\":\"" + (g_shadowSide > 0 ? "BUY" : "SELL") + "\",";
   json += "\"payload\":{";
   json += "\"segments_since_entry\":" + IntegerToString(nextIndex) + ",";
   json += "\"bar_time_utc\":\"" + UtcIsoFromEpoch(eventTimeUtc) + "\",";
   json += "\"is_partial\":" + (isPartial ? "true" : "false") + ",";
   json += "\"bar_duration_seconds\":" + IntegerToString(duration) + ",";
   json += "\"bid_ohlc\":{";
   json += "\"open\":" + JsonNumber(g_shadowBidOpen, digits) + ",";
   json += "\"high\":" + JsonNumber(g_shadowBidHigh, digits) + ",";
   json += "\"low\":" + JsonNumber(g_shadowBidLow, digits) + ",";
   json += "\"close\":" + JsonNumber(g_shadowBidClose, digits) + "},";
   json += "\"ask_ohlc\":{";
   json += "\"open\":" + JsonNumber(g_shadowAskOpen, digits) + ",";
   json += "\"high\":" + JsonNumber(g_shadowAskHigh, digits) + ",";
   json += "\"low\":" + JsonNumber(g_shadowAskLow, digits) + ",";
   json += "\"close\":" + JsonNumber(g_shadowAskClose, digits) + "},";
   json += "\"spread_price\":" + JsonNumber(closeSpread, digits) + ",";
   json += "\"quote_age_seconds\":0,";
   json += "\"tick_data_quality\":\"BID_ASK_TICK_AGGREGATED\"";
   json += "}}";
   string response = "";
   bool sent = PostForwardShadowJson(json, response);
   if(sent)
   {
      g_shadowBarsSinceEntry = nextIndex;
      PersistShadowState();
   }
   return sent;
}

bool SendShadowExit(datetime exitTimeUtc, double bid, double ask, string exitReason)
{
   if(!g_shadowActive || exitTimeUtc <= 0 || bid <= 0.0 || ask < bid) return false;
   double exitFill = (g_shadowSide > 0 ? bid : ask);
   double pnlPrice = (g_shadowSide > 0 ? exitFill - g_shadowEntryPrice : g_shadowEntryPrice - exitFill);
   double quoteNetR = (g_shadowEffectiveRisk > 0.0 ? pnlPrice / g_shadowEffectiveRisk : 0.0);
   double spread = ask - bid;
   int digits = (int)MarketInfo(TradeSymbol(), MODE_DIGITS);
   string json = "{";
   json += "\"event_type\":\"EXIT\",";
   json += "\"entry_id\":\"" + JsonEscape(g_shadowEntryId) + "\",";
   json += "\"symbol\":\"" + JsonEscape(TradeSymbol()) + "\",";
   json += "\"strategy_version\":\"gold-m5-h1-v2\",";
   json += "\"side\":\"" + (g_shadowSide > 0 ? "BUY" : "SELL") + "\",";
   json += "\"payload\":{";
   json += "\"exit_time_utc\":\"" + UtcIsoFromEpoch(exitTimeUtc) + "\",";
   json += "\"exit_price\":" + JsonNumber(exitFill, digits) + ",";
   json += "\"exit_bid\":" + JsonNumber(bid, digits) + ",";
   json += "\"exit_ask\":" + JsonNumber(ask, digits) + ",";
   json += "\"exit_spread_price\":" + JsonNumber(spread, digits) + ",";
   json += "\"exit_reason\":\"" + JsonEscape(exitReason) + "\",";
   json += "\"cost_completeness\":\"QUOTE_SIDE_ONLY_EXCLUDES_COMMISSION_SWAP\",";
   json += "\"net_r\":" + JsonNumber(quoteNetR, 6) + ",";
   json += "\"holding_seconds\":" + IntegerToString((int)(exitTimeUtc - g_shadowEntryTimeUtc)) + ",";
   json += "}}";
   string response = "";
   bool sent = PostForwardShadowJson(json, response);
   if(sent)
      Print("[GOLD SHADOW] virtual_exit_saved entry_id=", g_shadowEntryId,
            " reason=", exitReason, " quote_net_r=", DoubleToString(quoteNetR, 4),
            " cost_status=QUOTE_SIDE_ONLY_EXCLUDES_COMMISSION_SWAP");
   return sent;
}

void ResetShadowBar(string sym, datetime tickUtc, double bid, double ask)
{
   int offsetSeconds = 0;
   datetime barOpenServer = iTime(sym, PERIOD_M5, 0);
   if(barOpenServer <= 0 || !GetServerUtcOffsetSeconds(offsetSeconds)) return;
   g_shadowCurrentBarOpenServer = barOpenServer;
   datetime barOpenUtc = barOpenServer - offsetSeconds;
   g_shadowCurrentBarStartUtc = (barOpenUtc > g_shadowEntryTimeUtc ? barOpenUtc : g_shadowEntryTimeUtc);
   g_shadowBidOpen = bid; g_shadowBidHigh = bid; g_shadowBidLow = bid; g_shadowBidClose = bid;
   g_shadowAskOpen = ask; g_shadowAskHigh = ask; g_shadowAskLow = ask; g_shadowAskClose = ask;
   g_shadowLastTickUtc = tickUtc;
   PersistShadowState();
}

void ResetShadowSegment(string sym, datetime tickUtc, double bid, double ask)
{
   int offsetSeconds = 0;
   if(!GetServerUtcOffsetSeconds(offsetSeconds)) return;
   g_shadowCurrentBarOpenServer = iTime(sym, PERIOD_M5, 0);
   g_shadowCurrentBarStartUtc = tickUtc;
   g_shadowBidOpen = bid; g_shadowBidHigh = bid; g_shadowBidLow = bid; g_shadowBidClose = bid;
   g_shadowAskOpen = ask; g_shadowAskHigh = ask; g_shadowAskLow = ask; g_shadowAskClose = ask;
   g_shadowLastTickUtc = tickUtc;
   PersistShadowState();
}

void UpdateShadowBarQuotes(datetime tickUtc, double bid, double ask)
{
   if(g_shadowBidOpen <= 0.0)
   {
      g_shadowBidOpen = bid; g_shadowBidHigh = bid; g_shadowBidLow = bid;
      g_shadowAskOpen = ask; g_shadowAskHigh = ask; g_shadowAskLow = ask;
   }
   if(bid > g_shadowBidHigh) g_shadowBidHigh = bid;
   if(bid < g_shadowBidLow) g_shadowBidLow = bid;
   if(ask > g_shadowAskHigh) g_shadowAskHigh = ask;
   if(ask < g_shadowAskLow) g_shadowAskLow = ask;
   g_shadowBidClose = bid;
   g_shadowAskClose = ask;
   g_shadowLastTickUtc = tickUtc;
   PersistShadowState();
}

bool StartForwardShadowFromSignal(string signalPayload, string signalResponse)
{
   if(!EnableForwardShadowTelemetry || g_shadowActive) return false;
   if(g_shadowActive || AllowAutoOrders || !g_marketSafetyAllowed) return false;
   if(TrimText(ForwardShadowApiBaseUrl) == "" ||
      StringFind(TrimText(ForwardShadowApiBaseUrl), "https://") != 0 ||
      TrimText(ForwardShadowApiBaseUrl) == TrimText(ApiBaseUrl)) return false;
   if(ForwardShadowExpectedStopSlippagePrice < 0.0 ||
      TrimText(ForwardShadowCostModelVersion) == "") return false;

   string featuresJson = "", decisionJson = "", riskJson = "", safetyJson = "", stateJson = "";
   string candidate = "", signalId = "", decisionSide = "", stateMode = "";
   if(!JsonExtractObjectField(signalPayload, "features", featuresJson) ||
      !JsonExtractObjectField(signalResponse, "decision", decisionJson) ||
      !JsonExtractObjectField(signalResponse, "risk", riskJson) ||
      !JsonExtractObjectField(signalResponse, "market_safety", safetyJson) ||
      !JsonExtractObjectField(signalResponse, "state", stateJson)) return false;
   bool riskApproved = false, safetyAllowed = false, remoteAutoTrading = true, orderAllowed = true;
   if(!JsonExtractStringField(signalResponse, "candidate", candidate) ||
      !JsonExtractStringField(signalResponse, "signal_id", signalId) ||
      !JsonExtractStringField(decisionJson, "decision", decisionSide) ||
      !JsonExtractBoolField(riskJson, "approved", riskApproved) ||
      !JsonExtractBoolField(safetyJson, "allowed", safetyAllowed) ||
      !JsonExtractStringField(stateJson, "mode", stateMode) ||
      !JsonExtractBoolField(stateJson, "auto_trading_enabled", remoteAutoTrading) ||
      !JsonExtractBoolField(signalResponse, "order_allowed", orderAllowed)) return false;
   StringToUpper(candidate);
   StringToUpper(decisionSide);
   StringToUpper(stateMode);
   int side = (candidate == "BUY" ? 1 : (candidate == "SELL" ? -1 : 0));
   if(side == 0 || decisionSide != candidate || !riskApproved || !safetyAllowed ||
      stateMode != "ANALYSIS" || remoteAutoTrading || orderAllowed) return false;

   double strategyEntry = 0.0, stopBid = 0.0, targetBid = 0.0, signalBarTimeNumber = 0.0;
   if(!JsonExtractNumberField(decisionJson, "entry", strategyEntry) ||
      !JsonExtractNumberField(decisionJson, "stop_loss", stopBid) ||
      !JsonExtractNumberField(decisionJson, "take_profit", targetBid) ||
      !JsonExtractNumberField(featuresJson, "bar_time", signalBarTimeNumber)) return false;

   datetime signalTimeUtc = (datetime)signalBarTimeNumber;
   datetime entryTimeUtc = CurrentQuoteTimeUtc(TradeSymbol());
   if(signalTimeUtc <= 0 || entryTimeUtc < signalTimeUtc ||
      entryTimeUtc - signalTimeUtc > MaxQuoteAgeSeconds) return false;
   RefreshRates();
   string sym = TradeSymbol();
   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);
   double spread = ask - bid;
   int signalOffsetSeconds = 0;
   if(!GetServerUtcOffsetSeconds(signalOffsetSeconds)) return false;
   datetime signalBarOpenServer = signalTimeUtc + signalOffsetSeconds - 300;
   int signalBarShift = iBarShift(sym, PERIOD_M5, signalBarOpenServer, true);
   if(signalBarShift < 1) return false;
   double signalBid = iClose(sym, PERIOD_M5, signalBarShift);
   if(bid <= 0.0 || ask < bid || spread > MathMin(0.50, MaxSpreadPrice) || signalBid <= 0.0) return false;

   double entryFill = (side > 0 ? ask : bid);
   double expectedStopSpread = (side > 0 ? 0.0 : spread);
   double expectedStopFill = (side > 0
      ? stopBid - ForwardShadowExpectedStopSlippagePrice
      : stopBid + expectedStopSpread + ForwardShadowExpectedStopSlippagePrice);
   if(side > 0)
   {
      if(!(stopBid < signalBid && targetBid > signalBid && targetBid > entryFill && expectedStopFill < entryFill)) return false;
   }
   else
   {
      if(!(targetBid < signalBid && stopBid > signalBid && targetBid < entryFill && expectedStopFill > entryFill)) return false;
   }
   double effectiveRisk = MathAbs(entryFill - expectedStopFill);
   if(effectiveRisk <= 0.0) return false;

   string idSymbol = sym;
   StringReplace(idSymbol, "#", "_");
   StringReplace(idSymbol, ".", "_");
   string entryId = "shadow-" + IntegerToString(AccountNumber()) + "-" +
                    StringSubstr(idSymbol, 0, 10) + "-" +
                    IntegerToString((int)signalTimeUtc) + "-" + candidate;
   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   int quoteAge = (int)MathMax(0, TimeGMT() - entryTimeUtc);
   string json = "{";
   json += "\"event_type\":\"ENTRY\",";
   json += "\"entry_id\":\"" + JsonEscape(entryId) + "\",";
   json += "\"symbol\":\"" + JsonEscape(sym) + "\",";
   json += "\"strategy_version\":\"gold-m5-h1-v2\",";
   json += "\"side\":\"" + candidate + "\",";
   json += "\"features\":" + featuresJson + ",";
   json += "\"payload\":{";
   json += "\"signal_time_utc\":\"" + UtcIsoFromEpoch(signalTimeUtc) + "\",";
   json += "\"entry_time_utc\":\"" + UtcIsoFromEpoch(entryTimeUtc) + "\",";
   json += "\"expected_entry_price\":" + JsonNumber(strategyEntry, digits) + ",";
   json += "\"entry_price\":" + JsonNumber(entryFill, digits) + ",";
   json += "\"signal_reference_bid\":" + JsonNumber(signalBid, digits) + ",";
   json += "\"stop_price\":" + JsonNumber(stopBid, digits) + ",";
   json += "\"target_price\":" + JsonNumber(targetBid, digits) + ",";
   json += "\"expected_stop_fill_price\":" + JsonNumber(expectedStopFill, digits) + ",";
   json += "\"expected_stop_spread_price\":" + JsonNumber(expectedStopSpread, digits) + ",";
   json += "\"expected_stop_slippage_price\":" + JsonNumber(ForwardShadowExpectedStopSlippagePrice, digits) + ",";
   json += "\"cost_model_version\":\"" + JsonEscape(ForwardShadowCostModelVersion) + "\",";
   json += "\"entry_bid\":" + JsonNumber(bid, digits) + ",";
   json += "\"entry_ask\":" + JsonNumber(ask, digits) + ",";
   json += "\"spread_price\":" + JsonNumber(spread, digits) + ",";
   json += "\"quote_age_seconds\":" + IntegerToString(quoteAge) + ",";
   json += "\"setup_diagnostics\":{\"source_signal_id\":\"" + JsonEscape(signalId) + "\"},";
   json += "\"market_safety\":{\"allowed\":true,\"reason\":\"" + JsonEscape(g_marketSafetyReason) + "\"}";
   json += "}}";

   string response = "";
   if(!PostForwardShadowJson(json, response)) return false;

   g_shadowActive = true;
   g_shadowRecovered = false;
   g_shadowEntryId = entryId;
   g_shadowSide = side;
   g_shadowEntryPrice = entryFill;
   g_shadowSignalBid = signalBid;
   g_shadowStopBid = stopBid;
   g_shadowTargetBid = targetBid;
   g_shadowExpectedStopFill = expectedStopFill;
   g_shadowEffectiveRisk = effectiveRisk;
   g_shadowEntryBid = bid;
   g_shadowEntryAsk = ask;
   g_shadowEntrySpread = spread;
   g_shadowSignalTimeUtc = signalTimeUtc;
   g_shadowEntryTimeUtc = entryTimeUtc;
   g_shadowBarsSinceEntry = 0;
   ResetShadowBar(sym, entryTimeUtc, bid, ask);
   Print("[GOLD SHADOW] virtual_entry_saved entry_id=", g_shadowEntryId,
         " side=", candidate,
         " entry=", DoubleToString(entryFill, digits),
         " stop_bid=", DoubleToString(stopBid, digits),
         " target_bid=", DoubleToString(targetBid, digits),
         " effective_R_price=", DoubleToString(effectiveRisk, digits),
         " cost_model=", ForwardShadowCostModelVersion,
         " orders_executed=false");
   return true;
}

void UpdateForwardShadowOnTick()
{
   if(!EnableForwardShadowTelemetry || !g_shadowActive) return;
   string sym = TradeSymbol();
   RefreshRates();
   double bid = MarketInfo(sym, MODE_BID);
   double ask = MarketInfo(sym, MODE_ASK);
   datetime tickUtc = CurrentQuoteTimeUtc(sym);
   datetime currentBarOpen = iTime(sym, PERIOD_M5, 0);
   if(bid <= 0.0 || ask < bid || tickUtc <= 0 || currentBarOpen <= 0) return;

   if(g_shadowRecovered)
   {
      if(g_shadowLastTickUtc > g_shadowCurrentBarStartUtc)
      {
         int priorDuration = (int)(g_shadowLastTickUtc - g_shadowCurrentBarStartUtc);
         if(!SendShadowBar(g_shadowLastTickUtc, true, priorDuration)) return;
      }
      if(g_shadowLastTickUtc > 0 && tickUtc > g_shadowLastTickUtc)
      {
         if(!SendShadowGap(g_shadowLastTickUtc, tickUtc, "ea_restart_or_connection_gap")) return;
      }
      ResetShadowBar(sym, tickUtc, bid, ask);
      g_shadowRecovered = false;
   }
   else
   {
      if(g_shadowLastTickUtc > 0 &&
         tickUtc - g_shadowLastTickUtc > MathMax(5, MaxQuoteAgeSeconds))
      {
         int priorDuration = (int)(g_shadowLastTickUtc - g_shadowCurrentBarStartUtc);
         if(priorDuration > 0 && !SendShadowBar(g_shadowLastTickUtc, true, priorDuration)) return;
         if(!SendShadowGap(g_shadowLastTickUtc, tickUtc, "stale_quote_or_missing_ticks")) return;
         ResetShadowSegment(sym, tickUtc, bid, ask);
      }
      else if(currentBarOpen != g_shadowCurrentBarOpenServer)
      {
         int offsetSeconds = 0;
         if(!GetServerUtcOffsetSeconds(offsetSeconds)) return;
         datetime priorCloseUtc = g_shadowCurrentBarOpenServer + 300 - offsetSeconds;
         int duration = (int)(priorCloseUtc - g_shadowCurrentBarStartUtc);
         // A last quote within the configured freshness window is sufficient
         // to complete the OHLC bar; sparse ticks near the close are not a gap.
         if(tickUtc - g_shadowLastTickUtc <= MathMax(5, MaxQuoteAgeSeconds))
         {
            if(!SendShadowBar(priorCloseUtc, duration < 300, duration)) return;
         }
         else
         {
            if(g_shadowLastTickUtc > g_shadowCurrentBarStartUtc)
            {
               int partialDuration = (int)(g_shadowLastTickUtc - g_shadowCurrentBarStartUtc);
               if(!SendShadowBar(g_shadowLastTickUtc, true, partialDuration)) return;
            }
            if(g_shadowLastTickUtc > 0 && tickUtc > g_shadowLastTickUtc)
            {
               if(!SendShadowGap(g_shadowLastTickUtc, tickUtc, "m5_interval_without_fresh_quote")) return;
            }
         }
         ResetShadowBar(sym, tickUtc, bid, ask);
      }
   }

   UpdateShadowBarQuotes(tickUtc, bid, ask);
   bool stopHit = (g_shadowSide > 0 ? bid <= g_shadowStopBid : bid >= g_shadowStopBid);
   bool targetHit = (g_shadowSide > 0 ? bid >= g_shadowTargetBid : bid <= g_shadowTargetBid);
   if(stopHit || targetHit)
   {
      int partialDuration = (int)(tickUtc - g_shadowCurrentBarStartUtc);
      if(partialDuration <= 0) partialDuration = 1;
      if(!SendShadowBar(tickUtc, true, partialDuration)) return;
      string exitReason = (stopHit ? "STOP" : "TARGET");
      if(SendShadowExit(tickUtc, bid, ask, exitReason))
      {
         Print("[GOLD SHADOW] virtual_position_completed entry_id=", g_shadowEntryId,
               " reason=", exitReason, " orders_executed=false");
         ClearShadowState();
      }
   }
}

//---------------------------------------------------------
// End research-only Forward/Paper shadow telemetry helpers.
//---------------------------------------------------------

//---------------------------------------------------------
// Lightweight V19 market-safety heartbeat for Forward Monitor.
// This reports the local gate even when signal requests are blocked.
// It contains no trading instruction and does not run AI analysis.
//---------------------------------------------------------
bool BuildSafetyHeartbeatPayload(string sym, string &payload)
{
   if(g_marketSafetyQuoteTimeUtc <= 0)
      return false;

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   if(digits < 0 || point <= 0.0)
      return false;

   payload = "{";
   payload += "\"symbol\":\"" + JsonEscape(sym) + "\",";
   payload += "\"market_safety\":{";
   payload += "\"allowed\":" + (g_marketSafetyAllowed ? "true" : "false") + ",";
   payload += "\"reason\":\"" + JsonEscape(g_marketSafetyReason) + "\",";
   payload += "\"quote_time_utc\":" + IntegerToString((int)g_marketSafetyQuoteTimeUtc) + ",";
   payload += "\"mid_price\":" + JsonNumber(g_marketSafetyMid, digits) + ",";
   payload += "\"spread_price\":" + JsonNumber(g_marketSafetySpread, digits) + ",";
   payload += "\"stable_tick_count\":" + IntegerToString(g_recoveryStableCount) + ",";
   payload += "\"anomaly_active\":" + (g_tickAnomalyActive ? "true" : "false") + ",";
   payload += "\"reopen_lock_until_utc\":" + IntegerToString((int)g_reopenLockUntilUtc);
   payload += "},";
   payload += "\"features\":{";
   payload += "\"bid\":" + JsonNumber(g_marketSafetyBid, digits) + ",";
   payload += "\"ask\":" + JsonNumber(g_marketSafetyAsk, digits) + ",";
   payload += "\"point\":" + JsonNumber(point, digits) + ",";
   payload += "\"spread\":" + JsonNumber(g_marketSafetySpread, digits);
   payload += "},";
   payload += "\"ea_runtime\":{";
   payload += "\"enable_signal_requests\":" + (EnableSignalRequests ? "true" : "false") + ",";
   payload += "\"run_ai_test_once\":" + (RunAITestOnce ? "true" : "false") + ",";
   payload += "\"allow_auto_orders\":" + (AllowAutoOrders ? "true" : "false") + ",";
   payload += "\"timer_seconds\":" + IntegerToString(TimerSeconds) + ",";
   payload += "\"safety_heartbeat_seconds\":" + IntegerToString(SafetyHeartbeatSeconds) + ",";
   payload += "\"flow_status\":\"" + JsonEscape(g_signalFlowStatus) + "\",";
   payload += "\"flow_reason\":\"" + JsonEscape(g_signalFlowReason) + "\",";
   payload += "\"current_closed_m5_bar_open_utc\":" + ServerTimeUtcEpochJson(iTime(sym, PERIOD_M5, 1)) + ",";
   payload += "\"last_handled_m5_bar_open_utc\":" + ServerTimeUtcEpochJson(g_lastClosedM5Bar) + ",";
   payload += "\"last_attempted_m5_bar_open_utc\":" + ServerTimeUtcEpochJson(g_lastAttemptedM5Bar) + ",";
   payload += "\"last_attempt_at_utc\":" + ServerTimeUtcEpochJson(g_lastAttemptAt);
   payload += "}";
   payload += "}";
   return true;
}

//---------------------------------------------------------
//---------------------------------------------------------
// Reject non-retryable stale-bar responses from the API.
// The same completed M5 candle can never become newer, so retrying it every
// 30 seconds only adds noise. Keep transient HTTP/network failures retryable.
//---------------------------------------------------------
bool IsStaleBarTimeRejection(string response)
{
   return StringFind(response, "invalid_bar_time") >= 0 &&
          StringFind(response, "bar_time_too_old") >= 0;
}

//---------------------------------------------------------
// Main timer
//---------------------------------------------------------
void OnTimer()
{
   if(!g_apiConfigReady)
   {
      g_signalFlowStatus = "API_CONFIG_INVALID";
      g_signalFlowReason = "ApiBaseUrl_or_ApiKey_invalid";
      if(!g_apiConfigWarningLogged)
      {
         Print("GoldAITrader: signal requests paused until ApiBaseUrl and ApiKey are configured.");
         g_apiConfigWarningLogged = true;
      }
      return;
   }

   string sym = TradeSymbol();

   if(!IsGoldSymbol(sym))
   {
      g_signalFlowStatus = "SYMBOL_NOT_GOLD";
      g_signalFlowReason = "RequireGoldSymbol_check_failed";
      return;
   }

   if(!SymbolReady(sym))
   {
      g_signalFlowStatus = "SYMBOL_NOT_READY";
      g_signalFlowReason = "M5_H1_history_or_symbol_quote_not_ready";
      return;
   }

   // Update the persistent quote-safety state on every timer tick, not only once per M5 bar.
   UpdateMarketSafety(sym);

   // Keep the monitor informed even while the local safety gate blocks signal POSTs.
   int heartbeatSeconds = MathMax(5, MathMin(60, SafetyHeartbeatSeconds));
   datetime heartbeatNowUtc = TimeGMT();
   if(EnableSafetyHeartbeat &&
      heartbeatNowUtc > 0 &&
      (g_lastSafetyHeartbeatAttemptUtc <= 0 ||
       heartbeatNowUtc - g_lastSafetyHeartbeatAttemptUtc >= heartbeatSeconds))
   {
      g_lastSafetyHeartbeatAttemptUtc = heartbeatNowUtc;
      string heartbeatPayload = "";
      string heartbeatResponse = "";
      if(BuildSafetyHeartbeatPayload(sym, heartbeatPayload))
         PostJson("/api/gold/market-safety", heartbeatPayload, heartbeatResponse);
   }

   if(!EnableSignalRequests)
   {
      g_signalFlowStatus = "DISABLED";
      g_signalFlowReason = "EnableSignalRequests=false";
      return;
   }

   datetime closedBar = iTime(sym, PERIOD_M5, 1);

   if(closedBar <= 0)
   {
      g_signalFlowStatus = "WAITING_FOR_M5_BAR";
      g_signalFlowReason = "completed_M5_bar_not_available";
      return;
   }

   // A freshly attached EA must not submit the candle that was already closed
   // before initialization. It may be older than the server's 90-second freshness
   // window, so mark it handled and wait for the next completed M5 candle.
   if(g_lastClosedM5Bar <= 0)
   {
      g_lastClosedM5Bar = closedBar;
      g_signalFlowStatus = "WAITING_FOR_NEW_M5_BAR";
      g_signalFlowReason = "startup_current_completed_M5_bar_skipped";
      Print("GoldAITrader: startup completed M5 bar skipped; waiting for next completed bar. bar_open=",
            TimeToString(closedBar, TIME_DATE|TIME_MINUTES));
      return;
   }

   if(closedBar == g_lastClosedM5Bar)
   {
      if(g_signalFlowStatus != "SIGNAL_POST_ACCEPTED" &&
         g_signalFlowStatus != "SIGNAL_POST_PENDING" &&
         g_signalFlowStatus != "SAFETY_BLOCKED" &&
         g_signalFlowStatus != "SIGNAL_POST_REJECTED_STALE_BAR")
      {
         g_signalFlowStatus = "WAITING_FOR_NEW_M5_BAR";
         g_signalFlowReason = "current_completed_M5_bar_already_handled";
      }
      return;
   }

   // Fail closed locally as well: do not post a signal to the currently deployed
   // API while a market-reopen or abnormal-tick lock is active.
   if(!g_marketSafetyAllowed)
   {
      g_signalFlowStatus = "SAFETY_BLOCKED";
      g_signalFlowReason = g_marketSafetyReason;
      g_lastClosedM5Bar = closedBar;
      Print("[GOLD MARKET SAFETY] signal_skipped_before_api bar_open=",
            TimeToString(closedBar, TIME_DATE|TIME_MINUTES),
            " reason=", g_marketSafetyReason,
            " spread=", DoubleToString(g_marketSafetySpread, 2),
            " reopen_lock_until_utc=",
            TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS));
      return;
   }

   datetime now = TimeCurrent();

   if(closedBar == g_lastAttemptedM5Bar &&
      g_lastAttemptAt > 0 &&
      (now - g_lastAttemptAt) < g_retrySeconds)
   {
      g_signalFlowStatus = "RETRY_BACKOFF";
      g_signalFlowReason = "waiting_for_retry_interval";
      return;
   }

   g_lastAttemptedM5Bar = closedBar;
   g_lastAttemptAt = now;

   string payload = "";
   string response = "";

   if(!BuildSignalPayload(payload))
   {
      g_signalFlowStatus = "PAYLOAD_BUILD_FAILED";
      g_signalFlowReason = "history_or_utc_offset_or_quote_validation_failed";
      return;
   }

   Print("GoldAITrader V1.9: local ApiKey length=", StringLen(TrimText(ApiKey)),
         " url_length=", StringLen(TrimText(ApiBaseUrl)));

   if(RunAITestOnce)
   {
      g_signalFlowStatus = "AI_TEST_ONLY";
      g_signalFlowReason = "RunAITestOnce=true_routes_to_ai_test_not_signal";
      string aiTestDoneKey = "GoldAITraderV19:AI_TEST_DONE";
      if(!GlobalVariableCheck(aiTestDoneKey))
      {
         string aiTestResponse = "";
         if(PostJson("/api/gold/ai-test", payload, aiTestResponse))
         {
            GlobalVariableSet(aiTestDoneKey, TimeCurrent());
            Print("GoldAITrader V1.9: AI test response = ", aiTestResponse);
         }
         else
         {
            Print("GoldAITrader V1.9: AI test request failed; will retry.");
         }
      }
      else
      {
         g_signalFlowStatus = "AI_TEST_ALREADY_DONE";
         g_signalFlowReason = "RunAITestOnce=true_and_one_shot_test_already_completed";
         Print("GoldAITrader V1.9: one-shot AI test already completed; normal signal mode is paused while RunAITestOnce=true.");
      }
      return;
   }

   g_signalFlowStatus = "SIGNAL_POST_PENDING";
   g_signalFlowReason = "posting_to_api_gold_signal";
   bool requestSucceeded = PostJson("/api/gold/signal", payload, response);
   if(requestSucceeded)
   {
      g_signalFlowStatus = "SIGNAL_POST_ACCEPTED";
      g_signalFlowReason = "api_signal_request_accepted";
      g_lastClosedM5Bar = closedBar;
      Print("GoldAITrader: signal response = ", response);
      // Optional shadow recorder only: no order path and no effect on signal/risk decisions.
      if(EnableForwardShadowTelemetry)
         StartForwardShadowFromSignal(payload, response);

      if(AllowAutoOrders)
      {
         Print("GoldAITrader: AllowAutoOrders=true is ignored in V1.2 analysis bridge. No orders are sent.");
      }
   }
   else if(IsStaleBarTimeRejection(response))
   {
      g_signalFlowStatus = "SIGNAL_POST_REJECTED_STALE_BAR";
      g_signalFlowReason = "bar_time_too_old";
      // A stale timestamp is not transient for this specific candle. Skip it
      // until a newer completed M5 candle exists; never loosen server checks.
      g_lastClosedM5Bar = closedBar;
      Print("GoldAITrader: stale completed M5 bar rejected; suppressing retries until a newer bar. bar_open=",
            TimeToString(closedBar, TIME_DATE|TIME_MINUTES),
            " reason=bar_time_too_old");
   }
   else
   {
      g_signalFlowStatus = "SIGNAL_POST_FAILED";
      g_signalFlowReason = "http_or_network_error_check_experts_log";
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

   if(EnableForwardShadowTelemetry)
   {
      if(AllowAutoOrders)
      {
         Print("[GOLD SHADOW] initialization refused: AllowAutoOrders must remain false.");
         return INIT_FAILED;
      }
      string shadowBase = TrimText(ForwardShadowApiBaseUrl);
      int shadowBaseLength = StringLen(shadowBase);
      if(shadowBaseLength > 0 && StringSubstr(shadowBase, shadowBaseLength - 1, 1) == "/")
         shadowBase = StringSubstr(shadowBase, 0, shadowBaseLength - 1);
      string shadowKey = TrimText(ForwardShadowApiKey);
      if(StringFind(shadowBase, "https://") != 0 ||
         UrlHostOnly(shadowBase) == UrlHostOnly(ApiBaseUrl) ||
         StringLen(shadowKey) < 16 || shadowKey == "CHANGE_ME" || shadowKey == TrimText(ApiKey))
      {
         Print("[GOLD SHADOW] initialization refused: configure a separate HTTPS research endpoint, not ApiBaseUrl.");
         return INIT_FAILED;
      }
      if(ForwardShadowExpectedStopSlippagePrice < 0.0 ||
         TrimText(ForwardShadowCostModelVersion) == "")
      {
         Print("[GOLD SHADOW] initialization refused: expected stop slippage or cost model version invalid.");
         return INIT_FAILED;
      }
   }

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

   LoadMarketSafetyState();
   LoadShadowState();
   Print("[GOLD MARKET SAFETY] state_loaded last_tick_utc=",
         TimeToString(g_lastObservedTickUtc, TIME_DATE|TIME_SECONDS),
         " last_mid=", DoubleToString(g_lastAcceptedMid, 2),
         " reopen_lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS));

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
   UpdateForwardShadowOnTick();
}
