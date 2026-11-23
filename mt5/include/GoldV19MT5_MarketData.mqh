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


// Local M5 forward capture. This module only reads terminal data and writes a
// CSV under MQL5/Files; it does not make HTTP requests or submit trade orders.
string ForwardLogStateKey(string sym)
{
   string server = AccountInfoString(ACCOUNT_SERVER);
   StringReplace(server, ":", "_");
   StringReplace(server, " ", "_");
   StringReplace(server, ".", "_");

   string safeSymbol = sym;
   StringReplace(safeSymbol, "#", "_");
   StringReplace(safeSymbol, ".", "_");
   StringReplace(safeSymbol, "/", "_");
   StringReplace(safeSymbol, " ", "_");

   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   return "GV19FWD:" + StringSubstr(server, 0, 12) + ":" +
          IntegerToString(login) + ":" + StringSubstr(safeSymbol, 0, 8);
}

string ForwardCsvValue(double value, int digits, bool valid)
{
   if(!valid || !MathIsValidNumber(value) || value == EMPTY_VALUE)
      return "";
   return DoubleToString(value, digits);
}

void LoadForwardLogState()
{
   string key = ForwardLogStateKey(TradeSymbol());
   if(GlobalVariableCheck(key))
      g_lastForwardLoggedBar = (datetime)GlobalVariableGet(key);
}

