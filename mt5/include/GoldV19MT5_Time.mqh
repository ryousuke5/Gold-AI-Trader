#ifndef GOLD_V19_MT5_TIME_MQH
#define GOLD_V19_MT5_TIME_MQH

bool GetServerUtcOffsetSeconds(int &offsetSeconds)
{
   datetime serverNow = TimeTradeServer();
   datetime utcNow = TimeGMT();
   if(serverNow <= 0 || utcNow <= 0)
      return false;

   int rawOffset = (int)(serverNow - utcNow);
   int roundedOffset = (int)(MathRound((double)rawOffset / 900.0) * 900.0);

   if(MathAbs(rawOffset - roundedOffset) > 120 ||
      MathAbs(roundedOffset) > 14 * 3600)
      return false;

   offsetSeconds = roundedOffset;
   return true;
}

string ServerTimeUtcEpochJson(datetime serverTime)
{
   int offsetSeconds = 0;
   if(serverTime <= 0 || !GetServerUtcOffsetSeconds(offsetSeconds))
      return "null";
   return IntegerToString((int)(serverTime - offsetSeconds));
}

#endif // GOLD_V19_MT5_TIME_MQH
