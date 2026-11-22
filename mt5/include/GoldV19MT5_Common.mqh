#ifndef GOLD_V19_MT5_COMMON_MQH
#define GOLD_V19_MT5_COMMON_MQH

string TrimText(string value)
{
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
}

string TradeSymbol()
{
   string configured = TrimText(InpSymbol);
   if(StringLen(configured) > 0)
      return configured;
   return _Symbol;
}

bool IsGoldSymbol(string sym)
{
   return (StringFind(sym, "XAU") >= 0 ||
           StringFind(sym, "xau") >= 0 ||
           StringFind(sym, "GOLD") >= 0 ||
           StringFind(sym, "gold") >= 0);
}

string AccountModeText(long mode)
{
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "REAL";
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "DEMO";
   if(mode == ACCOUNT_TRADE_MODE_CONTEST) return "CONTEST";
   return "UNKNOWN";
}

bool ValidateFXTFAccount(string &reason)
{
   string server = AccountInfoString(ACCOUNT_SERVER);
   string company = AccountInfoString(ACCOUNT_COMPANY);
   string currency = AccountInfoString(ACCOUNT_CURRENCY);

   if(server != ExpectedFXTFServer)
   {
      reason = "unexpected_server:" + server;
      return false;
   }

   if(StringFind(company, ExpectedCompanyFragment) < 0)
   {
      reason = "unexpected_company:" + company;
      return false;
   }

   if(currency != ExpectedDepositCurrency)
   {
      reason = "unexpected_deposit_currency:" + currency;
      return false;
   }

   if(!IsGoldSymbol(TradeSymbol()))
   {
      reason = "configured_symbol_is_not_gold:" + TradeSymbol();
      return false;
   }

   reason = "ok";
   return true;
}

bool ValidateFXTFGoldSpecification(string sym, string &reason)
{
   if(sym != "XAUUSD")
   {
      reason = "expected_exact_symbol_XAUUSD:" + sym;
      return false;
   }

   string baseCurrency = SymbolInfoString(sym, SYMBOL_CURRENCY_BASE);
   string profitCurrency = SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT);
   if(baseCurrency != "XAU" || profitCurrency != "USD")
   {
      reason = "unexpected_base_or_profit_currency:" + baseCurrency + "/" + profitCurrency;
      return false;
   }

   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double tickSize = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double contractSize = SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
   double tickValue = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   double minVolume = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double volumeStep = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);

   // These values were observed in the user's FXTF MT5 terminal on 2026-11-22.
   // The tick value itself is deliberately NOT hardcoded; it is dynamic JPY.
   if(MathAbs(point - 0.01) > 0.0000001)
   {
      reason = "unexpected_point:" + DoubleToString(point, 10);
      return false;
   }
   if(MathAbs(tickSize - 0.01) > 0.0000001)
   {
      reason = "unexpected_tick_size:" + DoubleToString(tickSize, 10);
      return false;
   }
   if(MathAbs(contractSize - 1.0) > 0.000001)
   {
      reason = "unexpected_contract_size:" + DoubleToString(contractSize, 8);
      return false;
   }
   if(MathAbs(minVolume - 1.0) > 0.000001)
   {
      reason = "unexpected_min_volume:" + DoubleToString(minVolume, 8);
      return false;
   }
   if(MathAbs(volumeStep - 1.0) > 0.000001)
   {
      reason = "unexpected_volume_step:" + DoubleToString(volumeStep, 8);
      return false;
   }
   if(!MathIsValidNumber(tickValue) || tickValue <= 0.0)
   {
      reason = "tick_value_invalid";
      return false;
   }

   reason = "ok";
   return true;
}

bool NetworkAllowedForCurrentAccount()
{
   // This build intentionally permits network requests only from an FXTF DEMO
   // account. REAL and CONTEST accounts remain local-only.
   return (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO);
}

string ScopedGlobalKey(string scope, string suffix)
{
   string server = AccountInfoString(ACCOUNT_SERVER);
   string sym = TradeSymbol();

   StringReplace(server, ":", "_");
   StringReplace(server, " ", "_");
   StringReplace(sym, "#", "_");
   StringReplace(sym, ".", "_");
   StringReplace(sym, "/", "_");

   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   return "GV19:" + server + ":" + IntegerToString((int)login) + ":" +
          StringSubstr(sym, 0, 8) + ":" + scope + ":" + suffix;
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

string JsonNumber(double value, int digits)
{
   if(!MathIsValidNumber(value))
      return "null";
   return DoubleToString(value, digits);
}

bool IsValidApiConfiguration()
{
   bool urlOk = (StringFind(TrimText(ApiBaseUrl), "https://") == 0);
   bool keyOk = (StringLen(TrimText(ApiKey)) >= 16 &&
                 TrimText(ApiKey) != "CHANGE_ME");

   Print("GoldAITrader MT5: API config check. url_ok=",
         (urlOk ? "true" : "false"),
         " key_ok=", (keyOk ? "true" : "false"));
   return (urlOk && keyOk);
}

#endif // GOLD_V19_MT5_COMMON_MQH
