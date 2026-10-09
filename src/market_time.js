/**
 * Validate a UTC timestamp for a completed market bar before strategy evaluation.
 *
 * barTimeSeconds must be Unix epoch seconds in UTC, not broker-local wall-clock time.
 */
export function validateUtcBarTimestamp(
  barTimeSeconds,
  {
    nowMs = Date.now(),
    futureToleranceSeconds = 30,
    maxAgeSeconds = 90
  } = {}
) {
  const barSeconds = Number(barTimeSeconds);
  const now = Number(nowMs);
  const futureTolerance = Number(futureToleranceSeconds);
  const maxAge = Number(maxAgeSeconds);

  if (!Number.isFinite(barSeconds) || barSeconds <= 0 || !Number.isFinite(barSeconds * 1000)) {
    return { ok: false, reason: 'invalid_bar_time', age_seconds: null, future_seconds: null };
  }
  if (!Number.isFinite(now) || now <= 0) {
    return { ok: false, reason: 'invalid_server_clock', age_seconds: null, future_seconds: null };
  }
  if (!Number.isFinite(futureTolerance) || futureTolerance < 0 ||
      !Number.isFinite(maxAge) || maxAge < 0) {
    return { ok: false, reason: 'invalid_time_validation_config', age_seconds: null, future_seconds: null };
  }

  const deltaSeconds = (barSeconds * 1000 - now) / 1000;
  const futureSeconds = Math.max(0, deltaSeconds);
  const ageSeconds = Math.max(0, -deltaSeconds);

  if (futureSeconds > futureTolerance) {
    return {
      ok: false,
      reason: 'bar_time_in_future',
      age_seconds: ageSeconds,
      future_seconds: futureSeconds
    };
  }
  if (ageSeconds > maxAge) {
    return {
      ok: false,
      reason: 'bar_time_too_old',
      age_seconds: ageSeconds,
      future_seconds: futureSeconds
    };
  }

  return { ok: true, reason: null, age_seconds: ageSeconds, future_seconds: futureSeconds };
}
