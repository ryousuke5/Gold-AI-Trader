// Fixed-window split helpers for research backtests.
// Bars are timestamped at candle OPEN. A candle is included in IS only when
// its full close (open + barSeconds) is at or before the IS cutoff.
export function isolateIsWindow(bars, { oosDays = 730, barSeconds = 300, minBars = 200000 } = {}) {
  if (!Array.isArray(bars) || bars.length === 0) throw new Error('IS split requires a non-empty bar array');
  const days = Number(oosDays);
  const seconds = Number(barSeconds);
  const minimum = Number(minBars);
  if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(seconds) || seconds <= 0 ||
      !Number.isInteger(minimum) || minimum < 1) {
    throw new Error('Invalid IS split configuration');
  }
  let previousTime = -Infinity;
  for (const bar of bars) {
    const time = Number(bar?.time);
    if (!Number.isFinite(time) || time <= previousTime) {
      throw new Error('IS split requires strictly increasing valid bar timestamps');
    }
    previousTime = time;
  }
  const fullDataEndTime = Number(bars.at(-1).time) + seconds;
  const isEndTime = fullDataEndTime - days * 86400;
  const isBars = bars.filter((bar) => Number(bar.time) + seconds <= isEndTime);
  if (isBars.length < minimum) {
    throw new Error(`Insufficient IS bars after excluding OOS: ${isBars.length} < ${minimum}`);
  }
  return {
    bars: isBars,
    sourceRows: bars.length,
    isRows: isBars.length,
    oosRowsExcluded: bars.length - isBars.length,
    fullDataEndTime,
    isEndTime
  };
}
