#property strict
#property version   "1.00"
#property description "Demo-only quote and execution-cost logger. Manual probe orders are disabled by default."

// SAFETY: this EA refuses to initialize on a non-demo account.
// It never trades automatically. BUY/SELL/CLOSE buttons can send/close a tiny
// demo probe order only when EnableDemoProbeOrders=true and the chart symbol
// exactly matches ExpectedSymbol. It is NOT the H4/H1 strategy EA.

input string ExpectedSymbol = "GOLD#";
input bool   EnableDemoProbeOrders = false; // Must be explicitly enabled in a DEMO terminal to use buttons
input double ProbeLots = 0.01;
input int    SlippagePoints = 50;
input int    ProbeMagicNumber = 92610261;
input int    MaxOpenProbeOrders = 1;
input int    TimerSeconds = 1;
input int    FlushEveryNRows = 100;

int g_quotes = INVALID_HANDLE;
int g_events = INVALID_HANDLE;
int g_quoteRows = 0;
int g_eventRows = 0;
int g_seq = 0;
string g_buyBtn = "GDEMO_BUY";
string g_sellBtn = "GDEMO_SELL";
string g_closeBtn = "GDEMO_CLOSE";

bool IsDemoAccount()
{
   return (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO);
}

string Stamp(datetime t)
{
   if(t <= 0) return "";
   return TimeToString(t, TIME_DATE | TIME_SECONDS);
}

string NumOrBlank(double x, int digits)
{
   if(x == EMPTY_VALUE) return "";
   return DoubleToString(x, digits);
}

string TicketGlobal(string stem, int ticket)
{
   return "GDEMO_" + IntegerToString(ProbeMagicNumber) + "_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + stem + "_" + IntegerToString(ticket);
}

void EnsureAppendFile(int &handle, string name, string header)
{
   handle = FileOpen(name, FILE_CSV | FILE_READ | FILE_WRITE | FILE_SHARE_READ, ',');
   if(handle == INVALID_HANDLE)
   {
      Print("GDEMO logger: cannot open ", name, "; error=", GetLastError());
      return;
   }
   bool newFile = (FileSize(handle) == 0);
   FileSeek(handle, 0, SEEK_END);
   if(newFile) FileWriteString(handle, header + "\r\n");
   FileFlush(handle);
}

void WriteQuote()
{
   if(g_quotes == INVALID_HANDLE || Bid <= 0 || Ask <= 0 || Ask < Bid) return;
   datetime serverTime = TimeCurrent();
   datetime gmtTime = TimeGMT();
   double point = MarketInfo(Symbol(), MODE_POINT);
   double spread = Ask - Bid;
   FileWrite(g_quotes,
      Stamp(serverTime), Stamp(gmtTime), (long)(serverTime - gmtTime), Symbol(),
      DoubleToString(Bid, Digits), DoubleToString(Ask, Digits),
      DoubleToString(spread, Digits),
      DoubleToString(point > 0 ? spread / point : 0, 2),
      (IsConnected() ? 1 : 0));
   g_quoteRows++;
   if(FlushEveryNRows <= 1 || g_quoteRows >= FlushEveryNRows)
   {
      FileFlush(g_quotes);
      g_quoteRows = 0;
   }
}

