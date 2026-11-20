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
   string configured = TrimText(SymbolName);
   if(StringLen(configured) > 0)
      return configured;
   return _Symbol;
}

bool IsGoldSymbol(string sym)
{
   if(!RequireGoldSymbol)
      return true;
   return (StringFind(sym, "XAU") >= 0 ||
           StringFind(sym, "xau") >= 0 ||
           StringFind(sym, "GOLD") >= 0 ||
           StringFind(sym, "gold") >= 0);
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
