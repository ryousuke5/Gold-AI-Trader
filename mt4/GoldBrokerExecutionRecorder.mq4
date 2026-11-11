#property strict
#property version   "1.00"
#property description "Read-only broker quote and closed-order recorder. It never sends or modifies orders."

input string FilePrefix = "gold_broker";
input int TimerSeconds = 5;
input bool RecordOnlyChartSymbol = true;
input bool RecordClosedHistoryOnStartup = true;

int g_quoteHandle = INVALID_HANDLE;
string g_quoteFileName = "";
string g_quoteDateKey = "";
double g_lastBid = 0.0;
double g_lastAsk = 0.0;
datetime g_lastServerTime = 0;
long g_tickSequence = 0;
long g_quotesWritten = 0;
long g_ordersWritten = 0;

string SafeToken(string value)
{
   StringReplace(value, ".", "_");
   StringReplace(value, "#", "_");
   StringReplace(value, "/", "_");
   StringReplace(value, "\\", "_");
   return value;
}

string DateKey(datetime value)
{
   string s = TimeToString(value, TIME_DATE);
   StringReplace(s, ".", "");
   return s;
}

string QuoteFileName(datetime serverTime)
{
   return FilePrefix + "_quotes_" + SafeToken(Symbol()) + "_" + DateKey(serverTime) + ".csv";
}

string OrdersFileName()
{
   return FilePrefix + "_orders_" + SafeToken(Symbol()) + ".csv";
}

bool SelectChartSymbol(string orderSymbol)
{
   return (!RecordOnlyChartSymbol || orderSymbol == Symbol());
}

bool EnsureQuoteFile(datetime serverTime)
{
   string desiredName = QuoteFileName(serverTime);
   if(g_quoteHandle != INVALID_HANDLE && g_quoteFileName == desiredName)
      return true;

   if(g_quoteHandle != INVALID_HANDLE)
   {
      FileFlush(g_quoteHandle);
      FileClose(g_quoteHandle);
      g_quoteHandle = INVALID_HANDLE;
   }

   g_quoteHandle = FileOpen(desiredName,
      FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',');
   if(g_quoteHandle == INVALID_HANDLE)
   {
      Print("[BROKER RECORDER] Cannot open quote file ", desiredName,
            "; error=", GetLastError());
      return false;
   }

   if(FileSize(g_quoteHandle) == 0)
   {
      FileWrite(g_quoteHandle,
         "timestamp_server",
         "timestamp_server_epoch",
         "timestamp_utc_estimate",
         "server_utc_offset_seconds",
         "symbol",
         "bid",
         "ask",
         "spread_price",
         "spread_points",
         "point",
         "digits",
         "tick_sequence");
      FileFlush(g_quoteHandle);
   }

   FileSeek(g_quoteHandle, 0, SEEK_END);
   g_quoteFileName = desiredName;
   g_quoteDateKey = DateKey(serverTime);
   return true;
}

bool IsMarketOrder(int orderType)
{
   return orderType == OP_BUY || orderType == OP_SELL;
}

string SideName(int orderType)
{
   if(orderType == OP_BUY) return "BUY";
   if(orderType == OP_SELL) return "SELL";
   return "UNKNOWN";
}

string TicketGlobalKey(int ticket)
{
   // Account number stays local to this terminal; it is not written to export files.
   return "GBRec_" + IntegerToString(AccountNumber()) + "_" + IntegerToString(ticket);
}

