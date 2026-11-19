#ifndef GOLD_V19_FLOW_MQH
#define GOLD_V19_FLOW_MQH

// Extracted verbatim from mt4/GoldAITraderV19.mq4 at baseline 5461cb91ff339acc99af54caa63764aca835aa7f.
// Keep this module behavior-identical until parity and compiler checks pass.

bool IsStaleBarTimeRejection(string response)
{
   return StringFind(response, "invalid_bar_time") >= 0 &&
          StringFind(response, "bar_time_too_old") >= 0;
}

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

#endif // GOLD_V19_FLOW_MQH
