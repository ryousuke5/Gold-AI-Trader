const MIN_GAP_SECONDS = 15 * 60;

function utcDayInfo(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return {
    utc_day: d.getUTCDay(),
    utc_hour: d.getUTCHours(),
    utc_date: d.toISOString().slice(0, 10),
  };
}

export function hourMinuteUtc(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return String(d.getUTCHours()).padStart(2, '0') + ':' +
    String(d.getUTCMinutes()).padStart(2, '0');
}

export function nicosiaOffsetHours(unixSeconds) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Nicosia',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(unixSeconds * 1000));
  const label = parts.find((part) => part.type === 'timeZoneName')?.value || '';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!match) {
    throw new Error(
      'Could not resolve Europe/Nicosia timezone offset for ' +
      new Date(unixSeconds * 1000).toISOString() + ': ' + label
    );
  }
  const value = Number(match[2]) + (Number(match[3] || 0) / 60);
  return match[1] === '-' ? -value : value;
}

export function expectedXmGoldGapPair(unixSeconds) {
  // Expected rounded M5 label pair for a pause around the 23:59 server rollover.
  const offset = nicosiaOffsetHours(unixSeconds);
  const startHour = ((24 - offset) % 24 + 24) % 24;
  const endHour = (startHour + 1) % 24;
  const pad = (value) => String(value).padStart(2, '0');
  return pad(startHour) + ':00>' + pad(endHour) + ':00';
}

export function isNearXmGoldDailyRollover(unixSeconds, toleranceMinutes = 10) {
  // Published GOLD hour guides differ by a few minutes in their prose/table.
  // Match the repeated maintenance gap to XM's 23:59 server rollover without
  // assuming that every feed timestamps candles at exactly the same minute.
  const offset = nicosiaOffsetHours(unixSeconds);
  const date = new Date(unixSeconds * 1000);
  const currentMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const rolloverUtcMinutes = ((23 * 60 + 59 - offset * 60) % 1440 + 1440) % 1440;
  const raw = Math.abs(currentMinutes - rolloverUtcMinutes);
  const circularDistance = Math.min(raw, 1440 - raw);
  return circularDistance <= toleranceMinutes;
}

function sundayOfMonth(year, month, ordinal) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  if (ordinal === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    return last.getUTCDate() - last.getUTCDay();
  }
  const firstSunday = 1 + ((7 - firstWeekday) % 7);
  return firstSunday + (ordinal - 1) * 7;
}

export function isDstTransitionReviewWindow(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  const year = date.getUTCFullYear();
  const transitionDates = [
    Date.UTC(year, 2, sundayOfMonth(year, 2, 2)), // US DST starts, second Sunday in March
    Date.UTC(year, 2, sundayOfMonth(year, 2, -1)), // European DST starts, last Sunday in March
    Date.UTC(year, 9, sundayOfMonth(year, 9, -1)), // European DST ends, last Sunday in October
    Date.UTC(year, 10, sundayOfMonth(year, 10, 1)), // US DST ends, first Sunday in November
  ];
  return transitionDates.some((time) =>
    Math.abs(unixSeconds * 1000 - time) <= 7 * 86400 * 1000
  );
}

/**
 * Classify an M5 timestamp gap using XMTrading's published regular GOLD session.
 * Times are UTC bar-open labels in Unix seconds. The function never claims that
 * an undocumented closure is official; such gaps remain unverified/censored.
 */
export function classifyXmGoldGap(previousBarTime, nextBarTime, pairFrequency = 0) {
  const deltaSeconds = nextBarTime - previousBarTime;
  const gapStart = previousBarTime + 300;
  const pair = hourMinuteUtc(gapStart) + '>' + hourMinuteUtc(nextBarTime);
  const previous = utcDayInfo(previousBarTime);
  const next = utcDayInfo(nextBarTime);
  const gapMinutes = deltaSeconds / 60;
  const expectedPair = expectedXmGoldGapPair(gapStart);
  const sameUtcWeekday =
    previous.utc_day === next.utc_day &&
    previous.utc_day >= 1 &&
    previous.utc_day <= 4;
  const normalWeekend =
    previous.utc_day === 5 &&
    next.utc_day === 0 &&
    gapMinutes >= 46 * 60 &&
    gapMinutes <= 54 * 60;

  let classification;
  if (deltaSeconds <= MIN_GAP_SECONDS) {
    classification = 'small_bar_gap';
  } else if (normalWeekend) {
    classification = 'scheduled_weekend_closure';
  } else if (deltaSeconds >= 18 * 3600) {
    classification = 'holiday_extended_or_feed_gap_unverified';
  } else if (
    gapMinutes >= 45 &&
    gapMinutes <= 90 &&
    sameUtcWeekday &&
    isNearXmGoldDailyRollover(gapStart)
  ) {
    classification = 'scheduled_daily_maintenance';
  } else if (
    isDstTransitionReviewWindow(previousBarTime) &&
    gapMinutes >= 15 &&
    gapMinutes <= 180
  ) {
    classification = 'dst_transition_window_review';
  } else if (deltaSeconds >= 30 * 60 && pairFrequency >= 20) {
    classification = 'recurring_window_gap_not_confirmed_by_xm_hours';
  } else if (deltaSeconds > MIN_GAP_SECONDS) {
    classification = 'irregular_feed_gap_or_session_change';
  } else {
    classification = 'small_bar_gap';
  }

  return {
    classification,
    start_pair: pair,
    expected_xm_gold_gap_pair: expectedPair,
    previous_weekday: previous.utc_day,
    next_weekday: next.utc_day,
    previous_date_utc: previous.utc_date,
    next_date_utc: next.utc_date,
    gap_start: gapStart,
    gap_seconds: deltaSeconds - 300,
    delta_seconds: deltaSeconds,
    minutes_missing: Math.max(0, deltaSeconds / 60 - 5),
    pair_frequency: pairFrequency,
    server_offset_hours: nicosiaOffsetHours(gapStart),
  };
}

export const UNVERIFIED_XM_GAP_CLASSES = new Set([
  'holiday_extended_or_feed_gap_unverified',
  'dst_transition_window_review',
  'recurring_window_gap_not_confirmed_by_xm_hours',
  'irregular_feed_gap_or_session_change',
]);
