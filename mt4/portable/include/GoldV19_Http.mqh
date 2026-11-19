#ifndef GOLD_V19_HTTP_MQH
#define GOLD_V19_HTTP_MQH

// Extracted verbatim from mt4/GoldAITraderV19.mq4 at baseline 5461cb91ff339acc99af54caa63764aca835aa7f.
// Keep this module behavior-identical until parity and compiler checks pass.

bool PostJson(string path, string payload, string &response)
{
   string url = ApiBaseUrl + path;

   string headers = "Content-Type: application/json\r\n";
   headers += "X-Gold-API-Key: " + TrimText(ApiKey) + "\r\n";
   headers += "X-Request-Id: " + IntegerToString((int)GetTickCount()) + "\r\n";

   if(StringFind(path, "/api/gold/market-safety") < 0)
      Print("GoldAITrader V1.6: request header length=", StringLen(headers),
            " api_key_length=", StringLen(TrimText(ApiKey)));

   uchar postData[];
   uchar result[];
   string resultHeaders = "";

   int payloadLength = StringLen(payload);
   ArrayResize(postData, payloadLength);

   if(payloadLength > 0)
      StringToCharArray(payload, postData, 0, payloadLength, CP_UTF8);

   ResetLastError();

   int httpCode = WebRequest(
      "POST",
      url,
      headers,
      RequestTimeoutMs,
      postData,
      result,
      resultHeaders
   );

   int errorCode = GetLastError();

   response = CharArrayToString(result, 0, -1, CP_UTF8);

   if(httpCode == 409 && StringFind(response, "\"error\":\"duplicate_bar\"") >= 0)
   {
      Print("GoldAITrader: duplicate_bar accepted as already processed. path=", path);
      return true;
   }

   if(httpCode < 200 || httpCode >= 300)
   {
      Print("GoldAITrader: WebRequest failed. HTTP=",
            httpCode,
            " error=",
            errorCode,
            " path=",
            path,
            " response=",
            response);
      return false;
   }

   return true;
}

#endif // GOLD_V19_HTTP_MQH
