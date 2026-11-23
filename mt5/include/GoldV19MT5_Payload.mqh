#ifndef GOLD_V19_MT5_PAYLOAD_MQH
#define GOLD_V19_MT5_PAYLOAD_MQH

string RatesToJson(MqlRates &rates[], int periodSeconds, int offsetSeconds, int digits)
{
   int count = ArraySize(rates);
   string json = "[";
   for(int i = 0; i < count; i++)
   {
      if(i > 0) json += ",";
      datetime closeUtc = rates[i].time + periodSeconds - offsetSeconds;
      json += "{\"time\":" + IntegerToString((int)closeUtc);
      json += ",\"open\":" + JsonNumber(rates[i].open, digits);
      json += ",\"high\":" + JsonNumber(rates[i].high, digits);
      json += ",\"low\":" + JsonNumber(rates[i].low, digits);
      json += ",\"close\":" + JsonNumber(rates[i].close, digits);
      json += ",\"volume\":" + IntegerToString((int)rates[i].tick_volume);
      json += "}";
   }
   json += "]";
   return json;
}

bool BuildSignalPayload(string &payload)
{
   string sym = TradeSymbol();
   if(!SymbolReady(sym))
      return false;

   int serverUtcOffsetSeconds = 0;
   if(!GetServerUtcOffsetSeconds(serverUtcOffsetSeconds))
   {
      Print("GoldAITrader MT5: UTC offset validation failed; skipping signal request.");
      return false;
   }

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   if(digits < 0 || point <= 0.0)
      return false;

   // Reuse the exact quote snapshot evaluated by UpdateMarketSafety().
   // This keeps features.bid/ask/spread consistent with market_safety.
   double bid = g_marketSafetyBid;
   double ask = g_marketSafetyAsk;
   double spread = g_marketSafetySpread;
   if(bid <= 0.0 || ask < bid || spread < 0.0)
      return false;

   MqlRates m5Bars[];
   MqlRates h1Bars[];
   if(CopyRates(sym, PERIOD_M5, 1, 24, m5Bars) != 24)
      return false;
   if(CopyRates(sym, PERIOD_H1, 1, 24, h1Bars) != 24)
      return false;

   double m5Ema20 = 0.0, m5Ema50 = 0.0, m5Rsi14 = 0.0, m5Atr14 = 0.0;
   double h1Ema20 = 0.0, h1Ema50 = 0.0, h1Ema200 = 0.0, h1Rsi14 = 0.0, h1Atr14 = 0.0;
   if(!ReadIndicatorValue(g_m5Ema20Handle, 1, m5Ema20) ||
      !ReadIndicatorValue(g_m5Ema50Handle, 1, m5Ema50) ||
      !ReadIndicatorValue(g_m5Rsi14Handle, 1, m5Rsi14) ||
      !ReadIndicatorValue(g_m5Atr14Handle, 1, m5Atr14) ||
      !ReadIndicatorValue(g_h1Ema20Handle, 1, h1Ema20) ||
      !ReadIndicatorValue(g_h1Ema50Handle, 1, h1Ema50) ||
      !ReadIndicatorValue(g_h1Ema200Handle, 1, h1Ema200) ||
      !ReadIndicatorValue(g_h1Rsi14Handle, 1, h1Rsi14) ||
      !ReadIndicatorValue(g_h1Atr14Handle, 1, h1Atr14))
      return false;

   double m5High20 = -DBL_MAX;
   double m5Low20 = DBL_MAX;
   for(int i = 4; i < 24; i++)
   {
      if(m5Bars[i].high > m5High20) m5High20 = m5Bars[i].high;
      if(m5Bars[i].low < m5Low20) m5Low20 = m5Bars[i].low;
   }

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double dailyPnl = DailyRealizedPnl(sym);
   double dayStartBalance = balance - dailyPnl;
   double dailyPnlPct = 0.0;
   if(dayStartBalance > 0.0)
      dailyPnlPct = ((equity - dayStartBalance) / dayStartBalance) * 100.0;

   double peakEquity = PeakEquity();
   double drawdownPct = 0.0;
   if(peakEquity > 0.0)
      drawdownPct = ((peakEquity - equity) / peakEquity) * 100.0;

   double tickSize = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double minLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   int stopLevelPoints = (int)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL);
   int freezeLevelPoints = (int)SymbolInfoInteger(sym, SYMBOL_TRADE_FREEZE_LEVEL);
   int tradeAllowed = (SymbolTradeAllowed(sym) ? 1 : 0);

   bool riskDataReady =
      (equity > 0.0 && point > 0.0 && tickSize > 0.0 && tickValue > 0.0 &&
       minLot > 0.0 && maxLot >= minLot && lotStep > 0.0);

   double spreadPoints = (point > 0.0 ? spread / point : 0.0);
   datetime closedM5Open = m5Bars[23].time;
   datetime closedM5CloseUtc = closedM5Open + 300 - serverUtcOffsetSeconds;

   string json = "{";
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
   json += "\"bar_time\":" + IntegerToString((int)closedM5CloseUtc) + ",";
   json += "\"m5\":{";
   json += "\"ema20\":" + JsonNumber(m5Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(m5Ema50, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(m5Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(m5Atr14, digits) + ",";
   json += "\"high20\":" + JsonNumber(m5High20, digits) + ",";
   json += "\"low20\":" + JsonNumber(m5Low20, digits);
   json += "},";
   json += "\"h1\":{";
   json += "\"close\":" + JsonNumber(h1Bars[23].close, digits) + ",";
   json += "\"ema20\":" + JsonNumber(h1Ema20, digits) + ",";
   json += "\"ema50\":" + JsonNumber(h1Ema50, digits) + ",";
   json += "\"ema200\":" + JsonNumber(h1Ema200, digits) + ",";
   json += "\"rsi14\":" + JsonNumber(h1Rsi14, 2) + ",";
   json += "\"atr14\":" + JsonNumber(h1Atr14, digits);
   json += "},";
   json += "\"recent_m5\":" + RatesToJson(m5Bars, 300, serverUtcOffsetSeconds, digits) + ",";
   json += "\"recent_h1\":" + RatesToJson(h1Bars, 3600, serverUtcOffsetSeconds, digits);
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

bool BuildSafetyHeartbeatPayload(string sym, string &payload)
{
   if(g_marketSafetyQuoteTimeUtc <= 0)
      return false;

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   if(digits < 0 || point <= 0.0)
      return false;

   datetime currentClosedM5 = iTime(sym, PERIOD_M5, 1);
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
   payload += "\"allow_auto_orders\":false,";
   payload += "\"timer_seconds\":" + IntegerToString(TimerSeconds) + ",";
   payload += "\"safety_heartbeat_seconds\":" + IntegerToString(SafetyHeartbeatSeconds) + ",";
   payload += "\"flow_status\":\"" + JsonEscape(g_signalFlowStatus) + "\",";
   payload += "\"flow_reason\":\"" + JsonEscape(g_signalFlowReason) + "\",";
   payload += "\"current_closed_m5_bar_open_utc\":" + ServerTimeUtcEpochJson(currentClosedM5) + ",";
   payload += "\"last_handled_m5_bar_open_utc\":" + ServerTimeUtcEpochJson(g_lastClosedM5Bar) + ",";
   payload += "\"last_attempted_m5_bar_open_utc\":" + ServerTimeUtcEpochJson(g_lastAttemptedM5Bar) + ",";
   payload += "\"last_attempt_at_utc\":" + ServerTimeUtcEpochJson(g_lastAttemptAt);
   payload += "}";
   payload += "}";
   return true;
}

#endif // GOLD_V19_MT5_PAYLOAD_MQH
