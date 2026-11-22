#ifndef GOLD_V19_MT5_MARKETSAFETY_MQH
#define GOLD_V19_MT5_MARKETSAFETY_MQH

string MarketSafetyKey(string suffix)
{
   return ScopedGlobalKey("SAFE", suffix);
}

void LoadMarketSafetyState()
{
   string key = MarketSafetyKey("LAST_TICK_UTC");
   bool hasPersistedTick = GlobalVariableCheck(key);

   if(hasPersistedTick)
      g_lastObservedTickUtc = (datetime)GlobalVariableGet(key);
   else
      g_firstSessionTickPending = true;

   key = MarketSafetyKey("FIRST_SESSION_PENDING");
   if(GlobalVariableCheck(key))
      g_firstSessionTickPending = (GlobalVariableGet(key) > 0.5);

   key = MarketSafetyKey("LAST_MID");
   if(GlobalVariableCheck(key))
      g_lastAcceptedMid = GlobalVariableGet(key);

   key = MarketSafetyKey("REOPEN_LOCK_UTC");
   if(GlobalVariableCheck(key))
   {
      datetime persistedLockUntil = (datetime)GlobalVariableGet(key);
      if(persistedLockUntil > g_reopenLockUntilUtc)
         g_reopenLockUntilUtc = persistedLockUntil;
   }

   key = MarketSafetyKey("ANOMALY_ACTIVE");
   if(GlobalVariableCheck(key))
      g_tickAnomalyActive = (GlobalVariableGet(key) > 0.5);

   key = MarketSafetyKey("RECOVERY_MID");
   if(GlobalVariableCheck(key))
      g_recoveryMid = GlobalVariableGet(key);

   key = MarketSafetyKey("RECOVERY_COUNT");
   if(GlobalVariableCheck(key))
      g_recoveryStableCount = (int)GlobalVariableGet(key);
}

void SaveMarketSafetyState()
{
   GlobalVariableSet(MarketSafetyKey("LAST_TICK_UTC"), (double)g_lastObservedTickUtc);
   GlobalVariableSet(MarketSafetyKey("FIRST_SESSION_PENDING"), g_firstSessionTickPending ? 1.0 : 0.0);
   GlobalVariableSet(MarketSafetyKey("LAST_MID"), g_lastAcceptedMid);
   GlobalVariableSet(MarketSafetyKey("REOPEN_LOCK_UTC"), (double)g_reopenLockUntilUtc);
   GlobalVariableSet(MarketSafetyKey("ANOMALY_ACTIVE"), g_tickAnomalyActive ? 1.0 : 0.0);
   GlobalVariableSet(MarketSafetyKey("RECOVERY_MID"), g_recoveryMid);
   GlobalVariableSet(MarketSafetyKey("RECOVERY_COUNT"), (double)g_recoveryStableCount);
}

bool IsWithinTradingSession(string sym, datetime serverNow, string &reason)
{
   if(serverNow <= 0)
   {
      reason = "server_time_invalid";
      return false;
   }

   MqlDateTime nowParts = {};
   if(!TimeToStruct(serverNow, nowParts))
   {
      reason = "server_time_invalid";
      return false;
   }

   int nowSeconds = nowParts.hour * 3600 + nowParts.min * 60 + nowParts.sec;
   bool foundSession = false;

   for(uint sessionIndex = 0; sessionIndex < 16; sessionIndex++)
   {
      datetime sessionFrom = 0;
      datetime sessionTo = 0;

      if(!SymbolInfoSessionTrade(sym,
                                 (ENUM_DAY_OF_WEEK)nowParts.day_of_week,
                                 sessionIndex,
                                 sessionFrom,
                                 sessionTo))
         break;

      foundSession = true;
      int fromSeconds = (int)(((long)sessionFrom % 86400 + 86400) % 86400);
      int toSeconds = (int)(((long)sessionTo % 86400 + 86400) % 86400);

      bool inside = false;
      if(fromSeconds == toSeconds)
         inside = true;
      else if(fromSeconds < toSeconds)
         inside = (nowSeconds >= fromSeconds && nowSeconds < toSeconds);
      else
         inside = (nowSeconds >= fromSeconds || nowSeconds < toSeconds);

      if(inside)
      {
         reason = "ok";
         return true;
      }
   }

   if(!foundSession && nowParts.day_of_week != 0 && nowParts.day_of_week != 6)
      reason = "session_schedule_unavailable";
   else
      reason = "market_closed";

   return false;
}

