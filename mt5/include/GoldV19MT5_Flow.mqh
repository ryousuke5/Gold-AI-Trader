#ifndef GOLD_V19_MT5_FLOW_MQH
#define GOLD_V19_MT5_FLOW_MQH

bool IsStaleBarTimeRejection(string response)
{
   return (StringFind(response, "invalid_bar_time") >= 0 &&
           StringFind(response, "bar_time_too_old") >= 0);
}

void OnTimer()
{
   if(!g_apiConfigReady)
   {
      g_signalFlowStatus = "API_CONFIG_INVALID";
      g_signalFlowReason = "ApiBaseUrl_or_ApiKey_invalid";
      if(!g_apiConfigWarningLogged)
      {
         Print("GoldAITrader MT5: API configuration incomplete; network requests are paused.");
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

   UpdateMarketSafety(sym);

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

   if(!g_marketSafetyAllowed)
   {
      g_signalFlowStatus = "SAFETY_BLOCKED";
      g_signalFlowReason = g_marketSafetyReason;
      g_lastClosedM5Bar = closedBar;
      Print("[GOLD MARKET SAFETY MT5] signal_skipped_before_api bar_open=",
            TimeToString(closedBar, TIME_DATE|TIME_MINUTES),
            " reason=", g_marketSafetyReason);
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
      g_signalFlowReason = "history_or_indicator_or_utc_offset_validation_failed";
      return;
   }

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
            Print("GoldAITrader MT5: AI test response = ", aiTestResponse);
         }
         else
            Print("GoldAITrader MT5: AI test request failed; will retry.");
      }
      else
      {
         g_signalFlowStatus = "AI_TEST_ALREADY_DONE";
         g_signalFlowReason = "one_shot_ai_test_already_completed";
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
      Print("GoldAITrader MT5: signal response = ", response);
   }
   else if(IsStaleBarTimeRejection(response))
   {
      g_signalFlowStatus = "SIGNAL_POST_REJECTED_STALE_BAR";
      g_signalFlowReason = "bar_time_too_old";
      g_lastClosedM5Bar = closedBar;
      Print("GoldAITrader MT5: stale completed M5 bar rejected; suppressing retries until a newer bar.");
   }
   else
   {
      g_signalFlowStatus = "SIGNAL_POST_FAILED";
      g_signalFlowReason = "http_or_network_error_check_experts_log";
   }
}

#endif // GOLD_V19_MT5_FLOW_MQH
