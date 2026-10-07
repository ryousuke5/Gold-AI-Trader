function envBool(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function envNum(env, name, fallback, min = -Infinity) {
  const value = Number(env?.[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, value);
}

function parseUtcMinutes(value, fallback) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ''));
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function utcMinutesOfDay(ms) {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function isWithinClockWindow(minutes, start, end) {
  if (start === end) return true;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

function positiveFinite(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export function getEurUsdSafetyConfig(env = process.env) {
  return {
    maxHoldSeconds: envNum(env, 'EURUSD_MAX_HOLD_SECONDS', 3600, 60),
    weekendBlockStartUtc: parseUtcMinutes(env?.EURUSD_WEEKEND_BLOCK_START_UTC, 20 * 60),
    weekendBlockEndUtc: parseUtcMinutes(env?.EURUSD_WEEKEND_BLOCK_END_UTC, 23 * 60 + 59),
    sundayReopenUtc: parseUtcMinutes(env?.EURUSD_SUNDAY_REOPEN_UTC, 21 * 60),
    sundayReopenLockMinutes: envNum(env, 'EURUSD_SUNDAY_REOPEN_LOCK_MINUTES', 90, 0),
    rolloverStartUtc: parseUtcMinutes(env?.EURUSD_ROLLOVER_START_UTC, 21 * 60 + 55),
    rolloverEndUtc: parseUtcMinutes(env?.EURUSD_ROLLOVER_END_UTC, 22 * 60 + 15),
    weekendGapCheckHours: envNum(env, 'EURUSD_GAP_CHECK_AFTER_REOPEN_HOURS', 12, 1),
    maxWeekendGapAtr: envNum(env, 'EURUSD_WEEKEND_MAX_GAP_ATR', 0.50, 0.01),
    requireWeekendGapData: envBool(env, 'EURUSD_REQUIRE_GAP_DATA', true),
    newsFeedRequired: envBool(env, 'EURUSD_NEWS_REQUIRE_FEED', true),
    newsFeedMaxAgeSeconds: envNum(env, 'EURUSD_NEWS_FEED_MAX_AGE_SECONDS', 1800, 60),
    highImpactPreBlockMinutes: envNum(env, 'EURUSD_NEWS_HIGH_PRE_BLOCK_MINUTES', 60, 0),
    highImpactPostBlockMinutes: envNum(env, 'EURUSD_NEWS_HIGH_POST_BLOCK_MINUTES', 60, 0),
    mediumImpactEnabled: envBool(env, 'EURUSD_NEWS_BLOCK_MEDIUM', false),
    mediumImpactPreBlockMinutes: envNum(env, 'EURUSD_NEWS_MEDIUM_PRE_BLOCK_MINUTES', 30, 0),
    mediumImpactPostBlockMinutes: envNum(env, 'EURUSD_NEWS_MEDIUM_POST_BLOCK_MINUTES', 30, 0),
    allowedCurrencies: ['USD', 'EUR']
  };
}

function normalizeImpact(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === '3' || v === 'high' || v === 'red') return 'HIGH';
  if (v === '2' || v === 'medium' || v === 'med' || v === 'orange') return 'MEDIUM';
  if (v === '1' || v === 'low' || v === 'yellow') return 'LOW';
  return 'UNKNOWN';
}

function eventMatchesPair(event, config) {
  const currency = String(event?.currency || '').trim().toUpperCase();
  return config.allowedCurrencies.includes(currency);
}

function normalizedEvents(newsFeed) {
  if (!Array.isArray(newsFeed?.events)) return [];
  return newsFeed.events
    .map((event) => ({
      ...event,
      scheduledAtMs: Date.parse(String(event?.scheduled_at || event?.scheduledAt || ''))
    }))
    .filter((event) => Number.isFinite(event.scheduledAtMs))
    .filter((event) => event.scheduledAtMs > 0);
}

function findBlockingNews(nowMs, newsFeed, config) {
  const events = normalizedEvents(newsFeed)
    .filter((event) => eventMatchesPair(event, config))
    .map((event) => ({ ...event, impact: normalizeImpact(event.impact) }))
    .filter((event) => event.impact === 'HIGH' || (config.mediumImpactEnabled && event.impact === 'MEDIUM'))
    .map((event) => {
      const pre = event.impact === 'HIGH'
        ? config.highImpactPreBlockMinutes * 60 * 1000
        : config.mediumImpactPreBlockMinutes * 60 * 1000;
      const post = event.impact === 'HIGH'
        ? config.highImpactPostBlockMinutes * 60 * 1000
        : config.mediumImpactPostBlockMinutes * 60 * 1000;
      return { ...event, blockStartMs: event.scheduledAtMs - pre, blockEndMs: event.scheduledAtMs + post };
    })
    .filter((event) => nowMs >= event.blockStartMs && nowMs <= event.blockEndMs)
    .sort((a, b) => Math.abs(a.scheduledAtMs - nowMs) - Math.abs(b.scheduledAtMs - nowMs));

  return events[0] || null;
}

function nextNewsEvent(nowMs, newsFeed, config) {
  return normalizedEvents(newsFeed)
    .filter((event) => eventMatchesPair(event, config))
    .map((event) => ({ ...event, impact: normalizeImpact(event.impact) }))
    .filter((event) => event.impact === 'HIGH' || (config.mediumImpactEnabled && event.impact === 'MEDIUM'))
    .filter((event) => event.scheduledAtMs >= nowMs)
    .sort((a, b) => a.scheduledAtMs - b.scheduledAtMs)[0] || null;
}

export function evaluateEurUsdSafety({
  nowMs = Date.now(),
  safety = {},
  newsFeed = null,
  config = getEurUsdSafetyConfig()
} = {}) {
  const reasons = [];
  const actions = [];
  const date = new Date(nowMs);
  const day = date.getUTCDay();
  const minutes = utcMinutesOfDay(nowMs);

  if (day === 5 && minutes >= config.weekendBlockStartUtc) {
    reasons.push('weekend_friday_cutoff');
    actions.push('BLOCK_NEW_ORDERS');
  }

  if (day === 0) {
    const reopen = config.sundayReopenUtc;
    const lockEnd = reopen + config.sundayReopenLockMinutes;
    const sundayOpenWindow = lockEnd < 1440
      ? minutes >= reopen && minutes < lockEnd
      : minutes >= reopen || minutes < (lockEnd - 1440);
    if (sundayOpenWindow) {
      reasons.push('weekend_sunday_reopen_lock');
      actions.push('BLOCK_NEW_ORDERS');
    }
  }

  if (isWithinClockWindow(minutes, config.rolloverStartUtc, config.rolloverEndUtc)) {
    reasons.push('daily_rollover_window');
    actions.push('BLOCK_NEW_ORDERS');
  }

  const gapAtr = Number(safety.weekend_gap_atr);
  const gapKnown = safety.weekend_gap_known === true && positiveFinite(gapAtr);
  const gapCheckHours = config.weekendGapCheckHours;
  const mondayEarly = day === 1 && minutes < gapCheckHours * 60;
  if (mondayEarly) {
    if (!gapKnown && config.requireWeekendGapData) {
      reasons.push('weekend_gap_data_missing');
      actions.push('BLOCK_NEW_ORDERS');
    } else if (gapKnown && gapAtr > config.maxWeekendGapAtr) {
      reasons.push('weekend_gap_too_large');
      actions.push('BLOCK_NEW_ORDERS');
    }
  } else if (gapKnown && gapAtr > config.maxWeekendGapAtr) {
    reasons.push('weekend_gap_too_large');
    actions.push('BLOCK_NEW_ORDERS');
  }

  const feedFetchedAt = Number(newsFeed?.fetchedAtMs || 0);
  const feedAgeSeconds = feedFetchedAt > 0 ? Math.max(0, (nowMs - feedFetchedAt) / 1000) : Infinity;
  const feedFresh = feedFetchedAt > 0 && feedAgeSeconds <= config.newsFeedMaxAgeSeconds;
  if (config.newsFeedRequired && !feedFresh) {
    reasons.push('news_feed_missing_or_stale');
    actions.push('BLOCK_NEW_ORDERS');
  }

  const blockingEvent = feedFresh ? findBlockingNews(nowMs, newsFeed, config) : null;
  if (blockingEvent) {
    reasons.push(blockingEvent.impact === 'HIGH' ? 'high_impact_news_window' : 'medium_impact_news_window');
    actions.push('BLOCK_NEW_ORDERS');
  }

  const positionAgeSeconds = Number(safety.oldest_position_age_seconds);
  let forceClose = false;
  if (positiveFinite(positionAgeSeconds) && positionAgeSeconds > config.maxHoldSeconds) {
    reasons.push('maximum_hold_time_exceeded');
    actions.push('FORCE_CLOSE_OLDEST_POSITION');
    forceClose = true;
  }

  if (forceClose) actions.push('BLOCK_NEW_ORDERS');

  return {
    allowed: reasons.length === 0,
    newOrdersAllowed: reasons.length === 0,
    forceClose,
    reasons: [...new Set(reasons)],
    actions: [...new Set(actions)],
    feed: {
      required: config.newsFeedRequired,
      fresh: feedFresh,
      ageSeconds: Number.isFinite(feedAgeSeconds) ? feedAgeSeconds : null,
      eventCount: Array.isArray(newsFeed?.events) ? newsFeed.events.length : 0,
      lastError: newsFeed?.lastError || null,
      source: newsFeed?.source || null
    },
    weekendGap: {
      known: gapKnown,
      gapAtr: gapKnown ? gapAtr : null,
      maxGapAtr: config.maxWeekendGapAtr
    },
    blockingNews: blockingEvent ? {
      name: String(blockingEvent.name || blockingEvent.title || ''),
      currency: String(blockingEvent.currency || ''),
      impact: blockingEvent.impact,
      scheduledAt: new Date(blockingEvent.scheduledAtMs).toISOString()
    } : null,
    nextNewsEvent: feedFresh ? (
      (() => {
        const next = nextNewsEvent(nowMs, newsFeed, config);
        return next ? {
          name: String(next.name || next.title || ''),
          currency: String(next.currency || ''),
          impact: next.impact,
          scheduledAt: new Date(next.scheduledAtMs).toISOString()
        } : null;
      })()
    ) : null
  };
}
