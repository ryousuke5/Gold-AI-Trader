#ifndef GOLD_V19_HTTP_MQH
#define GOLD_V19_HTTP_MQH

// Extracted verbatim from the user-provided V19 source snapshot.
// Source Git blob SHA: a65972bf15041d7ae34a001f6b079dcb8465b6ce (historical commit 676ef7edfe7fc342cb9c8681ad8c6bec6ecf9379).
// Preserve behavior until MQL4 compile and demo parity tests pass.

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
