#ifndef GOLD_V19_PAYLOAD_MQH
#define GOLD_V19_PAYLOAD_MQH

// Extracted verbatim from mt4/GoldAITraderV19.mq4 at baseline 5461cb91ff339acc99af54caa63764aca835aa7f.
// Keep this module behavior-identical until parity and compiler checks pass.

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

#endif // GOLD_V19_PAYLOAD_MQH