// requestPrice/fillPrice are prices for the same operation. Slippage is
// signed adverse cost: positive=worse than quoted, negative=price improvement.
void WriteEvent(string eventName, string requestId, int ticket, string side,
                double lots, double requestPrice, double fillPrice,
                bool hasSlippage, double adverseSlippage,
                double bidBefore, double askBefore, double spreadBefore,
                bool hasCosts, double commission, double swap, double grossProfit,
                datetime openTime, datetime closeTime, int errorCode, string detail)
{
   if(g_events == INVALID_HANDLE) return;
   datetime st = TimeCurrent();
   datetime gt = TimeGMT();
   double point = MarketInfo(Symbol(), MODE_POINT);
   double net = grossProfit + commission + swap;
   double heldMinutes = (openTime > 0 && closeTime > 0) ? (closeTime - openTime) / 60.0 : EMPTY_VALUE;
   FileWrite(g_events,
      eventName, requestId, Stamp(st), Stamp(gt), (long)(st - gt), AccountCurrency(),
      Symbol(), ticket, ProbeMagicNumber, side, NumOrBlank(lots, 2),
      NumOrBlank(requestPrice, Digits), NumOrBlank(fillPrice, Digits),
      hasSlippage ? DoubleToString(adverseSlippage, Digits) : "",
      (hasSlippage && point > 0) ? DoubleToString(adverseSlippage / point, 2) : "",
      NumOrBlank(bidBefore, Digits), NumOrBlank(askBefore, Digits), NumOrBlank(spreadBefore, Digits),
      hasCosts ? DoubleToString(commission, 2) : "",
      hasCosts ? DoubleToString(swap, 2) : "",
      hasCosts ? DoubleToString(grossProfit, 2) : "",
      hasCosts ? DoubleToString(net, 2) : "",
      Stamp(openTime), Stamp(closeTime), NumOrBlank(heldMinutes, 2), errorCode, detail);
   g_eventRows++;
   if(FlushEveryNRows <= 1 || g_eventRows >= FlushEveryNRows)
   {
      FileFlush(g_events);
      g_eventRows = 0;
   }
}

int CountOpenProbeOrders()
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != ProbeMagicNumber) continue;
      if(OrderType() == OP_BUY || OrderType() == OP_SELL) count++;
   }
   return count;
}

bool ValidateProbePermission()
{
   if(!IsDemoAccount())
   {
      Print("GDEMO BLOCKED: this logger is demo-only; account trade mode is not DEMO.");
      return false;
   }
   if(Symbol() != ExpectedSymbol)
   {
      Print("GDEMO BLOCKED: chart symbol '", Symbol(), "' does not exactly match ExpectedSymbol '", ExpectedSymbol, "'.");
      return false;
   }
   if(!EnableDemoProbeOrders)
   {
      Print("GDEMO: order buttons are disabled. Set EnableDemoProbeOrders=true only on a demo account to send manual probe orders.");
      return false;
   }
   if(ProbeLots <= 0 || ProbeLots < MarketInfo(Symbol(), MODE_MINLOT) || ProbeLots > MarketInfo(Symbol(), MODE_MAXLOT))
   {
      Print("GDEMO BLOCKED: ProbeLots is outside broker min/max volume for ", Symbol());
      return false;
   }
   double step = MarketInfo(Symbol(), MODE_LOTSTEP);
   if(step > 0 && MathAbs(ProbeLots / step - MathRound(ProbeLots / step)) > 1e-7)
   {
      Print("GDEMO BLOCKED: ProbeLots is not aligned to broker lot step ", DoubleToString(step, 4));
      return false;
   }
   if(CountOpenProbeOrders() >= MaxOpenProbeOrders)
   {
      Print("GDEMO BLOCKED: MaxOpenProbeOrders has been reached.");
      return false;
   }
   return true;
}

