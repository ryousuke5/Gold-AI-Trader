#property strict
#property script_show_inputs
#property description "FXTF MT5 GOLD environment probe. Read-only; no trading and no network."

input string InpProbeSymbol = ""; // Blank = current chart symbol

void PrintProbeBarWindow(const string sym, const ENUM_TIMEFRAMES timeframe, const string label)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   ResetLastError();
   int copied = CopyRates(sym, timeframe, 1, 3, rates);
   if(copied != 3)
   {
      PrintFormat("[FXTF PROBE] BARS label=%s copied=%d error=%d",
                  label, copied, GetLastError());
      return;
   }

   PrintFormat("[FXTF PROBE] BARS label=%s closed_bar_1_server=%s closed_bar_2_server=%s closed_bar_3_server=%s",
               label,
               TimeToString(rates[2].time, TIME_DATE|TIME_MINUTES),
               TimeToString(rates[1].time, TIME_DATE|TIME_MINUTES),
               TimeToString(rates[0].time, TIME_DATE|TIME_MINUTES));
}

void OnStart()
{
   string sym = InpProbeSymbol;
   if(StringLen(sym) == 0)
      sym = _Symbol;

   Print("========== FXTF MT5 GOLD ENVIRONMENT PROBE BEGIN ==========");
   Print("[FXTF PROBE] SAFETY read_only=true trading_calls=none network_calls=none account_id_logged=false");

   PrintFormat("[FXTF PROBE] ACCOUNT company=%s server=%s currency=%s trade_mode=%d margin_mode=%d leverage=%d",
               AccountInfoString(ACCOUNT_COMPANY),
               AccountInfoString(ACCOUNT_SERVER),
               AccountInfoString(ACCOUNT_CURRENCY),
               (int)AccountInfoInteger(ACCOUNT_TRADE_MODE),
               (int)AccountInfoInteger(ACCOUNT_MARGIN_MODE),
               (int)AccountInfoInteger(ACCOUNT_LEVERAGE));

   datetime serverNow = TimeTradeServer();
   datetime currentQuoteTime = TimeCurrent();
   datetime utcNow = TimeGMT();
   long offsetSeconds = (long)serverNow - (long)utcNow;

   PrintFormat("[FXTF PROBE] CLOCK server=%s terminal_current=%s pc_utc=%s server_minus_utc_seconds=%I64d",
               TimeToString(serverNow, TIME_DATE|TIME_SECONDS),
               TimeToString(currentQuoteTime, TIME_DATE|TIME_SECONDS),
               TimeToString(utcNow, TIME_DATE|TIME_SECONDS),
               offsetSeconds);

   if(!SymbolSelect(sym, true))
   {
      PrintFormat("[FXTF PROBE] ERROR SymbolSelect failed symbol=%s error=%d",
                  sym, GetLastError());
      Print("========== FXTF MT5 GOLD ENVIRONMENT PROBE END ==========");
      return;
   }

   MqlTick tick = {};
   bool tickOk = SymbolInfoTick(sym, tick);

   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double spreadPrice = (tickOk ? tick.ask - tick.bid : 0.0);
   double spreadPoints = (point > 0.0 ? spreadPrice / point : 0.0);

   PrintFormat("[FXTF PROBE] SYMBOL name=%s description=%s path=%s base=%s profit=%s margin=%s",
               sym,
               SymbolInfoString(sym, SYMBOL_DESCRIPTION),
               SymbolInfoString(sym, SYMBOL_PATH),
               SymbolInfoString(sym, SYMBOL_CURRENCY_BASE),
               SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT),
               SymbolInfoString(sym, SYMBOL_CURRENCY_MARGIN));

   PrintFormat("[FXTF PROBE] CONTRACT digits=%d point=%s contract_size=%s tick_size=%s tick_value=%s tick_value_profit=%s tick_value_loss=%s",
               (int)SymbolInfoInteger(sym, SYMBOL_DIGITS),
               DoubleToString(point, 10),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE), 8),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), 10),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE), 8),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_PROFIT), 8),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS), 8));

   PrintFormat("[FXTF PROBE] VOLUME min=%s step=%s max=%s limit=%s",
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), 8),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), 8),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX), 8),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_LIMIT), 8));

   PrintFormat("[FXTF PROBE] MARKET trade_mode=%d calc_mode=%d order_mode=%d filling_mode=%d stops_level=%d freeze_level=%d",
               (int)SymbolInfoInteger(sym, SYMBOL_TRADE_MODE),
               (int)SymbolInfoInteger(sym, SYMBOL_TRADE_CALC_MODE),
               (int)SymbolInfoInteger(sym, SYMBOL_ORDER_MODE),
               (int)SymbolInfoInteger(sym, SYMBOL_FILLING_MODE),
               (int)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL),
               (int)SymbolInfoInteger(sym, SYMBOL_TRADE_FREEZE_LEVEL));

   PrintFormat("[FXTF PROBE] COST spread_float=%d spread_points=%s spread_price=%s swap_long=%s swap_short=%s swap_mode=%d",
               (int)SymbolInfoInteger(sym, SYMBOL_SPREAD_FLOAT),
               DoubleToString(spreadPoints, 2),
               DoubleToString(spreadPrice, 10),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_SWAP_LONG), 8),
               DoubleToString(SymbolInfoDouble(sym, SYMBOL_SWAP_SHORT), 8),
               (int)SymbolInfoInteger(sym, SYMBOL_SWAP_MODE));

   if(tickOk)
   {
      PrintFormat("[FXTF PROBE] TICK bid=%s ask=%s time_server=%s time_msc=%I64d flags=%d",
                  DoubleToString(tick.bid, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)),
                  DoubleToString(tick.ask, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)),
                  TimeToString(tick.time, TIME_DATE|TIME_SECONDS),
                  (long)tick.time_msc,
                  (int)tick.flags);
   }
   else
   {
      PrintFormat("[FXTF PROBE] TICK unavailable error=%d", GetLastError());
   }

   PrintFormat("[FXTF PROBE] HISTORY bars_m5=%d bars_h1=%d",
               Bars(sym, PERIOD_M5), Bars(sym, PERIOD_H1));
   PrintProbeBarWindow(sym, PERIOD_M5, "M5");
   PrintProbeBarWindow(sym, PERIOD_H1, "H1");

   Print("[FXTF PROBE] SESSIONS from/to are broker-time seconds from the start of the week day; confirm against FXTF's published schedule.");
   for(int day = 0; day < 7; day++)
   {
      for(uint session = 0; session < 8; session++)
      {
         datetime sessionFrom = 0;
         datetime sessionTo = 0;
         if(!SymbolInfoSessionTrade(sym, (ENUM_DAY_OF_WEEK)day, session, sessionFrom, sessionTo))
            break;

         PrintFormat("[FXTF PROBE] SESSION day=%d index=%d from_raw=%I64d to_raw=%I64d",
                     day, (int)session, (long)sessionFrom, (long)sessionTo);
      }
   }

   Print("========== FXTF MT5 GOLD ENVIRONMENT PROBE END ==========");
}
