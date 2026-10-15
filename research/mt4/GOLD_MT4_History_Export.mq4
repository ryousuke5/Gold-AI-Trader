#property strict
#property show_inputs
#property version   "1.00"
#property description "Research-only exporter for broker-native MT4 M5 bars. Never sends, modifies, or closes orders."

input string          ExportSymbol = ""; // Blank means the current chart symbol (attach to XM GOLD)
input ENUM_TIMEFRAMES ExportTimeframe = PERIOD_M5;
input datetime        StartServerTime = D'2021.10.06 00:00';
input datetime        EndServerTime   = D'2026.10.05 00:00'; // exclusive end
input string          OutputFile      = "GOLD_M5_XM_Broker_History.csv";

int OnStart()
{
   string symbol = ExportSymbol;
   if(StringLen(symbol) == 0)
      symbol = Symbol();

   if(EndServerTime <= StartServerTime)
   {
      Print("XM HISTORY EXPORT ERROR: EndServerTime must be later than StartServerTime.");
      return(0);
   }

   ResetLastError();
   MqlRates rates[];
   ArraySetAsSeries(rates, false); // oldest bar first for readable CSV output
   int copied = CopyRates(symbol, ExportTimeframe, StartServerTime, EndServerTime, rates);
   int copyError = GetLastError();

   if(copied <= 0)
   {
      Print("XM HISTORY EXPORT FAILED: symbol=", symbol,
            " timeframe=", EnumToString(ExportTimeframe),
            " copied=", copied, " error=", copyError,
            ". Ensure the broker history is downloaded, then run again.");
      return(0);
   }

   int digits = (int)MarketInfo(symbol, MODE_DIGITS);
   int fileHandle = FileOpen(OutputFile, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   if(fileHandle == INVALID_HANDLE)
   {
      Print("XM HISTORY EXPORT FAILED: FileOpen error=", GetLastError(),
            " file=", OutputFile, ". Check MQL4\\Files permissions/name.");
      return(0);
   }

   FileWrite(fileHandle, "server_time", "open", "high", "low", "close",
             "tick_volume", "spread_points", "real_volume");

   int written = 0;
   datetime firstWritten = 0;
   datetime lastWritten = 0;
   for(int i = 0; i < copied; i++)
   {
      datetime barTime = rates[i].time;
      if(barTime < StartServerTime || barTime >= EndServerTime)
         continue;

      FileWrite(fileHandle,
                TimeToString(barTime, TIME_DATE | TIME_MINUTES),
                DoubleToString(rates[i].open, digits),
                DoubleToString(rates[i].high, digits),
                DoubleToString(rates[i].low, digits),
                DoubleToString(rates[i].close, digits),
                (long)rates[i].tick_volume,
                (int)rates[i].spread,
                (long)rates[i].real_volume);
      if(written == 0)
         firstWritten = barTime;
      lastWritten = barTime;
      written++;
   }

   FileFlush(fileHandle);
   FileClose(fileHandle);

   int serverUtcOffsetSeconds = (int)(TimeCurrent() - TimeGMT());
   Print("XM HISTORY EXPORT COMPLETE (NO TRADING): symbol=", symbol,
         " timeframe=", EnumToString(ExportTimeframe),
         " copied=", copied, " written=", written,
         " file=MQL4\\Files\\", OutputFile,
         " first_server_time=", (written > 0 ? TimeToString(firstWritten, TIME_DATE | TIME_MINUTES) : "none"),
         " last_server_time=", (written > 0 ? TimeToString(lastWritten, TIME_DATE | TIME_MINUTES) : "none"),
         " requested_start_server_time=", TimeToString(StartServerTime, TIME_DATE | TIME_MINUTES),
         " requested_end_server_time_exclusive=", TimeToString(EndServerTime, TIME_DATE | TIME_MINUTES),
         " current_server_minus_GMT_seconds=", serverUtcOffsetSeconds,
         " current_spread_points=", DoubleToString(MarketInfo(symbol, MODE_SPREAD), 0),
         " digits=", digits,
         " tick_size=", DoubleToString(MarketInfo(symbol, MODE_TICKSIZE), digits),
         " tick_value=", DoubleToString(MarketInfo(symbol, MODE_TICKVALUE), 4));

   if(written < copied)
   {
      Print("XM HISTORY EXPORT NOTE: some copied bars were outside the requested half-open interval; copied=", copied,
            " written_in_interval=", written);
   }
   Print("IMPORTANT: timestamps in CSV are MT4 broker/server wall time, not UTC. Convert historic timestamps using the account's historical Europe/Nicosia server offset (UTC+3/UTC+2) before merging with external datasets.");
   Print("IMPORTANT: spread_points is whatever the broker history reports for each bar; missing/zero historical spread must not be interpreted as a measured zero spread.");
   return(0);
}