void SendDemoProbe(int orderType)
{
   if(orderType != OP_BUY && orderType != OP_SELL) return;
   if(!ValidateProbePermission()) return;
   if(!IsTradeAllowed())
   {
      Print("GDEMO: trading is not allowed by terminal/EA settings; no order sent.");
      return;
   }
   RefreshRates();
   double requested = (orderType == OP_BUY ? Ask : Bid);
   double bidBefore = Bid, askBefore = Ask, spreadBefore = Ask - Bid;
   datetime reqGmt = TimeGMT();
   string side = (orderType == OP_BUY ? "BUY" : "SELL");
   string requestId = "ENTRY_" + IntegerToString((int)reqGmt) + "_" + IntegerToString(++g_seq);
   string comment = "GDEMO_" + IntegerToString((int)reqGmt) + "_" + IntegerToString(g_seq);
   WriteEvent("ENTRY_REQUEST", requestId, 0, side, ProbeLots, requested, EMPTY_VALUE,
              false, EMPTY_VALUE, bidBefore, askBefore, spreadBefore, false,
              EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, 0, 0, 0,
              "Manual demo probe only; no SL/TP is attached; monitor and close manually.");
   ResetLastError();
   int ticket = OrderSend(Symbol(), orderType, ProbeLots, requested, SlippagePoints,
                          0, 0, comment, ProbeMagicNumber, 0, clrNONE);
   int err = GetLastError();
   if(ticket < 0)
   {
      WriteEvent("ENTRY_REJECTED", requestId, 0, side, ProbeLots, requested, EMPTY_VALUE,
                 false, EMPTY_VALUE, bidBefore, askBefore, spreadBefore, false,
                 EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, 0, 0, err,
                 "OrderSend failed; inspect terminal/server logs.");
      Print("GDEMO: OrderSend failed, error=", err);
      return;
   }
   if(OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES))
   {
      double fill = OrderOpenPrice();
      double adverse = (orderType == OP_BUY ? fill - requested : requested - fill);
      GlobalVariableSet(TicketGlobal("ENTRY_REQ", ticket), requested);
      GlobalVariableSet(TicketGlobal("ENTRY_TIME", ticket), (double)reqGmt);
      WriteEvent("ENTRY_FILL", requestId, ticket, side, OrderLots(), requested, fill,
                 true, adverse, bidBefore, askBefore, spreadBefore, false,
                 EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, OrderOpenTime(), 0, 0,
                 "Exact quote submitted to this EA's OrderSend; costs will be recorded from history on close.");
   }
   else
   {
      WriteEvent("ENTRY_TICKET_SELECT_FAILED", requestId, ticket, side, ProbeLots, requested,
                 EMPTY_VALUE, false, EMPTY_VALUE, bidBefore, askBefore, spreadBefore, false,
                 EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, 0, 0, GetLastError(),
                 "OrderSend returned a ticket but OrderSelect failed; reconcile terminal history.");
   }
   Print("GDEMO: probe order ticket=", ticket, " side=", side, " lots=", DoubleToString(ProbeLots, 2), ". No SL/TP attached.");
}

void CloseLatestDemoProbe()
{
   if(!IsDemoAccount() || Symbol() != ExpectedSymbol)
   {
      Print("GDEMO BLOCKED: close action requires demo account and exact symbol. New orders require EnableDemoProbeOrders=true.");
      return;
   }
   int chosen = -1; datetime latest = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != ProbeMagicNumber) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      if(OrderOpenTime() >= latest) { latest = OrderOpenTime(); chosen = OrderTicket(); }
   }
   if(chosen < 0) { Print("GDEMO: no open probe order to close."); return; }
   if(!OrderSelect(chosen, SELECT_BY_TICKET, MODE_TRADES)) return;
   int type = OrderType(); double lots = OrderLots(); string side = (type == OP_BUY ? "BUY" : "SELL");
   RefreshRates();
   double requested = (type == OP_BUY ? Bid : Ask);
   double bidBefore = Bid, askBefore = Ask, spreadBefore = Ask - Bid;
   string requestId = "CLOSE_" + IntegerToString(chosen);
   WriteEvent("CLOSE_REQUEST", requestId, chosen, side, lots, requested, EMPTY_VALUE,
              false, EMPTY_VALUE, bidBefore, askBefore, spreadBefore, false,
              EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, OrderOpenTime(), 0, 0,
              "Close requested by demo logger button.");
   GlobalVariableSet(TicketGlobal("EXIT_REQ", chosen), requested);
   GlobalVariableSet(TicketGlobal("EXIT_BID", chosen), bidBefore);
   GlobalVariableSet(TicketGlobal("EXIT_ASK", chosen), askBefore);
   GlobalVariableSet(TicketGlobal("EXIT_SPREAD", chosen), spreadBefore);
   GlobalVariableSet(TicketGlobal("EXIT_GMT", chosen), (double)TimeGMT());
   ResetLastError();
   bool ok = OrderClose(chosen, lots, requested, SlippagePoints, clrNONE);
   int err = GetLastError();
   if(!ok)
   {
      GlobalVariableDel(TicketGlobal("EXIT_REQ", chosen));
      GlobalVariableDel(TicketGlobal("EXIT_BID", chosen));
      GlobalVariableDel(TicketGlobal("EXIT_ASK", chosen));
      GlobalVariableDel(TicketGlobal("EXIT_SPREAD", chosen));
      GlobalVariableDel(TicketGlobal("EXIT_GMT", chosen));
      WriteEvent("CLOSE_REJECTED", requestId, chosen, side, lots, requested, EMPTY_VALUE,
                 false, EMPTY_VALUE, bidBefore, askBefore, spreadBefore, false,
                 EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, latest, 0, err,
                 "OrderClose failed; retry manually after inspecting terminal/server logs.");
      Print("GDEMO: OrderClose failed, error=", err);
      return;
   }
   ScanHistoryForFinalCosts();
}

