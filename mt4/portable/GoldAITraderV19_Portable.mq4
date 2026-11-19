#property strict
#property version   "1.9"
#property description "GOLD V19 portable research shadow build - derived from supplied XM MT4 source; no order execution."

input string ApiBaseUrl = "https://gold-ai-trader-1.onrender.com";
input string ApiKey = "CHANGE_ME";
input string SymbolName = "";
input bool   RequireGoldSymbol = true;
input bool   EnableSignalRequests = true;
input bool   RunAITestOnce = false;
input bool   AllowAutoOrders = false;
input int    TimerSeconds = 1;
input int    MagicNumber = 26092801;
input double MaxSpreadPrice = 0.50;
input int    RequestTimeoutMs = 8000;
input int    MarketReopenGapSeconds = 7200;
input int    MarketReopenLockMinutes = 30;
input double MaxTickJumpPrice = 3.00;
input double TickRecoveryBandPrice = 0.50;
input int    TickRecoverySamples = 3;
input int    MaxQuoteAgeSeconds = 30;
input bool   EnableSafetyHeartbeat = true;
input int    SafetyHeartbeatSeconds = 15;

datetime g_lastClosedM5Bar = 0;
datetime g_lastAttemptedM5Bar = 0;
datetime g_lastAttemptAt = 0;
int g_retrySeconds = 30;
bool g_apiConfigReady = false;
bool g_apiConfigWarningLogged = false;
string g_signalFlowStatus = "INITIALIZING";
string g_signalFlowReason = "not_started";

datetime g_lastObservedTickUtc = 0;
datetime g_lastSafetyHeartbeatAttemptUtc = 0;
double g_lastAcceptedMid = 0.0;
datetime g_reopenLockUntilUtc = 0;
bool g_tickAnomalyActive = false;
double g_recoveryMid = 0.0;
int g_recoveryStableCount = 0;
double g_marketSafetyBid = 0.0;
double g_marketSafetyAsk = 0.0;
double g_marketSafetyMid = 0.0;
double g_marketSafetySpread = 0.0;
datetime g_marketSafetyQuoteTimeUtc = 0;
bool g_marketSafetyAllowed = false;
string g_marketSafetyReason = "not_initialized";
string g_lastMarketSafetyLog = "";

//---------------------------------------------------------
// String helpers
//---------------------------------------------------------

// Shadow modular build: derived from the supplied source snapshot; do not install over the active EA.
#include "include/GoldV19_Common.mqh"
#include "include/GoldV19_MarketData.mqh"
#include "include/GoldV19_Time.mqh"
#include "include/GoldV19_MarketSafety.mqh"
#include "include/GoldV19_Payload.mqh"
#include "include/GoldV19_Http.mqh"
#include "include/GoldV19_Flow.mqh"

// EA lifecycle (kept in the entry file)
int OnInit()
{
   string sym = TradeSymbol();

   Print("GoldAITrader V1.6 BUILD=20260930B: starting initialization. symbol=", sym,
         " api=", ApiBaseUrl,
         " timer=", TimerSeconds,
         " timeoutMs=", RequestTimeoutMs,
         " signalRequests=", (EnableSignalRequests ? "true" : "false"),
         " autoOrders=", (AllowAutoOrders ? "requested-but-disabled" : "off"));

   g_apiConfigReady = IsValidApiConfiguration();

   if(!g_apiConfigReady)
   {
      Print("GoldAITrader: API configuration is incomplete. EA will stay attached, but signal requests are paused.");
   }

   if(!IsGoldSymbol(sym))
   {
      Print("GoldAITrader: chart symbol is not recognized as gold: ", sym);
      return INIT_FAILED;
   }

   ResetLastError();

   if(!SymbolSelect(sym, true))
   {
      Print("GoldAITrader: SymbolSelect failed during initialization. error=", GetLastError(),
            " symbol=", sym);
      return INIT_FAILED;
   }

   LoadMarketSafetyState();
   Print("[GOLD MARKET SAFETY] state_loaded last_tick_utc=",
         TimeToString(g_lastObservedTickUtc, TIME_DATE|TIME_SECONDS),
         " last_mid=", DoubleToString(g_lastAcceptedMid, 2),
         " reopen_lock_until_utc=", TimeToString(g_reopenLockUntilUtc, TIME_DATE|TIME_SECONDS));

   if(TimerSeconds < 1)
   {
      Print("GoldAITrader: TimerSeconds must be >= 1. current=", TimerSeconds);
      return INIT_FAILED;
   }

   if(RequestTimeoutMs < 1000)
   {
      Print("GoldAITrader: RequestTimeoutMs must be >= 1000. current=", RequestTimeoutMs);
      return INIT_FAILED;
   }

   ResetLastError();

   if(!EventSetTimer(TimerSeconds))
   {
      Print("GoldAITrader: EventSetTimer failed. error=", GetLastError(),
            " timer=", TimerSeconds);
      return INIT_FAILED;
   }

   int digits = (int)MarketInfo(sym, MODE_DIGITS);
   double point = MarketInfo(sym, MODE_POINT);
   double tickSize = MarketInfo(sym, MODE_TICKSIZE);
   double tickValue = MarketInfo(sym, MODE_TICKVALUE);
   double minLot = MarketInfo(sym, MODE_MINLOT);
   double lotStep = MarketInfo(sym, MODE_LOTSTEP);

   Print(
      "GoldAITrader initialized.",
      " symbol=", sym,
      " digits=", digits,
      " point=", DoubleToString(point, 10),
      " tickSize=", DoubleToString(tickSize, 10),
      " tickValue=", DoubleToString(tickValue, 8),
      " minLot=", DoubleToString(minLot, 8),
      " lotStep=", DoubleToString(lotStep, 8),
      " autoOrders=", (AllowAutoOrders ? "requested-but-disabled" : "off")
   );

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTick()
{
}
