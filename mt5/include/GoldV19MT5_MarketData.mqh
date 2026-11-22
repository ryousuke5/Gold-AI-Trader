#ifndef GOLD_V19_MT5_MARKETDATA_MQH
#define GOLD_V19_MT5_MARKETDATA_MQH

bool CreateIndicatorHandles(string sym)
{
   g_m5Ema20Handle = iMA(sym, PERIOD_M5, 20, 0, MODE_EMA, PRICE_CLOSE);
   g_m5Ema50Handle = iMA(sym, PERIOD_M5, 50, 0, MODE_EMA, PRICE_CLOSE);
   g_m5Rsi14Handle = iRSI(sym, PERIOD_M5, 14, PRICE_CLOSE);
   g_m5Atr14Handle = iATR(sym, PERIOD_M5, 14);

   g_h1Ema20Handle = iMA(sym, PERIOD_H1, 20, 0, MODE_EMA, PRICE_CLOSE);
   g_h1Ema50Handle = iMA(sym, PERIOD_H1, 50, 0, MODE_EMA, PRICE_CLOSE);
   g_h1Ema200Handle = iMA(sym, PERIOD_H1, 200, 0, MODE_EMA, PRICE_CLOSE);
   g_h1Rsi14Handle = iRSI(sym, PERIOD_H1, 14, PRICE_CLOSE);
   g_h1Atr14Handle = iATR(sym, PERIOD_H1, 14);

   if(g_m5Ema20Handle == INVALID_HANDLE ||
      g_m5Ema50Handle == INVALID_HANDLE ||
      g_m5Rsi14Handle == INVALID_HANDLE ||
      g_m5Atr14Handle == INVALID_HANDLE ||
      g_h1Ema20Handle == INVALID_HANDLE ||
      g_h1Ema50Handle == INVALID_HANDLE ||
      g_h1Ema200Handle == INVALID_HANDLE ||
      g_h1Rsi14Handle == INVALID_HANDLE ||
      g_h1Atr14Handle == INVALID_HANDLE)
   {
      Print("GoldAITrader MT5: failed to create one or more indicator handles. error=", GetLastError());
      ReleaseIndicatorHandles();
      return false;
   }
   return true;
}

void ReleaseOneHandle(int &handle)
{
   if(handle != INVALID_HANDLE)
   {
      IndicatorRelease(handle);
      handle = INVALID_HANDLE;
   }
}

void ReleaseIndicatorHandles()
{
   ReleaseOneHandle(g_m5Ema20Handle);
   ReleaseOneHandle(g_m5Ema50Handle);
   ReleaseOneHandle(g_m5Rsi14Handle);
   ReleaseOneHandle(g_m5Atr14Handle);
   ReleaseOneHandle(g_h1Ema20Handle);
   ReleaseOneHandle(g_h1Ema50Handle);
   ReleaseOneHandle(g_h1Ema200Handle);
   ReleaseOneHandle(g_h1Rsi14Handle);
   ReleaseOneHandle(g_h1Atr14Handle);
}

bool ReadIndicatorValue(int handle, int shift, double &value)
{
   if(handle == INVALID_HANDLE)
      return false;

   double buffer[1];
   ResetLastError();
   if(CopyBuffer(handle, 0, shift, 1, buffer) != 1)
   {
      Print("GoldAITrader MT5: CopyBuffer failed. handle=", handle,
            " shift=", shift, " error=", GetLastError());
      return false;
   }

   if(!MathIsValidNumber(buffer[0]) || buffer[0] == EMPTY_VALUE)
      return false;

   value = buffer[0];
   return true;
}

bool SymbolReady(string sym)
{
   if(!SymbolSelect(sym, true))
      return false;

   if(Bars(sym, PERIOD_M5) < 100 || Bars(sym, PERIOD_H1) < 250)
      return false;

   MqlRates m5[];
   MqlRates h1[];
   if(CopyRates(sym, PERIOD_M5, 1, 2, m5) != 2)
      return false;
   if(CopyRates(sym, PERIOD_H1, 1, 2, h1) != 2)
      return false;

   return (m5[1].time > 0 && h1[1].time > 0);
}

int OpenPositions(string sym)
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) != sym)
         continue;
      if((long)PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber)
         continue;

      ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      if(type == POSITION_TYPE_BUY || type == POSITION_TYPE_SELL)
         count++;
   }
   return count;
}


string ForwardCsvValue(double value, int digits, bool valid)
{
   if(!valid || !MathIsValidNumber(value) || value == EMPTY_VALUE)
      return "";
   return DoubleToString(value, digits);
}

void LoadForwardLogState()
{
   string key = ScopedGlobalKey("FWDLOG", "LAST_M5_BAR");
   if(GlobalVariableCheck(key))
      g_lastForwardLoggedBar = (datetime)GlobalVariableGet(key);
}

