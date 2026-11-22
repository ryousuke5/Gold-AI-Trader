#property strict
#property version   "1.10"
#property description "FXTF GOLD V19 MT5 research adapter. Read-only; no order execution."

// FXTF MT5 Product CFD profile.
// Defaults are based on the observed FXTF terminal specification dated 2026-11-22.
input string ApiBaseUrl = "https://gold-ai-trader-1.onrender.com";
input string ApiKey = "CHANGE_ME";
input string InpSymbol = "XAUUSD";
input string ExpectedFXTFServer = "FXTF-MT5";
input string ExpectedCompanyFragment = "Goldenway";
input string ExpectedDepositCurrency = "JPY";
input bool   RequireStrictFXTFProfile = true;

// Network is disabled by default. A hard guard in the Flow module blocks
// ALL Render requests whenever the logged-in account is a REAL account.
input bool   EnableSignalRequests = false;
input bool   RunAITestOnce = false;
input bool   EnableSafetyHeartbeat = false;

input int    TimerSeconds = 1;
input int    MagicNumber = 26092801;

// FXTF spread price ceiling is capped at the existing backend limit (0.50).
// The observed 0.19 spread was a single weekend last quote, not a live sample.
input double MaxSpreadPrice = 0.50;

// FXTF has a daily maintenance gap (observed sessions: server 01:05-23:55).
// A 30-minute tick gap triggers a 30-minute post-reopen safety lock.
input int    MarketReopenGapSeconds = 1800;
input int    MarketReopenLockMinutes = 30;
input double MaxTickJumpPrice = 3.00;
input double TickRecoveryBandPrice = 0.50;
input int    TickRecoverySamples = 3;
input int    MaxQuoteAgeSeconds = 30;

input int    RequestTimeoutMs = 8000;
input int    SafetyHeartbeatSeconds = 15;

// Order execution is intentionally absent. Do not add CTrade, OrderSend,
// PositionOpen, PositionClose, or any order-modification API in this phase.

datetime g_lastClosedM5Bar = 0;
datetime g_lastAttemptedM5Bar = 0;
datetime g_lastAttemptAt = 0;
int g_retrySeconds = 30;
bool g_apiConfigReady = false;
bool g_apiConfigWarningLogged = false;
bool g_liveNetworkBlockLogged = false;
string g_signalFlowStatus = "INITIALIZING";
string g_signalFlowReason = "not_started";

datetime g_lastObservedTickUtc = 0;
datetime g_lastSafetyHeartbeatAttemptUtc = 0;
double g_lastAcceptedMid = 0.0;
datetime g_reopenLockUntilUtc = 0;
bool g_firstSessionTickPending = true;
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
   string profileReason = "";

   Print("GoldAITrader V19 FXTF MT5: initializing. symbol=", sym,
         " signalRequests=", (EnableSignalRequests ? "true" : "false"),
         " safetyHeartbeat=", (EnableSafetyHeartbeat ? "true" : "false"),
         " orderExecution=not_implemented");

   if(!ValidateFXTFAccount(profileReason))
   {
      Print("[FXTF PROFILE] account validation failed: ", profileReason);
      return INIT_FAILED;
   }

   if(!SymbolSelect(sym, true))
   {
      Print("[FXTF PROFILE] SymbolSelect failed. error=", GetLastError(),
            " symbol=", sym);
      return INIT_FAILED;
   }

   if(RequireStrictFXTFProfile)
   {
      if(!ValidateFXTFGoldSpecification(sym, profileReason))
      {
         Print("[FXTF PROFILE] symbol specification validation failed: ", profileReason);
         return INIT_FAILED;
      }
   }

   long accountMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   Print("[FXTF PROFILE] verified server=", AccountInfoString(ACCOUNT_SERVER),
         " company=", AccountInfoString(ACCOUNT_COMPANY),
         " currency=", AccountInfoString(ACCOUNT_CURRENCY),
         " account_mode=", AccountModeText(accountMode),
         " symbol=", sym,
         " contract_size=", DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE), 4),
         " min_volume=", DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN), 4),
         " volume_step=", DoubleToString(SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP), 4),
         " tick_size=", DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), 8),
         " tick_value_account_currency=", DoubleToString(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE), 8));

   if(accountMode == ACCOUNT_TRADE_MODE_REAL)
      Print("[FXTF SAFETY] REAL account detected. All Render network requests are hard-blocked; local read-only monitoring only.");

   g_apiConfigReady = IsValidApiConfiguration();

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

   Print("GoldAITrader V19 FXTF MT5 initialized. READ_ONLY=true; network defaults OFF; real-account network guard ACTIVE; orderExecution=not_implemented.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   SaveMarketSafetyState();
   ReleaseIndicatorHandles();
}

void OnTick()
{
   // Timer-driven read-only adapter. No trading or per-tick action.
}
