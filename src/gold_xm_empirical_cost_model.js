const VALID_QUANTILES = new Set(['p50', 'p90', 'p95', 'p99', 'max']);

function finiteNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`${label} must be finite`);
  return n;
}

export function getServerLocalHour(timestampSeconds, timeZone = 'Europe/Nicosia') {
  const timestamp = finiteNumber(timestampSeconds, 'timestampSeconds');
  if (!Number.isInteger(timestamp)) throw new TypeError('timestampSeconds must be an integer Unix timestamp');
  if (typeof timeZone !== 'string' || !timeZone.trim()) throw new TypeError('timeZone must be a non-empty IANA timezone');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp * 1000));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Could not resolve local hour for timezone ${timeZone}`);
  }
  return hour;
}

export function resolveEmpiricalSpread({
  profile,
  accountServer,
  timestampSeconds,
  quantile = 'p90',
  minObservations = 100
}) {
  if (!profile || typeof profile !== 'object' || !profile.profiles) {
    throw new TypeError('A valid empirical spread profile is required');
  }
  if (typeof accountServer !== 'string' || !accountServer.trim()) {
    throw new TypeError('accountServer must be a non-empty string');
  }
  const q = String(quantile).toLowerCase();
  if (!VALID_QUANTILES.has(q)) {
    throw new RangeError(`Unsupported spread quantile: ${q}`);
  }
  const account = profile.profiles[accountServer];
  if (!account) throw new Error(`No empirical spread profile for account server: ${accountServer}`);

  const hour = getServerLocalHour(timestampSeconds, profile.server_timezone || 'Europe/Nicosia');
  const hourly = account.hours?.[String(hour)];
  const enoughHourlyData = hourly && Number(hourly.observations) >= minObservations;
  const selected = enoughHourlyData ? hourly : account.global;
  if (!selected) throw new Error(`No hourly or global spread estimate for ${accountServer}`);

  const spreadPrice = finiteNumber(selected[q], `spread ${q}`);
  if (spreadPrice < 0) throw new RangeError('Empirical spread must be >= 0');
  const observations = Number(selected.observations ?? account.unique_observations ?? 0);
  return {
    spreadPrice,
    accountServer,
    serverHour: hour,
    quantile: q,
    observations,
    source: enoughHourlyData ? 'hourly' : 'global_fallback',
    profileId: profile.profile_id || 'unversioned'
  };
}

export function validateEmpiricalSpreadProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new TypeError('profile must be an object');
  if (profile.schema_version !== 1) throw new Error('Unsupported spread profile schema_version');
  if (typeof profile.server_timezone !== 'string' || !profile.server_timezone) {
    throw new Error('profile.server_timezone is required');
  }
  if (!profile.profiles || typeof profile.profiles !== 'object') {
    throw new Error('profile.profiles is required');
  }
  for (const [server, account] of Object.entries(profile.profiles)) {
    if (!server || !account?.global || !account?.hours) {
      throw new Error(`Invalid profile entry for account server: ${server}`);
    }
    for (const q of VALID_QUANTILES) {
      const value = Number(account.global[q]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid global ${q} spread for account server: ${server}`);
      }
    }
    for (const [hour, row] of Object.entries(account.hours)) {
      if (!/^([0-9]|1[0-9]|2[0-3])$/.test(hour)) throw new Error(`Invalid server hour: ${hour}`);
      if (!Number.isFinite(Number(row.observations)) || Number(row.observations) < 0) {
        throw new Error(`Invalid observation count for ${server} hour ${hour}`);
      }
      for (const q of VALID_QUANTILES) {
        const value = Number(row[q]);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Invalid ${q} spread for ${server} hour ${hour}`);
        }
      }
    }
  }
  return true;
}