void ScanOpenOrdersForCostChanges()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != ProbeMagicNumber) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      int ticket = OrderTicket();
      string swKey = TicketGlobal("LAST_SWAP", ticket);
      string cmKey = TicketGlobal("LAST_COMMISSION", ticket);
      double sw = OrderSwap(), cm = OrderCommission();
      bool changed = !GlobalVariableCheck(swKey) || !GlobalVariableCheck(cmKey) ||
                     MathAbs(GlobalVariableGet(swKey) - sw) > 0.0000001 ||
                     MathAbs(GlobalVariableGet(cmKey) - cm) > 0.0000001;
      if(changed)
      {
         string side = (OrderType() == OP_BUY ? "BUY" : "SELL");
         WriteEvent("OPEN_COST_SNAPSHOT", "OPEN_" + IntegerToString(ticket), ticket, side,
                    OrderLots(), EMPTY_VALUE, OrderOpenPrice(), false, EMPTY_VALUE,
                    EMPTY_VALUE, EMPTY_VALUE, EMPTY_VALUE, true, cm, sw, OrderProfit(),
                    OrderOpenTime(), 0, 0,
                    "Snapshot of OrderCommission/OrderSwap/OrderProfit while position remains open; broker may update values.");
         GlobalVariableSet(swKey, sw); GlobalVariableSet(cmKey, cm);
      }
   }
}

void ScanHistoryForFinalCosts()
{
   for(int i = OrdersHistoryTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderSymbol() != Symbol() || OrderMagicNumber() != ProbeMagicNumber) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      int ticket = OrderTicket();
      string doneKey = TicketGlobal("FINAL_LOGGED", ticket);
      if(GlobalVariableCheck(doneKey)) continue;
      double requested = EMPTY_VALUE, adverse = EMPTY_VALUE, bidBefore = EMPTY_VALUE, askBefore = EMPTY_VALUE, spreadBefore = EMPTY_VALUE;
      bool hasSlip = false;
      if(GlobalVariableCheck(TicketGlobal("EXIT_REQ", ticket)))
      {
         requested = GlobalVariableGet(TicketGlobal("EXIT_REQ", ticket));
         bidBefore = GlobalVariableGet(TicketGlobal("EXIT_BID", ticket));
         askBefore = GlobalVariableGet(TicketGlobal("EXIT_ASK", ticket));
         spreadBefore = GlobalVariableGet(TicketGlobal("EXIT_SPREAD", ticket));
         if(OrderType() == OP_BUY) adverse = requested - OrderClosePrice();
         else adverse = OrderClosePrice() - requested;
         hasSlip = true;
      }
      string side = (OrderType() == OP_BUY ? "BUY" : "SELL");
      string requestId = "CLOSE_" + IntegerToString(ticket);
      WriteEvent("CLOSE_FINAL", requestId, ticket, side, OrderLots(), requested,
                 OrderClosePrice(), hasSlip, adverse, bidBefore, askBefore, spreadBefore,
                 true, OrderCommission(), OrderSwap(), OrderProfit(), OrderOpenTime(),
                 OrderCloseTime(), 0,
                 hasSlip ? "Realized history costs; close slippage measured against this logger's immediately pre-close quote."
                         : "Realized history costs recorded; close slippage not measured because no pre-close reference quote was captured.");
      GlobalVariableSet(doneKey, 1.0);
      string keys[6];
      keys[0]=TicketGlobal("EXIT_REQ",ticket); keys[1]=TicketGlobal("EXIT_BID",ticket);
      keys[2]=TicketGlobal("EXIT_ASK",ticket); keys[3]=TicketGlobal("EXIT_SPREAD",ticket);
      keys[4]=TicketGlobal("EXIT_GMT",ticket); keys[5]=TicketGlobal("LAST_SWAP",ticket);
      for(int k=0;k<ArraySize(keys);k++) if(GlobalVariableCheck(keys[k])) GlobalVariableDel(keys[k]);
      if(GlobalVariableCheck(TicketGlobal("LAST_COMMISSION",ticket))) GlobalVariableDel(TicketGlobal("LAST_COMMISSION",ticket));
   }
}

