#property strict
#property version   "1.00"
#property description "GOLD V19 MT5 research adapter. Read-only telemetry; no order execution."

input string ApiBaseUrl = "https://gold-ai-trader-1.onrender.com";
input string ApiKey = "CHANGE_ME";
input string InpSymbol = "";
input bool   RequireGoldSymbol = true;
input bool   EnableSignalRequests = false;
input bool   RunAITestOnce = false;
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
input bool   EnableSafetyHeartbeat = false;
input int    SafetyHeartbeatSeconds = 15;

// Order execution is intentionally absent. The heartbeat always reports
// allow_auto_orders=false; this adapter contains no order/trade API calls.

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

int g_m5Ema20Handle = INVALID_HANDLE;
int g_m5Ema50Handle = INVALID_HANDLE;
int g_m5Rsi14Handle = INVALID_HANDLE;
int g_m5Atr14Handle = INVALID_HANDLE;
int g_h1Ema20Handle = INVALID_HANDLE;
int g_h1Ema50Handle = INVALID_HANDLE;
int g_h1Ema200Handle = INVALID_HANDLE;
int g_h1Rsi14Handle = INVALID_HANDLE;
int g_h1Atr14Handle = INVALID_HANDLE;

#include "include/GoldV19MT5_Common.mqh"
#include "include/GoldV19MT5_Time.mqh"
#include "include/GoldV19MT5_MarketData.mqh"
#include "include/GoldV19MT5_MarketSafety.mqh"
#include "include/GoldV19MT5_Payload.mqh"
#include "include/GoldV19MT5_Http.mqh"
#include "include/GoldV19MT5_Flow.mqh"

int OnInit()
{
   string sym = TradeSymbol();

   Print("GoldAITrader V19 MT5 research adapter: initializing. symbol=", sym,
         " signalRequests=", (EnableSignalRequests ? "true" : "false"),
         " safetyHeartbeat=", (EnableSafetyHeartbeat ? "true" : "false"),
         " orderExecution=not_implemented");

   g_apiConfigReady = IsValidApiConfiguration();
   if(!IsGoldSymbol(sym))
   {
      Print("GoldAITrader MT5: chart symbol is not recognized as gold: ", sym);
      return INIT_FAILED;
   }

   if(!SymbolSelect(sym, true))
   {
      Print("GoldAITrader MT5: SymbolSelect failed. error=", GetLastError(),
            " symbol=", sym);
      return INIT_FAILED;
   }

   if(TimerSeconds < 1 || RequestTimeoutMs < 1000)
   {
      Print("GoldAITrader MT5: invalid timer or HTTP timeout input.");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(!CreateIndicatorHandles(sym))
      return INIT_FAILED;

   LoadMarketSafetyState();

   if(!EventSetTimer(TimerSeconds))
   {
      Print("GoldAITrader MT5: EventSetTimer failed. error=", GetLastError());
      ReleaseIndicatorHandles();
      return INIT_FAILED;
   }

   Print("GoldAITrader MT5 research adapter initialized. orderExecution=not_implemented; defaults are network-disabled.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ReleaseIndicatorHandles();
}

void OnTick()
{
   // Timer-driven adapter, intentionally no trading or per-tick action.
}