void LogMarketSafetyState(int digits, int quoteAgeSeconds)
{
   string logState = (g_marketSafetyAllowed ? "allowed:" : "blocked:") + g_marketSafetyReason;
   if(logState != g_lastMarketSafetyLog)
   {
      Print("[GOLD MARKET SAFETY FXTF] state=", logState,
            " spread=", DoubleToString(g_marketSafetySpread, digits),
            " quote_age_seconds=", quoteAgeSeconds,
            " stable_ticks=", g_recoveryStableCount,
            " anomaly_active=", (g_tickAnomalyActive ? "true" : "false"),
            " first_session_tick_pending=", (g_firstSessionTickPending ? "true" : "false"),
            " reopen_lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS));
      g_lastMarketSafetyLog = logState;
   }
}

void UpdateMarketSafety(string sym)
{
   MqlTick tick = {};
   int offsetSeconds = 0;
   bool offsetOk = GetServerUtcOffsetSeconds(offsetSeconds);
   datetime serverNow = TimeTradeServer();
   datetime nowUtc = TimeGMT();

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   int reopenGapSeconds = (int)MathMax(1800, MathMin(7200, MarketReopenGapSeconds));
   int reopenLockMinutes = (int)MathMax(30, MathMin(240, MarketReopenLockMinutes));
   double maxSpreadPrice = MathMin(0.50, MathMax(0.0, MaxSpreadPrice));
   double maxTickJumpPrice = MathMin(3.00, MathMax(0.01, MaxTickJumpPrice));
   double recoveryBandPrice = MathMin(0.50, MathMax(0.01, TickRecoveryBandPrice));
   int recoverySamplesRequired = (int)MathMax(3, MathMin(20, TickRecoverySamples));
   int maxQuoteAgeSeconds = (int)MathMin(30, MathMax(1, MaxQuoteAgeSeconds));

   if(!SymbolInfoTick(sym, tick))
   {
      g_marketSafetyAllowed = false;
      g_marketSafetyReason = "quote_invalid";
      g_marketSafetyQuoteTimeUtc = 0;
      LogMarketSafetyState(digits, -1);
      return;
   }

   g_marketSafetyBid = tick.bid;
   g_marketSafetyAsk = tick.ask;
   g_marketSafetySpread = tick.ask - tick.bid;
   g_marketSafetyMid = (tick.bid + tick.ask) / 2.0;

   bool quoteValid = (tick.bid > 0.0 &&
                      tick.ask >= tick.bid &&
                      g_marketSafetySpread >= 0.0 &&
                      g_marketSafetyMid > 0.0);

   datetime tickUtc = 0;
   if(offsetOk && tick.time > 0)
      tickUtc = tick.time - offsetSeconds;

   g_marketSafetyQuoteTimeUtc = tickUtc;

   string reason = "ok";
   int quoteAgeSeconds = -1;

   if(!offsetOk || nowUtc <= 0)
      reason = "server_utc_offset_invalid";
   else if(serverNow <= 0)
      reason = "server_time_invalid";
   else
   {
      string sessionReason = "";
      if(!IsWithinTradingSession(sym, serverNow, sessionReason))
         reason = sessionReason;
      else if(!quoteValid || tick.time <= 0 || tickUtc <= 0)
         reason = "quote_invalid";
      else
      {
         // Compare the quote's broker-server timestamp with TimeTradeServer().
         // TimeCurrent() can freeze at the last tick while the CFD market is closed.
         quoteAgeSeconds = (int)(serverNow - tick.time);

         if(quoteAgeSeconds < -10)
            reason = "quote_time_invalid";
         else if(quoteAgeSeconds > maxQuoteAgeSeconds)
            reason = "quote_stale";
         else if(g_lastObservedTickUtc > 0 && tickUtc < g_lastObservedTickUtc)
            reason = "tick_time_reversed";
         else if(tickUtc > g_lastObservedTickUtc)
         {
            datetime previousTickUtc = g_lastObservedTickUtc;

            if(g_firstSessionTickPending)
            {
               g_reopenLockUntilUtc = nowUtc + reopenLockMinutes * 60;
               g_firstSessionTickPending = false;
               Print("[GOLD MARKET SAFETY FXTF] first_fresh_session_tick_lock_started duration_minutes=",
                     reopenLockMinutes,
                     " lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS));
            }
            else if(previousTickUtc > 0 &&
                    (tickUtc - previousTickUtc) >= reopenGapSeconds)
            {
               g_reopenLockUntilUtc = nowUtc + reopenLockMinutes * 60;
               Print("[GOLD MARKET SAFETY FXTF] market_reopen_lock_started gap_seconds=",
                     (int)(tickUtc - previousTickUtc),
                     " lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS),
                     " duration_minutes=", reopenLockMinutes);
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
                  Print("[GOLD MARKET SAFETY FXTF] tick_anomaly_recovered stable_ticks=",
                        recoverySamplesRequired,
                        " mid=", DoubleToString(g_marketSafetyMid, digits));
               }
            }
            else if(g_marketSafetySpread <= maxSpreadPrice &&
                    g_lastAcceptedMid > 0.0 &&
                    MathAbs(g_marketSafetyMid - g_lastAcceptedMid) > maxTickJumpPrice)
            {
               g_tickAnomalyActive = true;
               g_recoveryMid = g_marketSafetyMid;
               g_recoveryStableCount = 1;
               Print("[GOLD MARKET SAFETY FXTF] tick_anomaly_detected previous_mid=",
                     DoubleToString(g_lastAcceptedMid, digits),
                     " current_mid=", DoubleToString(g_marketSafetyMid, digits),
                     " threshold=", DoubleToString(maxTickJumpPrice, digits));
            }
            else if(g_marketSafetySpread <= maxSpreadPrice)
               g_lastAcceptedMid = g_marketSafetyMid;

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
   }

   g_marketSafetyAllowed = (reason == "ok");
   g_marketSafetyReason = reason;
   LogMarketSafetyState(digits, quoteAgeSeconds);
}

#endif // GOLD_V19_MT5_MARKETSAFETY_MQH