void MakeButton(string name, string text, int x, int y, int width, color bg)
{
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, width);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, 24);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
}

int OnInit()
{
   if(!IsDemoAccount())
   {
      Print("GDEMO logger refused to initialize: account is not a DEMO account. No logs or orders started.");
      return INIT_FAILED;
   }
   if(Symbol() != ExpectedSymbol)
   {
      Print("GDEMO logger refused to initialize: chart symbol '", Symbol(), "' != ExpectedSymbol '", ExpectedSymbol, "'.");
      return INIT_FAILED;
   }
   EnsureAppendFile(g_quotes, "GOLD_DemoQuoteLog.csv",
      "server_time,gmt_time,server_minus_gmt_seconds,symbol,bid,ask,spread_price,spread_points,connected");
   EnsureAppendFile(g_events, "GOLD_DemoExecutionEvents.csv",
      "event,request_id,server_time,gmt_time,server_minus_gmt_seconds,account_currency,symbol,ticket,magic,side,lots,requested_price,fill_price,slippage_adverse_price,slippage_adverse_points,bid_before,ask_before,spread_before,commission_account_ccy,swap_account_ccy,profit_or_floating_account_ccy,net_profit_after_costs_account_ccy,open_time,close_time,holding_minutes,error_code,detail");
   if(g_quotes == INVALID_HANDLE || g_events == INVALID_HANDLE) return INIT_FAILED;
   MakeButton(g_buyBtn,  "BUY DEMO PROBE", 10, 22, 130, clrSeaGreen);
   MakeButton(g_sellBtn, "SELL DEMO PROBE", 145, 22, 130, clrFireBrick);
   MakeButton(g_closeBtn,"CLOSE LATEST PROBE", 280, 22, 150, clrDimGray);
   int seconds = (TimerSeconds < 1 ? 1 : TimerSeconds);
   EventSetTimer(seconds);
   Comment("GOLD DEMO COST LOGGER\nDemo account only; quote logging active.\nManual orders: ",
           (EnableDemoProbeOrders ? "ENABLED - buttons can place 0.01 lot demo orders" : "OFF - no orders can be sent"),
           "\nExpected symbol: ", ExpectedSymbol,
           "\nOutput: MQL4/Files/GOLD_DemoQuoteLog.csv and GOLD_DemoExecutionEvents.csv\nNo automatic orders, SL or TP.");
   Print("GDEMO logger started on demo account. EnableDemoProbeOrders=", EnableDemoProbeOrders,
         ". No order sent on initialization.");
   return INIT_SUCCEEDED;
}

void OnTick() { WriteQuote(); }

void OnTimer()
{
   ScanOpenOrdersForCostChanges();
   ScanHistoryForFinalCosts();
   if(g_quotes != INVALID_HANDLE) FileFlush(g_quotes);
   if(g_events != INVALID_HANDLE) FileFlush(g_events);
}

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(sparam == g_buyBtn) SendDemoProbe(OP_BUY);
   else if(sparam == g_sellBtn) SendDemoProbe(OP_SELL);
   else if(sparam == g_closeBtn) CloseLatestDemoProbe();
   if(ObjectFind(0, sparam) >= 0) ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_quotes != INVALID_HANDLE) { FileFlush(g_quotes); FileClose(g_quotes); g_quotes = INVALID_HANDLE; }
   if(g_events != INVALID_HANDLE) { FileFlush(g_events); FileClose(g_events); g_events = INVALID_HANDLE; }
   ObjectDelete(0, g_buyBtn); ObjectDelete(0, g_sellBtn); ObjectDelete(0, g_closeBtn);
   Comment("");
   Print("GDEMO logger stopped. It did not place any automatic orders.");
}