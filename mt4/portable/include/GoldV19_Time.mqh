#ifndef GOLD_V19_TIME_MQH
#define GOLD_V19_TIME_MQH

// Extracted verbatim from the user-provided V19 source snapshot.
// Source Git blob SHA: a65972bf15041d7ae34a001f6b079dcb8465b6ce (historical commit 676ef7edfe7fc342cb9c8681ad8c6bec6ecf9379).
// Preserve behavior until MQL4 compile and demo parity tests pass.

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
