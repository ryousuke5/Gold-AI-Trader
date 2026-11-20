#ifndef GOLD_V19_MT5_HTTP_MQH
#define GOLD_V19_MT5_HTTP_MQH

bool PostJson(string path, string payload, string &response)
{
   string url = ApiBaseUrl + path;
   string headers = "Content-Type: application/json\r\n";
   headers += "X-Gold-API-Key: " + TrimText(ApiKey) + "\r\n";
   headers += "X-Request-Id: " + IntegerToString((int)GetTickCount()) + "\r\n";

   char postData[];
   char result[];
   string resultHeaders = "";
   int copied = StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(copied <= 1)
      return false;

   // StringToCharArray includes the terminating NUL; HTTP body must not.
   if(ArrayResize(postData, copied - 1) != copied - 1)
      return false;

   ResetLastError();
   int httpCode = WebRequest("POST", url, headers, RequestTimeoutMs,
                             postData, result, resultHeaders);
   int errorCode = GetLastError();
   response = CharArrayToString(result, 0, -1, CP_UTF8);

   if(httpCode == 409 && StringFind(response, "\"error\":\"duplicate_bar\"") >= 0)
   {
      Print("GoldAITrader MT5: duplicate_bar accepted as already processed. path=", path);
      return true;
   }

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("GoldAITrader MT5: WebRequest failed. HTTP=", httpCode,
            " error=", errorCode, " path=", path, " response=", response);
      return false;
   }
   return true;
}

#endif // GOLD_V19_MT5_HTTP_MQH
