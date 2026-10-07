const DEFAULT_URL = 'https://www.financecalendar.com/wp-json/fc/v1/calendar';

const state = {
  source: 'financecalendar.com',
  sourceUrl: DEFAULT_URL,
  events: [],
  fetchedAtMs: 0,
  lastAttemptAtMs: 0,
  lastError: null
};

let refreshing = false;
let timer = null;

function todayUtc(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(dateText + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeEvent(raw) {
  const scheduled = raw?.scheduledAt || raw?.scheduled_at || raw?.time_utc || raw?.timeUtc || raw?.release_time || raw?.releaseTime;
  const timeMs = Date.parse(String(scheduled || ''));
  if (!Number.isFinite(timeMs)) return null;

  const currencyRaw = raw?.currency ?? raw?.Currency ?? raw?.ccy;
  const country = String(raw?.country || raw?.Country || '').toLowerCase();
  let currency = String(currencyRaw || '').trim().toUpperCase();
  if (!currency) {
    if (country.includes('united states') || country === 'us') currency = 'USD';
    if (country.includes('euro') || country.includes('germany') || country.includes('france')) currency = 'EUR';
  }

  const impact = String(raw?.impact ?? raw?.importance ?? '').toUpperCase();
  const name = String(raw?.eventName || raw?.name || raw?.title || raw?.event || '').trim();
  if (!currency || !name) return null;

  return {
    id: String(raw?.id || raw?.event_id || raw?.series || (name + ':' + timeMs)),
    name,
    currency,
    impact,
    scheduled_at: new Date(timeMs).toISOString(),
    url: String(raw?.url || 'https://www.financecalendar.com/')
  };
}

export async function refreshEurUsdNewsFeed(nowMs = Date.now()) {
  if (refreshing) return { ok: false, skipped: true, state: getEurUsdNewsFeedState() };
  refreshing = true;
  state.lastAttemptAtMs = nowMs;

  try {
    const from = todayUtc(nowMs);
    const to = addDays(from, 7);
    const url = new URL(DEFAULT_URL);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('impact', 'high');
    url.searchParams.set('limit', '500');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': 'Gold-AI-Trader-EURUSD-Safety/1.0', accept: 'application/json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw new Error('news_feed_http_' + response.status);
    const payload = await response.json();
    const payloadHasEventsArray = Array.isArray(payload) || Array.isArray(payload?.events);
    if (!payloadHasEventsArray) throw new Error('news_feed_invalid_shape');

    const rows = Array.isArray(payload) ? payload : payload.events;
    const events = rows
      .map(normalizeEvent)
      .filter(Boolean)
      .filter((event) => ['USD', 'EUR'].includes(event.currency));

    // An empty high-impact calendar is valid. It means no matching events were returned.
    state.events = events.sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    state.fetchedAtMs = nowMs;
    state.lastError = null;
    return { ok: true, state: getEurUsdNewsFeedState() };
  } catch (error) {
    state.lastError = String(error?.message || error);
    return { ok: false, state: getEurUsdNewsFeedState() };
  } finally {
    refreshing = false;
  }
}

export function getEurUsdNewsFeedState() {
  return {
    source: state.source,
    sourceUrl: state.sourceUrl,
    events: [...state.events],
    fetchedAtMs: state.fetchedAtMs,
    lastAttemptAtMs: state.lastAttemptAtMs,
    lastError: state.lastError
  };
}

export function startEurUsdNewsFeedMonitor({ refreshSeconds = Number(process.env.EURUSD_NEWS_REFRESH_SECONDS || 600) } = {}) {
  if (timer) return timer;
  const intervalMs = Math.max(60, Number(refreshSeconds)) * 1000;
  void refreshEurUsdNewsFeed();
  timer = setInterval(() => { void refreshEurUsdNewsFeed(); }, intervalMs);
  return timer;
}
