#ifndef GOLD_V19_MARKETDATA_MQH
#define GOLD_V19_MARKETDATA_MQH

// Extracted verbatim from mt4/GoldAITraderV19.mq4 at baseline 5461cb91ff339acc99af54caa63764aca835aa7f.
// Keep this module behavior-identical until parity and compiler checks pass.

bool SymbolReady(string sym)
{
   if(!SymbolSelect(sym, true))
   {
      Print("GoldAITrader: SymbolSelect failed for ", sym,
            " error=", GetLastError());
      return false;
   }

   int m5Bars = iBars(sym, PERIOD_M5);
   int h1Bars = iBars(sym, PERIOD_H1);

   if(m5Bars < 100 || h1Bars < 250)
   {
      Print("GoldAITrader: insufficient history. M5=", m5Bars,
            " H1=", h1Bars);
      return false;
   }

   datetime m5Time = iTime(sym, PERIOD_M5, 1);
   datetime h1Time = iTime(sym, PERIOD_H1, 1);

   if(m5Time <= 0 || h1Time <= 0)
   {
      Print("GoldAITrader: price history is not ready.");
      return false;
   }

   return true;
}

int OpenPositions(string sym)
{
   int count = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;

      if(OrderSymbol() != sym)
         continue;

      if(OrderMagicNumber() != MagicNumber)
         continue;

      int type = OrderType();
      if(type == OP_BUY || type == OP_SELL)
         count++;
   }

   return count;
}

double DailyRealizedPnl(string sym)
{
   datetime dayStart = StrToTime(TimeToString(TimeCurrent(), TIME_DATE));
   double realized = 0.0;

   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;

      if(OrderSymbol() != sym)
         continue;

      if(OrderMagicNumber() != MagicNumber)
         continue;

      if(OrderCloseTime() < dayStart)
         continue;

      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL)
         continue;

      realized += OrderProfit() + OrderSwap() + OrderCommission();
   }

   return realized;
}

double PeakEquity()
{
   string key = "GoldAITrader:PeakEquity";
   double equity = AccountEquity();

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

#endif // GOLD_V19_MARKETDATA_MQH
