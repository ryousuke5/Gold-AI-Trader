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
