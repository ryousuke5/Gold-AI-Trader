const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fundamental: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bias: { type: 'string', enum: ['BULLISH_EURUSD', 'BEARISH_EURUSD', 'NEUTRAL', 'INSUFFICIENT'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        freshness: { type: 'string', enum: ['CURRENT', 'MIXED', 'STALE', 'INSUFFICIENT'] },
        summary: { type: 'string' },
        drivers: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        source_urls: { type: 'array', items: { type: 'string' } }
      },
      required: ['bias', 'confidence', 'freshness', 'summary', 'drivers', 'risks', 'source_urls']
    },
    event_risk_next_24h: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] },
    event_summary: { type: 'string' }
  },
  required: ['fundamental', 'event_risk_next_24h', 'event_summary']
};

function outputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('');
}

function collectSources(response) {
  const all = [];
  const push = (source) => {
    const url = typeof source?.url === 'string' ? source.url : null;
    if (!url) return;
    const title = typeof source?.title === 'string' ? source.title : url;
    if (!all.some((x) => x.url === url)) all.push({ title, url });
  };
  for (const source of Array.isArray(response?.sources) ? response.sources : []) push(source);
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    const sources = item?.action?.sources || item?.sources;
    for (const source of Array.isArray(sources) ? sources : []) push(source);
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.type === 'url_citation') push(annotation?.url_citation);
      }
    }
  }
  return all.slice(0, 30);
}

function selectSources(decision, response) {
  const catalog = collectSources(response);
  const requested = Array.isArray(decision?.fundamental?.source_urls)
    ? decision.fundamental.source_urls.filter((x) => typeof x === 'string' && x.trim())
    : [];
  const exact = catalog.filter((source) => requested.includes(source.url)).slice(0, 8);
  const cited = [];
  const seen = new Set();
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.type !== 'url_citation') continue;
        const s = annotation?.url_citation;
        if (typeof s?.url !== 'string' || seen.has(s.url)) continue;
        seen.add(s.url);
        cited.push({ title: typeof s.title === 'string' ? s.title : s.url, url: s.url });
      }
    }
  }
  const selected = exact.length > 0 ? exact : cited.slice(0, 8);
  return { selected, catalog };
}

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isPrimaryOrReuters(url) {
  const host = hostname(url);
  return [
    'ecb.europa.eu',
    'ec.europa.eu',
    'federalreserve.gov',
    'bls.gov',
    'bea.gov',
    'home.treasury.gov',
    'fred.stlouisfed.org',
    'reuters.com',
    'www.reuters.com',
    'cmegroup.com'
  ].some((allowed) => host === allowed || host.endsWith('.' + allowed));
}

export function validateEurUsdFundamentalAssessment(result, now = new Date()) {
  const fundamental = result?.fundamental || {};
  const freshness = String(fundamental.freshness || 'INSUFFICIENT').toUpperCase();
  const bias = String(fundamental.bias || 'INSUFFICIENT').toUpperCase();
  const confidence = Number(fundamental.confidence);
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  const eventRisk = String(result?.event_risk_next_24h || 'UNKNOWN').toUpperCase();

  const reasons = [];
  if (!['CURRENT', 'MIXED'].includes(freshness)) reasons.push('fundamental_not_current');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) reasons.push('invalid_fundamental_confidence');
  if (!['BULLISH_EURUSD', 'BEARISH_EURUSD', 'NEUTRAL', 'INSUFFICIENT'].includes(bias)) reasons.push('invalid_fundamental_bias');
  if (sources.length < 2) reasons.push('insufficient_fundamental_sources');
  if (!sources.some((s) => isPrimaryOrReuters(s.url))) reasons.push('no_primary_or_reuters_source');
  if (eventRisk === 'UNKNOWN') reasons.push('event_risk_unknown');
  if (eventRisk === 'HIGH') reasons.push('high_impact_event_next_24h');

  return {
    ok: reasons.length === 0,
    reasons,
    source_count: sources.length,
    primary_or_reuters_source_count: sources.filter((s) => isPrimaryOrReuters(s.url)).length,
    freshness,
    checked_at: now.toISOString()
  };
}

export function buildEurUsdFundamentalDecision({ candidate, assessment, minFundamentalConfidence = 0.65 }) {
  const c = String(candidate || 'WAIT').toUpperCase();
  const f = assessment?.fundamental || {};
  const bias = String(f.bias || 'INSUFFICIENT').toUpperCase();
  const confidence = Number(f.confidence);
  const validation = validateEurUsdFundamentalAssessment(assessment);

  if (c === 'WAIT') return { confirmed: false, decision: 'WAIT', reason: 'technical_setup_wait', invalid_reasons: ['technical_setup_wait'] };
  if (!validation.ok) {
    return { confirmed: false, decision: 'WAIT', reason: 'fundamental_filter_failed', invalid_reasons: validation.reasons };
  }
  if (confidence < minFundamentalConfidence) {
    return { confirmed: false, decision: 'WAIT', reason: 'fundamental_confidence_below_threshold', invalid_reasons: ['fundamental_confidence_below_threshold'] };
  }

  const sameDirection =
    (c === 'BUY' && bias === 'BULLISH_EURUSD') ||
    (c === 'SELL' && bias === 'BEARISH_EURUSD');
  const oppositeDirection =
    (c === 'BUY' && bias === 'BEARISH_EURUSD') ||
    (c === 'SELL' && bias === 'BULLISH_EURUSD');

  if (oppositeDirection && confidence >= minFundamentalConfidence) {
    return { confirmed: false, decision: 'WAIT', reason: 'fundamental_conflict', invalid_reasons: ['fundamental_conflict'] };
  }
  if (sameDirection) return { confirmed: true, decision: c, reason: 'technical_setup_and_fundamental_direction_aligned', invalid_reasons: [] };

  return {
    confirmed: false,
    decision: 'WAIT',
    reason: 'fundamental_not_directionally_confirming',
    invalid_reasons: ['fundamental_not_directionally_confirming']
  };
}