bool LogForwardM5Snapshot(string sym)
{
   if(!EnableLocalForwardLogging)
      return true;

   datetime closedM5Bar = iTime(sym, PERIOD_M5, 1);
   if(closedM5Bar <= 0 || closedM5Bar == g_lastForwardLoggedBar)
      return true;

   MqlRates m5[1];
   MqlRates h1[1];
   if(CopyRates(sym, PERIOD_M5, 1, 1, m5) != 1 ||
      CopyRates(sym, PERIOD_H1, 1, 1, h1) != 1)
      return false;

   int offsetSeconds = 0;
   bool offsetReady = GetServerUtcOffsetSeconds(offsetSeconds);

   MqlTick tick = {};
   bool tickReady = SymbolInfoTick(sym, tick);
   datetime recordServer = TimeTradeServer();
   datetime recordUtc = TimeGMT();
   int quoteAgeSeconds = -1;

   if(tickReady && tick.time > 0 && recordServer > 0)
      quoteAgeSeconds = (int)(recordServer - tick.time);

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double tickSize = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double tickValueProfit = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_PROFIT);
   double tickValueLoss = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);

   double m5Ema20 = 0.0, m5Ema50 = 0.0, m5Rsi14 = 0.0, m5Atr14 = 0.0;
   double h1Ema20 = 0.0, h1Ema50 = 0.0, h1Ema200 = 0.0, h1Rsi14 = 0.0, h1Atr14 = 0.0;

   bool m5Ema20Ok = ReadIndicatorValue(g_m5Ema20Handle, 1, m5Ema20);
   bool m5Ema50Ok = ReadIndicatorValue(g_m5Ema50Handle, 1, m5Ema50);
   bool m5Rsi14Ok = ReadIndicatorValue(g_m5Rsi14Handle, 1, m5Rsi14);
   bool m5Atr14Ok = ReadIndicatorValue(g_m5Atr14Handle, 1, m5Atr14);
   bool h1Ema20Ok = ReadIndicatorValue(g_h1Ema20Handle, 1, h1Ema20);
   bool h1Ema50Ok = ReadIndicatorValue(g_h1Ema50Handle, 1, h1Ema50);
   bool h1Ema200Ok = ReadIndicatorValue(g_h1Ema200Handle, 1, h1Ema200);
   bool h1Rsi14Ok = ReadIndicatorValue(g_h1Rsi14Handle, 1, h1Rsi14);
   bool h1Atr14Ok = ReadIndicatorValue(g_h1Atr14Handle, 1, h1Atr14);

   bool indicatorsReady = (m5Ema20Ok && m5Ema50Ok && m5Rsi14Ok && m5Atr14Ok &&
                           h1Ema20Ok && h1Ema50Ok && h1Ema200Ok && h1Rsi14Ok && h1Atr14Ok);

   string fileName = "GoldAITrader_FXTF_XAUUSD_M5_Forward.csv";
   ResetLastError();
   int file = FileOpen(fileName,
                       FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,
                       ',');
   if(file == INVALID_HANDLE)
   {
      if(!g_forwardLogWarningLogged)
      {
         Print("[FXTF FORWARD LOG] FileOpen failed. error=", GetLastError(),
               " file=", fileName);
         g_forwardLogWarningLogged = true;
      }
      return false;
   }

   if(FileSize(file) == 0)
   {
      FileWrite(file,
         "schema_version","record_type","record_time_server","record_time_utc_epoch",
         "broker_server","symbol","timeframe","bar_open_server","bar_open_utc_epoch",
         "bar_open","bar_high","bar_low","bar_close","tick_volume",
         "bid","ask","spread_price","spread_points",
         "quote_time_server","quote_time_utc_epoch","quote_age_seconds",
         "market_safety_allowed","market_safety_reason","reopen_lock_until_utc",
         "tick_anomaly_active",
         "m5_ema20","m5_ema50","m5_rsi14","m5_atr14",
         "h1_bar_open_server","h1_close","h1_ema20","h1_ema50","h1_ema200",
         "h1_rsi14","h1_atr14",
         "point","tick_size","tick_value_jpy","tick_value_profit_jpy",
         "tick_value_loss_jpy","tick_value_ready","indicators_ready");
   }

   FileSeek(file, 0, SEEK_END);

   string barUtcText = (offsetReady
                        ? IntegerToString((long)(m5[0].time - offsetSeconds))
                        : "");
   string quoteUtcText = (offsetReady && tickReady && tick.time > 0
                          ? IntegerToString((long)(tick.time - offsetSeconds))
                          : "");
   string recordUtcText = (recordUtc > 0 ? IntegerToString((long)recordUtc) : "");
   string reopenLockText = (g_reopenLockUntilUtc > 0
                            ? TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS)
                            : "");

   double spreadPoints = (point > 0.0 ? g_marketSafetySpread / point : 0.0);
   bool tickValueReady = (MathIsValidNumber(tickValue) && tickValue > 0.0);

   uint bytesWritten = FileWrite(file,
      "1","M5_BAR",
      TimeToString(recordServer, TIME_DATE|TIME_SECONDS),recordUtcText,
      AccountInfoString(ACCOUNT_SERVER),sym,"M5",
      TimeToString(m5[0].time, TIME_DATE|TIME_MINUTES),barUtcText,
      ForwardCsvValue(m5[0].open,digits,true),
      ForwardCsvValue(m5[0].high,digits,true),
      ForwardCsvValue(m5[0].low,digits,true),
      ForwardCsvValue(m5[0].close,digits,true),
      IntegerToString((long)m5[0].tick_volume),
      ForwardCsvValue(tick.bid,digits,tickReady),
      ForwardCsvValue(tick.ask,digits,tickReady),
      ForwardCsvValue(g_marketSafetySpread,digits,tickReady),
      ForwardCsvValue(spreadPoints,2,(tickReady && point > 0.0)),
      (tickReady && tick.time > 0 ? TimeToString(tick.time,TIME_DATE|TIME_SECONDS) : ""),
      quoteUtcText,IntegerToString(quoteAgeSeconds),
      (g_marketSafetyAllowed ? "true" : "false"),g_marketSafetyReason,
      reopenLockText,(g_tickAnomalyActive ? "true" : "false"),
      ForwardCsvValue(m5Ema20,digits,m5Ema20Ok),
      ForwardCsvValue(m5Ema50,digits,m5Ema50Ok),
      ForwardCsvValue(m5Rsi14,2,m5Rsi14Ok),
      ForwardCsvValue(m5Atr14,digits,m5Atr14Ok),
      TimeToString(h1[0].time,TIME_DATE|TIME_MINUTES),
      ForwardCsvValue(h1[0].close,digits,true),
      ForwardCsvValue(h1Ema20,digits,h1Ema20Ok),
      ForwardCsvValue(h1Ema50,digits,h1Ema50Ok),
      ForwardCsvValue(h1Ema200,digits,h1Ema200Ok),
      ForwardCsvValue(h1Rsi14,2,h1Rsi14Ok),
      ForwardCsvValue(h1Atr14,digits,h1Atr14Ok),
      ForwardCsvValue(point,digits,point > 0.0),
      ForwardCsvValue(tickSize,digits,tickSize > 0.0),
      ForwardCsvValue(tickValue,8,tickValueReady),
      ForwardCsvValue(tickValueProfit,8,MathIsValidNumber(tickValueProfit) && tickValueProfit > 0.0),
      ForwardCsvValue(tickValueLoss,8,MathIsValidNumber(tickValueLoss) && tickValueLoss > 0.0),
      (tickValueReady ? "true" : "false"),
      (indicatorsReady ? "true" : "false"));

   FileFlush(file);
   FileClose(file);

   if(bytesWritten == 0)
   {
      if(!g_forwardLogWarningLogged)
      {
         Print("[FXTF FORWARD LOG] FileWrite failed. file=", fileName,
               " error=", GetLastError());
         g_forwardLogWarningLogged = true;
      }
      return false;
   }

   g_lastForwardLoggedBar = closedM5Bar;
   GlobalVariableSet(ScopedGlobalKey("FWDLOG", "LAST_M5_BAR"), (double)closedM5Bar);
   g_forwardLogWarningLogged = false;

   Print("[FXTF FORWARD LOG] M5_BAR saved file=", fileName,
         " bar=", TimeToString(closedM5Bar, TIME_DATE|TIME_MINUTES),
         " safety=", (g_marketSafetyAllowed ? "allowed" : "blocked"),
         " reason=", g_marketSafetyReason,
         " indicators_ready=", (indicatorsReady ? "true" : "false"));
   return true;
}