bool LogForwardM5Snapshot(string sym)
{
   static datetime lastDisabledNoticeLocal = 0;
   static datetime lastNoBarNoticeLocal = 0;
   static datetime lastCopyFailureNoticeLocal = 0;
   static datetime lastDuplicateNoticeBar = 0;

   datetime nowLocal = TimeLocal();

   if(!EnableLocalForwardLogging)
   {
      if(lastDisabledNoticeLocal <= 0 || nowLocal - lastDisabledNoticeLocal >= 300)
      {
         Print("[V19 FORWARD DIAG] logging_disabled EnableLocalForwardLogging=false");
         lastDisabledNoticeLocal = nowLocal;
      }
      return true;
   }

   datetime closedM5Bar = iTime(sym, PERIOD_M5, 1);
   if(closedM5Bar <= 0)
   {
      if(lastNoBarNoticeLocal <= 0 || nowLocal - lastNoBarNoticeLocal >= 30)
      {
         Print("[V19 FORWARD DIAG] no_closed_m5_bar",
               " m5_bars=", Bars(sym, PERIOD_M5),
               " h1_bars=", Bars(sym, PERIOD_H1),
               " last_error=", GetLastError(),
               " data_path=", TerminalInfoString(TERMINAL_DATA_PATH));
         lastNoBarNoticeLocal = nowLocal;
      }
      return false;
   }

   string stateKey = ForwardLogStateKey(sym);
   if(GlobalVariableCheck(stateKey))
   {
      datetime persistedBar = (datetime)GlobalVariableGet(stateKey);
      if(persistedBar > g_lastForwardLoggedBar)
         g_lastForwardLoggedBar = persistedBar;
   }

   if(closedM5Bar <= g_lastForwardLoggedBar)
   {
      if(lastDuplicateNoticeBar != closedM5Bar)
      {
         Print("[V19 FORWARD DIAG] duplicate_bar_skipped",
               " closed_m5_bar=", TimeToString(closedM5Bar, TIME_DATE|TIME_MINUTES),
               " last_logged_bar=", TimeToString(g_lastForwardLoggedBar, TIME_DATE|TIME_MINUTES));
         lastDuplicateNoticeBar = closedM5Bar;
      }
      return true;
   }

   MqlRates m5[1];
   MqlRates h1[1];

   ResetLastError();
   int m5Copied = CopyRates(sym, PERIOD_M5, 1, 1, m5);
   int m5CopyError = GetLastError();

   ResetLastError();
   int h1Copied = CopyRates(sym, PERIOD_H1, 1, 1, h1);
   int h1CopyError = GetLastError();

   if(m5Copied != 1 || h1Copied != 1)
   {
      if(lastCopyFailureNoticeLocal <= 0 || nowLocal - lastCopyFailureNoticeLocal >= 30)
      {
         Print("[V19 FORWARD DIAG] history_copy_failed",
               " m5_copied=", m5Copied,
               " m5_error=", m5CopyError,
               " h1_copied=", h1Copied,
               " h1_error=", h1CopyError,
               " m5_bars=", Bars(sym, PERIOD_M5),
               " h1_bars=", Bars(sym, PERIOD_H1));
         lastCopyFailureNoticeLocal = nowLocal;
      }
      return false;
   }

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

   string fileName = "GoldAITraderV19_M5_Forward.csv";
   ResetLastError();
   int file = FileOpen(fileName,
                       FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_SHARE_READ,
                       ',');
   if(file == INVALID_HANDLE)
   {
      if(!g_forwardLogWarningLogged)
      {
         int fileOpenError = GetLastError();
         Print("[V19 FORWARD LOG] FileOpen failed. error=", fileOpenError,
               " file=", fileName,
               " data_path=", TerminalInfoString(TERMINAL_DATA_PATH));
         g_forwardLogWarningLogged = true;
      }
      return false;
   }

   if(FileSize(file) == 0)
   {
      FileWrite(file,
         "schema_version","record_type","record_time_server","record_time_utc_epoch",
         "broker_server","account_currency","symbol","timeframe","bar_open_server","bar_open_utc_epoch",
         "bar_open","bar_high","bar_low","bar_close","tick_volume",
         "bid","ask","spread_price","spread_points",
         "quote_time_server","quote_time_utc_epoch","quote_age_seconds",
         "market_safety_allowed","market_safety_reason","reopen_lock_until_utc_epoch",
         "tick_anomaly_active",
         "m5_ema20","m5_ema50","m5_rsi14","m5_atr14",
         "h1_bar_open_server","h1_close","h1_ema20","h1_ema50","h1_ema200",
         "h1_rsi14","h1_atr14",
         "point","tick_size","tick_value_account_currency",
         "tick_value_profit_account_currency","tick_value_loss_account_currency",
         "tick_value_ready","indicators_ready");
   }

   FileSeek(file, 0, SEEK_END);

   string barUtcText = (offsetReady
                        ? IntegerToString((long)(m5[0].time - offsetSeconds))
                        : "");
   string quoteUtcText = (offsetReady && tickReady && tick.time > 0
                          ? IntegerToString((long)(tick.time - offsetSeconds))
                          : "");
   string recordUtcText = (recordUtc > 0 ? IntegerToString((long)recordUtc) : "");
   string recordServerText = (recordServer > 0
                              ? TimeToString(recordServer, TIME_DATE|TIME_SECONDS)
                              : "");
   string quoteServerText = (tickReady && tick.time > 0
                             ? TimeToString(tick.time, TIME_DATE|TIME_SECONDS)
                             : "");
   string reopenLockText = (g_reopenLockUntilUtc > 0
                            ? IntegerToString((long)g_reopenLockUntilUtc)
                            : "");

   double spreadPoints = (point > 0.0 ? g_marketSafetySpread / point : 0.0);
   bool tickValueReady = (MathIsValidNumber(tickValue) && tickValue > 0.0);

   ResetLastError();
   uint bytesWritten = FileWrite(file,
      "1","M5_BAR",recordServerText,recordUtcText,
      AccountInfoString(ACCOUNT_SERVER),AccountInfoString(ACCOUNT_CURRENCY),sym,"M5",
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
      quoteServerText,quoteUtcText,IntegerToString(quoteAgeSeconds),
      (g_marketSafetyAllowed ? "true" : "false"),g_marketSafetyReason,
      reopenLockText,(g_tickAnomalyActive ? "true" : "false"),
      ForwardCsvValue(m5Ema20,digits,m5Ema20Ok),
      ForwardCsvValue(m5Ema50,digits,m5Ema50Ok),
      ForwardCsvValue(m5Rsi14,2,m5Rsi14Ok),
      ForwardCsvValue(m5Atr14,digits,m5Atr14Ok),
      (h1[0].time > 0 ? TimeToString(h1[0].time,TIME_DATE|TIME_MINUTES) : ""),
      ForwardCsvValue(h1[0].close,digits,(h1[0].time > 0)),
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
   ulong fileSizeAfterWrite = FileSize(file);
   int fileWriteError = GetLastError();
   FileClose(file);

   if(bytesWritten == 0)
   {
      if(!g_forwardLogWarningLogged)
      {
         Print("[V19 FORWARD LOG] FileWrite failed. file=", fileName,
               " error=", fileWriteError,
               " data_path=", TerminalInfoString(TERMINAL_DATA_PATH));
         g_forwardLogWarningLogged = true;
      }
      return false;
   }

   g_lastForwardLoggedBar = closedM5Bar;
   GlobalVariableSet(stateKey, (double)closedM5Bar);
   g_forwardLogWarningLogged = false;

   Print("[V19 FORWARD LOG] M5_BAR saved file=", fileName,
         " file_size_bytes=", fileSizeAfterWrite,
         " data_path=", TerminalInfoString(TERMINAL_DATA_PATH),
         " bar=", TimeToString(closedM5Bar, TIME_DATE|TIME_MINUTES),
         " safety=", (g_marketSafetyAllowed ? "allowed" : "blocked"),
         " reason=", g_marketSafetyReason,
         " indicators_ready=", (indicatorsReady ? "true" : "false"));
   return true;
}


double DailyRealizedPnl(string sym)
{
   datetime now = TimeCurrent();
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

      ENUM_DEAL_TYPE type = (ENUM_DEAL_TYPE)HistoryDealGetInteger(ticket, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
         continue;

      ENUM_DEAL_ENTRY entry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT)
         continue;

      realized += HistoryDealGetDouble(ticket, DEAL_PROFIT) +
                  HistoryDealGetDouble(ticket, DEAL_SWAP) +
                  HistoryDealGetDouble(ticket, DEAL_COMMISSION);
   }
   return realized;
}

double PeakEquity()
{
   string key = "GoldAITrader:PeakEquity";
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
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