bool AppendClosedOrder(int ticket)
{
   string fileName = OrdersFileName();
   int h = FileOpen(fileName,
      FILE_READ | FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',');
   if(h == INVALID_HANDLE)
   {
      Print("[BROKER RECORDER] Cannot open order file ", fileName,
            "; error=", GetLastError());
      return false;
   }

   if(FileSize(h) == 0)
   {
      FileWrite(h,
         "record_type",
         "ticket",
         "symbol",
         "side",
         "lots",
         "open_time_server",
         "open_time_server_epoch",
         "close_time_server",
         "close_time_server_epoch",
         "open_price",
         "close_price",
         "stop_loss",
         "take_profit",
         "profit_before_costs",
         "commission",
         "swap",
         "net_profit",
         "magic_number",
         "account_currency",
         "comment");
   }
   FileSeek(h, 0, SEEK_END);

   double profit = OrderProfit();
   double commission = OrderCommission();
   double swap = OrderSwap();
   datetime opened = OrderOpenTime();
   datetime closed = OrderCloseTime();

   FileWrite(h,
      "closed_trade",
      IntegerToString(ticket),
      OrderSymbol(),
      SideName(OrderType()),
      DoubleToString(OrderLots(), 2),
      TimeToString(opened, TIME_DATE | TIME_SECONDS),
      IntegerToString((int)opened),
      TimeToString(closed, TIME_DATE | TIME_SECONDS),
      IntegerToString((int)closed),
      DoubleToString(OrderOpenPrice(), Digits),
      DoubleToString(OrderClosePrice(), Digits),
      DoubleToString(OrderStopLoss(), Digits),
      DoubleToString(OrderTakeProfit(), Digits),
      DoubleToString(profit, 2),
      DoubleToString(commission, 2),
      DoubleToString(swap, 2),
      DoubleToString(profit + commission + swap, 2),
      IntegerToString(OrderMagicNumber()),
      AccountCurrency(),
      OrderComment());

   FileFlush(h);
   FileClose(h);
   g_ordersWritten++;
   return true;
}

void ScanClosedHistory()
{
   int total = OrdersHistoryTotal();
   for(int i = total - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      if(!IsMarketOrder(OrderType()))
         continue;
      if(!SelectChartSymbol(OrderSymbol()))
         continue;
      if(OrderCloseTime() <= 0)
         continue;

      int ticket = OrderTicket();
      string key = TicketGlobalKey(ticket);
      if(GlobalVariableCheck(key))
         continue;

      if(AppendClosedOrder(ticket))
      {
         GlobalVariableSet(key, (double)TimeCurrent());
         Print("[BROKER RECORDER] Exported closed trade ticket=", ticket,
               " symbol=", OrderSymbol(),
               " net=", DoubleToString(OrderProfit() + OrderCommission() + OrderSwap(), 2));
      }
   }
}

int OnInit()
{
   EventSetTimer(MathMax(1, TimerSeconds));
   Print("[BROKER RECORDER] Started in read-only mode. Symbol=", Symbol(),
         "; order sending/modification is not implemented.");
   if(RecordClosedHistoryOnStartup)
      ScanClosedHistory();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_quoteHandle != INVALID_HANDLE)
   {
      FileFlush(g_quoteHandle);
      FileClose(g_quoteHandle);
      g_quoteHandle = INVALID_HANDLE;
   }
   Print("[BROKER RECORDER] Stopped. Quote rows=", g_quotesWritten,
         "; order rows=", g_ordersWritten,
         ". CSV files are in MQL4/Files.");
}

void OnTimer()
{
   ScanClosedHistory();
}

void OnTick()
{
   datetime serverTime = TimeCurrent();
   double bid = MarketInfo(Symbol(), MODE_BID);
   double ask = MarketInfo(Symbol(), MODE_ASK);
   double pointValue = MarketInfo(Symbol(), MODE_POINT);
   int digitsValue = (int)MarketInfo(Symbol(), MODE_DIGITS);

   if(serverTime <= 0 || bid <= 0.0 || ask < bid || pointValue <= 0.0)
      return;
   if(bid == g_lastBid && ask == g_lastAsk)
      return;
   if(!EnsureQuoteFile(serverTime))
      return;

   datetime utcNow = TimeGMT();
   int offsetSeconds = (int)(serverTime - utcNow);
   datetime utcEstimate = serverTime - offsetSeconds;
   double spread = ask - bid;

   g_tickSequence++;
   FileWrite(g_quoteHandle,
      TimeToString(serverTime, TIME_DATE | TIME_SECONDS),
      IntegerToString((int)serverTime),
      TimeToString(utcEstimate, TIME_DATE | TIME_SECONDS),
      IntegerToString(offsetSeconds),
      Symbol(),
      DoubleToString(bid, digitsValue),
      DoubleToString(ask, digitsValue),
      DoubleToString(spread, digitsValue),
      DoubleToString(spread / pointValue, 1),
      DoubleToString(pointValue, digitsValue),
      IntegerToString(digitsValue),
      IntegerToString((int)g_tickSequence));

   g_quotesWritten++;
   if((g_quotesWritten % 100) == 0)
      FileFlush(g_quoteHandle);

   g_lastBid = bid;
   g_lastAsk = ask;
   g_lastServerTime = serverTime;
}