double DailyRealizedPnl(string sym)
{
   // Use trade-server time for the broker-day boundary, not TimeCurrent(),
   // which can remain frozen at the last quote over weekends/market closures.
   datetime now = TimeTradeServer();
   if(now <= 0)
      return 0.0;

   datetime dayStart = StringToTime(TimeToString(now, TIME_DATE));
   if(dayStart <= 0 || !HistorySelect(dayStart, now))
      return 0.0;

   double realized = 0.0;
   int total = HistoryDealsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;

      if(HistoryDealGetString(ticket, DEAL_SYMBOL) != sym)
         continue;
      if((long)HistoryDealGetInteger(ticket, DEAL_MAGIC) != (long)MagicNumber)
         continue;

      // IMPORTANT FXTF accounting:
      // FXTF charges its position-linked fee on the opening-side deal.
      // Do not filter only DEAL_ENTRY_OUT/OUT_BY/INOUT. Sum cash components
      // on every matching symbol+magic deal so entry-side commissions/fees
      // are not omitted from the daily P/L snapshot.
      realized += HistoryDealGetDouble(ticket, DEAL_PROFIT);
      realized += HistoryDealGetDouble(ticket, DEAL_SWAP);
      realized += HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      realized += HistoryDealGetDouble(ticket, DEAL_FEE);
   }

   return realized;
}

double PeakEquity()
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   string key = ScopedGlobalKey("RISK", "PEAK_EQUITY");

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

bool SymbolTradeAllowed(string sym)
{
   long tradeMode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   bool terminalAllowed = (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0);
   bool expertAllowed = (MQLInfoInteger(MQL_TRADE_ALLOWED) != 0);
   bool accountAllowed = (AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0);

   return (tradeMode != SYMBOL_TRADE_MODE_DISABLED &&
           terminalAllowed && expertAllowed && accountAllowed);
}

#endif // GOLD_V19_MT5_MARKETDATA_MQH