export async function analyzeEurUsdFundamental({ features, candidate, model = process.env.OPENAI_MODEL || 'gpt-5.5' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const timeoutMs = Math.max(8000, Number(process.env.OPENAI_TIMEOUT_MS || 60000));
  const lookbackHours = Math.max(6, Number(process.env.EURUSD_FUNDAMENTAL_LOOKBACK_HOURS || process.env.FUNDAMENTAL_LOOKBACK_HOURS || 48));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const now = new Date();

  const system = [
    'You are the fundamental confirmation layer of an EURUSD M15/H1 trading system.',
    'Do not generate technical entry, stop loss, take profit, position size, or a trade setup. Those are determined outside the AI.',
    'Your only job is to assess current fundamental direction for EURUSD and identify near-term event risk.',
    'Use the supplied technical candidate only as context; never override or manufacture technical data.',
    'You MUST perform a live web search before returning a current or mixed assessment.',
    'Use information from the last ' + String(lookbackHours) + ' hours when available, and check scheduled high-impact events for the next 24 hours and next 7 days.',
    'Focus on ECB policy and communication, Federal Reserve policy, Euro-area inflation/growth/labor data, U.S. inflation/growth/labor data, U.S. yields and dollar conditions, and major geopolitical risk that can materially move EURUSD.',
    'Prefer primary sources such as ecb.europa.eu, europa.eu, federalreserve.gov, bls.gov, bea.gov, home.treasury.gov, fred.stlouisfed.org and reputable reporting such as Reuters.',
    'Use exact publication dates and event dates in your reasoning.',
    'Do not treat an old article or a static evergreen page as current market-moving evidence.',
    'Use at least two independent sources when possible, including at least one primary source or Reuters.',
    'event_risk_next_24h=HIGH means a scheduled or imminent event is likely to make a fresh M15 entry unusually exposed to spread/volatility risk.',
    'The fundamental bias must be one of: BULLISH_EURUSD, BEARISH_EURUSD, NEUTRAL, INSUFFICIENT.',
    'BULLISH_EURUSD means the balance of current evidence supports EURUSD higher; BEARISH_EURUSD means lower; NEUTRAL means meaningful factors are balanced; INSUFFICIENT means evidence is too weak, stale or contradictory.',
    'Do not use the word BUY or SELL to mean fundamental direction in the structured field; use the required enum only.',
    'Every URL in fundamental.source_urls must be an exact URL returned by web search and actually used for the conclusion.',
    'Do not invent sources, dates, prices, yields, policy decisions or economic releases.',
    'Return concise drivers and risks. If a major scheduled event is within 24 hours, list it in event_summary and set event_risk_next_24h accordingly.'
  ].join('\\n');

  const userInput = {
    market: 'EURUSD',
    candidate,
    analysis_time_utc: now.toISOString(),
    lookback_hours: lookbackHours,
    technical_context: {
      h1_trend: features.h1,
      m15: features.m15,
      spread: features.spread,
      bid: features.bid,
      ask: features.ask
    }
  };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || 'medium' },
        tools: [{
          type: 'web_search',
          search_context_size: process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE || 'medium',
          external_web_access: true,
          filters: {
            allowed_domains: String(process.env.EURUSD_OPENAI_ALLOWED_DOMAINS || 'ecb.europa.eu,ec.europa.eu,federalreserve.gov,bls.gov,bea.gov,home.treasury.gov,fred.stlouisfed.org,reuters.com,cmegroup.com')
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean)
          }
        }],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(userInput) }] }
        ],
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'eurusd_fundamental_assessment',
            strict: true,
            schema: decisionSchema
          }
        }
      })
    });

    const body = await response.text();
    if (!response.ok) throw new Error('OpenAI ' + response.status + ': ' + body.slice(0, 1000));
    const envelope = JSON.parse(body);
    const raw = outputText(envelope);
    if (!raw) throw new Error('OpenAI structured output was empty');

    const assessment = JSON.parse(raw);
    const sourceSelection = selectSources(assessment, envelope);
    if (candidate !== 'WAIT' && sourceSelection.selected.length < 2) {
      throw new Error('eurusd_fundamental_sources_unverified');
    }
    const validation = validateEurUsdFundamentalAssessment({
      ...assessment,
      sources: sourceSelection.selected
    }, now);

    return {
      assessment,
      sources: sourceSelection.selected,
      searchedSources: sourceSelection.catalog,
      responseId: envelope?.id || null,
      model,
      webSearchUsed: true,
      validation
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OpenAI request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
