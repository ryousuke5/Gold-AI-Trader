#property strict
#property version "1.1"
#property description "XAUUSD AI Trader V1 - XM MT4 bridge. Live trading is OFF by default."

input string ApiBaseUrl = "https://gold-ai-trader-2uny.onrender.com";
input string ApiKey = "CHANGE_ME";
input string SymbolName = "";
input bool RequireGoldSymbol = true;
input bool EnableSignalRequests = true;
input bool AllowAutoOrders = false;
input int TimerSeconds = 5;
input int MagicNumber = 26092801;
input int SlippagePoints = 50;
input double MaxSpreadPrice = 0.50;
input int MaxSignalAgeSeconds = 90;
input bool SendRecentBars = true;
input int RecentM5Bars = 12;
input int RecentH1Bars = 8;

long lastBarTime = 0;
string lastSignalId = "";

string TradeSymbol() {
   if(StringLen(StringTrimRight(StringTrimLeft(SymbolName))) > 0) return StringTrimRight(StringTrimLeft(SymbolName));
   return Symbol();
}
bool IsGoldSymbol(string sym) {
   if(!RequireGoldSymbol) return true;
   if(StringFind(sym, "XAU") >= 0) return true;
   if(StringFind(sym, "xau") >= 0) return true;
   if(StringFind(sym, "GOLD") >= 0) return true;
   if(StringFind(sym, "gold") >= 0) return true;
   return false;
}
string JsonNumber(double value) { return DoubleToString(value, 10); }
string JsonEscape(string value) {
   StringReplace(value, "\", "\\");
   StringReplace(value, """, "\"");
   return value;
}
bool AllowedSignalHost() { return StringFind(ApiBaseUrl, "https://") == 0 && StringLen(ApiBaseUrl) >= 12; }
string BarJson(string sym, ENUM_TIMEFRAMES tf, int count) {
   int available = iBars(sym, tf); int n = MathMin(count, MathMax(0, available - 1)); string out = "[";
   for(int shift=1; shift<=n; shift++) {
      if(shift>1) out += ",";
      out += "{"time":"+IntegerToString((int)iTime(sym,tf,shift))+","open":"+JsonNumber(iOpen(sym,tf,shift))+","high":"+JsonNumber(iHigh(sym,tf,shift))+","low":"+JsonNumber(iLow(sym,tf,shift))+","close":"+JsonNumber(iClose(sym,tf,shift))+","volume":"+IntegerToString((int)iVolume(sym,tf,shift))+"}";
   }
   out += "]"; return out;
}
double DailyRealized(string sym) {
   datetime dayStart=StrToTime(TimeToString(TimeCurrent(),TIME_DATE)); double realized=0;
   for(int h=OrdersHistoryTotal()-1;h>=0;h--){if(!OrderSelect(h,SELECT_BY_POS,MODE_HISTORY))continue;if(OrderSymbol()!=sym||OrderMagicNumber()!=MagicNumber)continue;if(OrderCloseTime()>=dayStart)realized+=OrderProfit()+OrderSwap()+OrderCommission();}
   return realized;
}
int OpenPositions(string sym){int count=0;for(int i=OrdersTotal()-1;i>=0;i--){if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;if(OrderSymbol()==sym&&OrderMagicNumber()==MagicNumber&&(OrderType()==OP_BUY||OrderType()==OP_SELL))count++;}return count;}
bool BuildPayload(string &json){
   string sym=TradeSymbol();RefreshRates();
   double bid=MarketInfo(sym,MODE_BID),ask=MarketInfo(sym,MODE_ASK),point=MarketInfo(sym,MODE_POINT),spread=ask-bid,spreadPoints=point>0?spread/point:0,equity=AccountEquity(),balance=AccountBalance();
   double dailyRealized=DailyRealized(sym),dayStartBalance=balance-dailyRealized;
   double peakEquity=GlobalVariableCheck("GoldAI:peakEquity")?GlobalVariableGet("GoldAI:peakEquity"):equity;if(equity>peakEquity){peakEquity=equity;GlobalVariableSet("GoldAI:peakEquity",peakEquity);}
   double drawdownPct=peakEquity>0?((peakEquity-equity)/peakEquity)*100:0,dailyPnlPct=dayStartBalance>0?((equity-dayStartBalance)/dayStartBalance)*100:0;
   double tickSize=MarketInfo(sym,MODE_TICKSIZE),tickValue=MarketInfo(sym,MODE_TICKVALUE),minLot=MarketInfo(sym,MODE_MINLOT),maxLot=MarketInfo(sym,MODE_MAXLOT),lotStep=MarketInfo(sym,MODE_LOTSTEP);
   int digits=(int)MarketInfo(sym,MODE_DIGITS),stopLevel=(int)MarketInfo(sym,MODE_STOPLEVEL),freezeLevel=(int)MarketInfo(sym,MODE_FREEZELEVEL),tradeAllowed=(int)MarketInfo(sym,MODE_TRADEALLOWED);
   bool riskReady=equity>0&&point>0&&tickSize>0&&tickValue>0&&minLot>0&&maxLot>=minLot&&lotStep>0;
   datetime barOpen=iTime(sym,PERIOD_M5,1);if(barOpen<=0)return false;datetime barClose=barOpen+300;
   double m5Ema20=iMA(sym,PERIOD_M5,20,0,MODE_EMA,PRICE_CLOSE,1),m5Ema50=iMA(sym,PERIOD_M5,50,0,MODE_EMA,PRICE_CLOSE,1),m5Rsi=iRSI(sym,PERIOD_M5,14,PRICE_CLOSE,1),m5Atr=iATR(sym,PERIOD_M5,14,1);
   double m5High20=iHigh(sym,PERIOD_M5,iHighest(sym,PERIOD_M5,MODE_HIGH,20,1)),m5Low20=iLow(sym,PERIOD_M5,iLowest(sym,PERIOD_M5,MODE_LOW,20,1));
   double h1Ema20=iMA(sym,PERIOD_H1,20,0,MODE_EMA,PRICE_CLOSE,1),h1Ema50=iMA(sym,PERIOD_H1,50,0,MODE_EMA,PRICE_CLOSE,1),h1Ema200=iMA(sym,PERIOD_H1,200,0,MODE_EMA,PRICE_CLOSE,1),h1Rsi=iRSI(sym,PERIOD_H1,14,PRICE_CLOSE,1),h1Atr=iATR(sym,PERIOD_H1,14,1);
   json="{"symbol":""+JsonEscape(sym)+"","timeframe":"M5","features":{"bid":"+JsonNumber(bid)+","ask":"+JsonNumber(ask)+","point":"+JsonNumber(point)+","spread":"+JsonNumber(spread)+","spread_points":"+JsonNumber(spreadPoints)+","bar_time":"+IntegerToString((int)barClose)+","m5":{"ema20":"+JsonNumber(m5Ema20)+","ema50":"+JsonNumber(m5Ema50)+","rsi14":"+JsonNumber(m5Rsi)+","atr14":"+JsonNumber(m5Atr)+","high20":"+JsonNumber(m5High20)+","low20":"+JsonNumber(m5Low20)+"},"h1":{"ema20":"+JsonNumber(h1Ema20)+","ema50":"+JsonNumber(h1Ema50)+","ema200":"+JsonNumber(h1Ema200)+","rsi14":"+JsonNumber(h1Rsi)+","atr14":"+JsonNumber(h1Atr)+"},"recent_m5":"+(SendRecentBars?BarJson(sym,PERIOD_M5,RecentM5Bars):"[]")+","recent_h1":"+(SendRecentBars?BarJson(sym,PERIOD_H1,RecentH1Bars):"[]")+"},"account":{"equity":"+JsonNumber(equity)+","balance":"+JsonNumber(balance)+","open_positions":"+IntegerToString(OpenPositions(sym))+","daily_pnl_pct":"+JsonNumber(dailyPnlPct)+","drawdown_pct":"+JsonNumber(drawdownPct)+","tick_size":"+JsonNumber(tickSize)+","tick_value":"+JsonNumber(tickValue)+","min_lot":"+JsonNumber(minLot)+","max_lot":"+JsonNumber(maxLot)+","lot_step":"+JsonNumber(lotStep)+","point":"+JsonNumber(point)+","digits":"+IntegerToString(digits)+","stop_level_points":"+IntegerToString(stopLevel)+","freeze_level_points":"+IntegerToString(freezeLevel)+","trade_allowed":"+IntegerToString(tradeAllowed)+","risk_data_ready":"+(riskReady?"true":"false")+"}}";
   return true;
}
bool PostJson(string path,string payload,string &response){
   if(!AllowedSignalHost())return false;string url=ApiBaseUrl+path;string headers="Content-Type: application/json\r\nX-Gold-API-Key: "+ApiKey+"\r\nX-Request-Id: "+IntegerToString(GetTickCount())+"\r\n";char post[],result[];StringToCharArray(payload,post,0,WHOLE_ARRAY,CP_UTF8);string resultHeaders;ResetLastError();int code=WebRequest("POST",url,headers,8000,post,result,resultHeaders);
   if(code<200||code>=300){Print("GoldAI WebRequest failed HTTP=",code," err=",GetLastError()," body=",CharArrayToString(result));return false;}response=CharArrayToString(result);return true;
}
string JsonGetString(string json,string key){string needle="""+key+"":"";int pos=StringFind(json,needle);if(pos<0)return "";pos+=StringLen(needle);int end=StringFind(json,""",pos);if(end<0)return "";return StringSubstr(json,pos,end-pos);}
double JsonGetNumber(string json,string key){string needle="""+key+"":";int pos=StringFind(json,needle);if(pos<0)return 0;pos+=StringLen(needle);int e1=StringFind(json,",",pos),e2=StringFind(json,"}",pos),e3=StringFind(json,"]",pos),end=-1;if(e1>=0)end=e1;if(e2>=0&&(end<0||e2<end))end=e2;if(e3>=0&&(end<0||e3<end))end=e3;if(end<0)return 0;return StrToDouble(StringTrimLeft(StringTrimRight(StringSubstr(json,pos,end-pos))));}
bool JsonGetBool(string json,string key){string needle="""+key+"":";int pos=StringFind(json,needle);if(pos<0)return false;pos+=StringLen(needle);string v=StringSubstr(json,pos,5);return StringFind(v,"true")==0;}
bool SignalExpired(string response){double exp=JsonGetNumber(response,"expires_at_epoch");return exp<=0||TimeCurrent()>((datetime)exp);}
bool HasSignalOrderTag(string tag,string sym){for(int i=OrdersTotal()-1;i>=0;i--){if(!OrderSelect(i,SELECT_BY_POS,MODE_TRADES))continue;if(OrderSymbol()==sym&&OrderMagicNumber()==MagicNumber&&StringFind(OrderComment(),tag)>=0)return true;}for(int h=OrdersHistoryTotal()-1;h>=0;h--){if(!OrderSelect(h,SELECT_BY_POS,MODE_HISTORY))continue;if(OrderSymbol()==sym&&OrderMagicNumber()==MagicNumber&&StringFind(OrderComment(),tag)>=0)return true;}return false;}
bool ValidateLocalTrade(string sym,string decision,double sl,double tp,double lots){RefreshRates();double bid=MarketInfo(sym,MODE_BID),ask=MarketInfo(sym,MODE_ASK),point=MarketInfo(sym,MODE_POINT);if(bid<=0||ask<=0||point<=0)return false;if((ask-bid)>MaxSpreadPrice)return false;double minDistance=MathMax(MarketInfo(sym,MODE_STOPLEVEL)*point,MarketInfo(sym,MODE_FREEZELEVEL)*point);double current=decision=="BUY"?ask:bid;if(decision=="BUY"&&(!(sl<current&&tp>current)||current-sl<minDistance||tp-current<minDistance))return false;if(decision=="SELL"&&(!(sl>current&&tp<current)||sl-current<minDistance||current-tp<minDistance))return false;if(AccountFreeMarginCheck(sym,decision=="BUY"?OP_BUY:OP_SELL,lots)<=0)return false;return true;}
void SendExecutionResult(string signalId,string sym,string side,int ticket,double requested,double lots,double sl,double tp,int errorCode){string payload="{"signal_id":""+JsonEscape(signalId)+"","idempotency_key":""+JsonEscape(signalId)+"","symbol":""+JsonEscape(sym)+"","mt4_ticket":"+IntegerToString(ticket)+","side":""+JsonEscape(side)+"","requested_price":"+JsonNumber(requested)+","filled_price":"+JsonNumber(ticket>0&&OrderSelect(ticket,SELECT_BY_TICKET,MODE_TRADES)?OrderOpenPrice():0)+","volume":"+JsonNumber(lots)+","stop_loss":"+JsonNumber(sl)+","take_profit":"+JsonNumber(tp)+","status":""+(ticket>0?"FILLED":"REJECTED")+"","broker_error":""+IntegerToString(errorCode)+""}";string ignored;PostJson("/api/gold/execution-result",payload,ignored);}
string ExitReason(string sym,int type,double closePrice,double sl,double tp){double point=MarketInfo(sym,MODE_POINT),tolerance=MathMax(point*3.0,0.05);if(tp>0&&MathAbs(closePrice-tp)<=tolerance)return"TAKE_PROFIT";if(sl>0&&MathAbs(closePrice-sl)<=tolerance)return"STOP_LOSS";return"MANUAL_OR_OTHER";}
void SyncClosedTrades(){string sym=TradeSymbol();datetime lastSync=GlobalVariableCheck("GoldAI:lastClosedSync")?(datetime)GlobalVariableGet("GoldAI:lastClosedSync"):0,newest=lastSync;int total=OrdersHistoryTotal();for(int i=0;i<total;i++){if(!OrderSelect(i,SELECT_BY_POS,MODE_HISTORY))continue;if(OrderSymbol()!=sym||OrderMagicNumber()!=MagicNumber)continue;if(OrderType()!=OP_BUY&&OrderType()!=OP_SELL)continue;datetime ct=OrderCloseTime();if(ct<=lastSync)continue;if(ct>newest)newest=ct;double riskDistance=OrderStopLoss()>0?MathAbs(OrderOpenPrice()-OrderStopLoss()):0,rMultiple=0;if(riskDistance>0) {double pricePnl=MathAbs(OrderClosePrice()-OrderOpenPrice());rMultiple=pricePnl/riskDistance;bool favorable=(OrderType()==OP_BUY&&OrderClosePrice()>OrderOpenPrice())||(OrderType()==OP_SELL&&OrderClosePrice()<OrderOpenPrice());if(!favorable)rMultiple=-rMultiple;}double net=OrderProfit()+OrderSwap()+OrderCommission();string result=net>0?"WIN":(net<0?"LOSS":"BREAKEVEN");string payload="{"idempotency_key":"close:"+IntegerToString(OrderTicket())+":"+IntegerToString((int)ct)+"","mt4_ticket":"+IntegerToString(OrderTicket())+","symbol":""+JsonEscape(sym)+"","result":""+result+"","profit":"+JsonNumber(net)+","r_multiple":"+JsonNumber(rMultiple)+","holding_seconds":"+IntegerToString((int)MathMax(0,ct-OrderOpenTime()))+","exit_reason":""+ExitReason(sym,OrderType(),OrderClosePrice(),OrderStopLoss(),OrderTakeProfit())+"","metadata":{"lots":"+JsonNumber(OrderLots())+","open_price":"+JsonNumber(OrderOpenPrice())+","close_price":"+JsonNumber(OrderClosePrice())+","commission":"+JsonNumber(OrderCommission())+","swap":"+JsonNumber(OrderSwap())+"}}";string ignored;PostJson("/api/gold/trade-result",payload,ignored);}if(newest>lastSync)GlobalVariableSet("GoldAI:lastClosedSync",(double)newest);}
void ExecuteIfAllowed(string response){if(!AllowAutoOrders||!JsonGetBool(response,"order_allowed"))return;if(SignalExpired(response))return;string sym=TradeSymbol(),decision=JsonGetString(response,"decision");if(decision!="BUY"&&decision!="SELL")return;string signalId=JsonGetString(response,"signal_id");if(signalId=="")return;string tag="GAI:"+StringSubstr(signalId,0,12);if(signalId==lastSignalId||HasSignalOrderTag(tag,sym))return;double sl=JsonGetNumber(response,"stop_loss"),tp=JsonGetNumber(response,"take_profit"),lots=JsonGetNumber(response,"lots");int digits=(int)MarketInfo(sym,MODE_DIGITS);if(sl<=0||tp<=0||lots<=0)return;sl=NormalizeDouble(sl,digits);tp=NormalizeDouble(tp,digits);if(!ValidateLocalTrade(sym,decision,sl,tp,lots))return;RefreshRates();int type=decision=="BUY"?OP_BUY:OP_SELL;double price=NormalizeDouble(type==OP_BUY?MarketInfo(sym,MODE_ASK):MarketInfo(sym,MODE_BID),digits);ResetLastError();int ticket=OrderSend(sym,type,lots,price,SlippagePoints,sl,tp,tag,MagicNumber,0,clrNONE);int errorCode=GetLastError();SendExecutionResult(signalId,sym,decision,ticket,price,lots,sl,tp,errorCode);if(ticket>0){lastSignalId=signalId;GlobalVariableSet("GoldAI:lastSignalTime",(double)TimeCurrent());}}
void OnTimer(){if(!EnableSignalRequests)return;SyncClosedTrades();string sym=TradeSymbol();if(!IsGoldSymbol(sym))return;if(iBars(sym,PERIOD_H1)<250||iBars(sym,PERIOD_M5)<100)return;if(AllowAutoOrders&&!IsTradeAllowed())return;if((int)MarketInfo(sym,MODE_TRADEALLOWED)==0&&AllowAutoOrders)return;datetime closedBar=iTime(sym,PERIOD_M5,1);if(closedBar<=0||closedBar==lastBarTime)return;lastBarTime=closedBar;string payload,response;if(BuildPayload(payload)&&PostJson("/api/gold/signal",payload,response)){Print("GoldAI signal response: ",response);ExecuteIfAllowed(response);}}
int OnInit(){string sym=TradeSymbol();if(!AllowedSignalHost())return INIT_FAILED;if(StringLen(StringTrimRight(StringTrimLeft(ApiKey)))<16||ApiKey=="CHANGE_ME"){Print("GoldAITrader: set ApiKey before starting.");return INIT_FAILED;}if(!IsGoldSymbol(sym))return INIT_FAILED;if(!SymbolSelect(sym,true))return INIT_FAILED;if(TimerSeconds<1||MaxSpreadPrice<0||MaxSignalAgeSeconds<10)return INIT_FAILED;EventSetTimer(TimerSeconds);Print("GoldAITrader initialized symbol=",sym," digits=",(int)MarketInfo(sym,MODE_DIGITS)," point=",DoubleToString(MarketInfo(sym,MODE_POINT),10)," tickSize=",DoubleToString(MarketInfo(sym,MODE_TICKSIZE),10)," tickValue=",DoubleToString(MarketInfo(sym,MODE_TICKVALUE),10)," minLot=",DoubleToString(MarketInfo(sym,MODE_MINLOT),2)," lotStep=",DoubleToString(MarketInfo(sym,MODE_LOTSTEP),2)," stopLevel=",(int)MarketInfo(sym,MODE_STOPLEVEL)," auto=",AllowAutoOrders);return INIT_SUCCEEDED;}
void OnDeinit(const int reason){EventKillTimer();}
void OnTick(){}
