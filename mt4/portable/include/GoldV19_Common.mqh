#ifndef GOLD_V19_COMMON_MQH
#define GOLD_V19_COMMON_MQH

// Extracted verbatim from mt4/GoldAITraderV19.mq4 at baseline 5461cb91ff339acc99af54caa63764aca835aa7f.
// Keep this module behavior-identical until parity and compiler checks pass.

string TrimText(string value)
{
   value = StringTrimLeft(value);
   value = StringTrimRight(value);
   return value;
}

string TradeSymbol()
{
   string configured = TrimText(SymbolName);
   if(StringLen(configured) > 0)
      return configured;

   return Symbol();
}

bool IsGoldSymbol(string sym)
{
   if(!RequireGoldSymbol)
      return true;

   if(StringFind(sym, "XAU") >= 0)
      return true;
   if(StringFind(sym, "xau") >= 0)
      return true;
   if(StringFind(sym, "GOLD") >= 0)
      return true;
   if(StringFind(sym, "gold") >= 0)
      return true;

   return false;
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
   return DoubleToString(value, digits);
}

bool IsValidApiConfiguration()
{
   bool urlOk = (StringFind(TrimText(ApiBaseUrl), "https://") == 0);
   bool keyOk = (StringLen(TrimText(ApiKey)) >= 16 && TrimText(ApiKey) != "CHANGE_ME");

   Print("GoldAITrader: API config check. url_ok=",
         (urlOk ? "true" : "false"),
         " key_ok=",
         (keyOk ? "true" : "false"));

   if(!urlOk)
   {
      Print("GoldAITrader: ApiBaseUrl must start with https://");
      return false;
   }

   if(!keyOk)
   {
      Print("GoldAITrader: ApiKey is not configured or is too short.");
      return false;
   }

   return true;
}

#endif // GOLD_V19_COMMON_MQH
