#ifndef GOLD_V19_TIME_MQH
#define GOLD_V19_TIME_MQH

// Extracted verbatim from mt4/GoldAITraderV19.mq4 at baseline 5461cb91ff339acc99af54caa63764aca835aa7f.
// Keep this module behavior-identical until parity and compiler checks pass.

bool GetServerUtcOffsetSeconds(int &offsetSeconds)
{
   datetime serverNow = TimeCurrent();
   datetime utcNow = TimeGMT();
   if(serverNow <= 0 || utcNow <= 0)
      return false;

   int rawOffset = (int)(serverNow - utcNow);
   int roundedOffset = (int)(MathRound((double)rawOffset / 900.0) * 900.0);

   // Accept quarter-hour offsets only; fail closed if the machine clock or broker offset looks wrong.
   if(MathAbs(rawOffset - roundedOffset) > 120 || MathAbs(roundedOffset) > 14 * 3600)
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

#endif // GOLD_V19_TIME_MQH
