#ifndef GOLD_V19_MT5_MARKETSAFETY_MQH
#define GOLD_V19_MT5_MARKETSAFETY_MQH

string MarketSafetyKey(string suffix)
{
   string sym = TradeSymbol();
   StringReplace(sym, "#", "_");
   StringReplace(sym, ".", "_");
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   return "GTV19:" + IntegerToString((int)login) + ":" +
          StringSubstr(sym, 0, 10) + ":" + suffix;
}

void LoadMarketSafetyState()
{
   string key = MarketSafetyKey("LAST_TICK_UTC");
   bool hasPersistedTick = GlobalVariableCheck(key);
   if(hasPersistedTick)
      g_lastObservedTickUtc = (datetime)GlobalVariableGet(key);
   else
   {
      g_reopenLockUntilUtc = TimeGMT() + 30 * 60;
      Print("[GOLD MARKET SAFETY MT5] first_startup_warmup_started duration_minutes=30");
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
   MqlTick tick = {};
   int offsetSeconds = 0;
   bool offsetOk = GetServerUtcOffsetSeconds(offsetSeconds);
   datetime nowUtc = TimeGMT();

   if(!SymbolInfoTick(sym, tick))
   {
      g_marketSafetyAllowed = false;
      g_marketSafetyReason = "quote_invalid";
      return;
   }

   datetime tickUtc = 0;
   if(offsetOk && tick.time > 0)
      tickUtc = tick.time - offsetSeconds;

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   int reopenGapSeconds = (int)MathMax(1800, MathMin(7200, MarketReopenGapSeconds));
   int reopenLockMinutes = (int)MathMax(30, MarketReopenLockMinutes);
   double maxSpreadPrice = MathMin(0.50, MathMax(0.0, MaxSpreadPrice));
   double maxTickJumpPrice = MathMin(3.00, MathMax(0.01, MaxTickJumpPrice));
   double recoveryBandPrice = MathMin(0.50, MathMax(0.01, TickRecoveryBandPrice));
   int recoverySamplesRequired = (int)MathMax(3, TickRecoverySamples);
   int maxQuoteAgeSeconds = (int)MathMin(30, MathMax(1, MaxQuoteAgeSeconds));

   g_marketSafetyBid = tick.bid;
   g_marketSafetyAsk = tick.ask;
   g_marketSafetySpread = tick.ask - tick.bid;
   g_marketSafetyMid = (tick.bid + tick.ask) / 2.0;
   g_marketSafetyQuoteTimeUtc = tickUtc;

   string reason = "ok";
   bool quoteValid = (tick.bid > 0.0 &&
                      tick.ask >= tick.bid &&
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
            Print("[GOLD MARKET SAFETY MT5] weekly_reopen_lock_started gap_seconds=",
                  (int)(tickUtc - g_lastObservedTickUtc),
                  " lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS),
                  " duration_minutes=", reopenLockMinutes);
         }
         else if(g_lastObservedTickUtc <= 0 &&
                 TimeDayOfWeek(nowUtc) == 0 &&
                 TimeHour(nowUtc) >= 20 &&
                 TimeHour(nowUtc) <= 23)
         {
            g_reopenLockUntilUtc = nowUtc + reopenLockMinutes * 60;
            Print("[GOLD MARKET SAFETY MT5] first_observation_sunday_reopen_lock_started");
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
               Print("[GOLD MARKET SAFETY MT5] tick_anomaly_recovered stable_ticks=",
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
            Print("[GOLD MARKET SAFETY MT5] tick_anomaly_detected previous_mid=",
                  DoubleToString(g_lastAcceptedMid, digits),
                  " current_mid=", DoubleToString(g_marketSafetyMid, digits),
                  " threshold=", DoubleToString(maxTickJumpPrice, digits));
         }
         else
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

   g_marketSafetyAllowed = (reason == "ok");
   g_marketSafetyReason = reason;

   string logState = (g_marketSafetyAllowed ? "allowed:" : "blocked:") + g_marketSafetyReason;
   if(logState != g_lastMarketSafetyLog)
   {
      Print("[GOLD MARKET SAFETY MT5] state=", logState,
            " spread=", DoubleToString(g_marketSafetySpread, digits),
            " quote_age_seconds=", (tickUtc > 0 ? (int)(nowUtc - tickUtc) : -1),
            " stable_ticks=", g_recoveryStableCount,
            " anomaly_active=", (g_tickAnomalyActive ? "true" : "false"),
            " reopen_lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS));
      g_lastMarketSafetyLog = logState;
   }
}

#endif // GOLD_V19_MT5_MARKETSAFETY_MQH
