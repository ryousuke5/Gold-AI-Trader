const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    environment: {
      type: 'string',
      enum: ['FAVORABLE', 'CAUTION', 'UNFAVORABLE', 'INSUFFICIENT']
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1
    },
    fundamental: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bias: {
          type: 'string',
          enum: ['BULLISH_EURUSD', 'BEARISH_EURUSD', 'NEUTRAL', 'INSUFFICIENT']
        },
        summary: { type: 'string' },
        drivers: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        source_urls: { type: 'array', items: { type: 'string' } }
      },
      required: ['bias', 'summary', 'drivers', 'risks', 'source_urls']
    },
    freshness: {
      type: 'string',
      enum: ['CURRENT', 'MIXED', 'STALE', 'INSUFFICIENT']
    },
    event_risk_next_24h: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']
    },
    event_summary: { type: 'string' }
  },
  required: ['environment', 'confidence', 'fundamental', 'freshness', 'event_risk_next_24h', 'event_summary']
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
        const source = annotation?.url_citation;
        if (typeof source?.url !== 'string' || seen.has(source.url)) continue;
        seen.add(source.url);
        cited.push({
          title: typeof source.title === 'string' ? source.title : source.url,
          url: source.url
        });
      }
    }
  }

  const selected = [
    ...exact,
    ...cited.filter((source) => !exact.some((item) => item.url === source.url))
  ].slice(0, 8);

  return { selected, catalog };
}

function hostname(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .split(':')[0]
    .replace(/^www\./, '');
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
    'cmegroup.com'
  ].some((allowed) => host === allowed || host.endsWith('.' + allowed) || host.endsWith(allowed));
}

/**
 * The AI's only trading responsibility is environment classification.
 * It must never create/modify the technical entry, SL, TP or position size.
 */
export function validateEurUsdFundamentalAssessment(result, now = new Date()) {
  const fundamental = result?.fundamental || {};
  const environment = String(result?.environment || 'INSUFFICIENT').toUpperCase();
  const freshness = String(result?.freshness || 'INSUFFICIENT').toUpperCase();
  const confidence = Number(result?.confidence);
  const bias = String(fundamental.bias || 'INSUFFICIENT').toUpperCase();
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  const eventRisk = String(result?.event_risk_next_24h || 'UNKNOWN').toUpperCase();

  const reasons = [];

  if (!['FAVORABLE', 'CAUTION', 'UNFAVORABLE', 'INSUFFICIENT'].includes(environment)) {
    reasons.push('invalid_environment');
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    reasons.push('invalid_ai_environment_confidence');
  }
  if (!['CURRENT', 'MIXED'].includes(freshness)) {
    reasons.push('fundamental_not_current');
  }
  if (!['BULLISH_EURUSD', 'BEARISH_EURUSD', 'NEUTRAL', 'INSUFFICIENT'].includes(bias)) {
    reasons.push('invalid_fundamental_bias');
  }
  if (sources.length < 2) {
    reasons.push('insufficient_fundamental_sources');
  }
  const uniqueSourceHosts = new Set(sources.map((source) => hostname(source.url)).filter(Boolean));
  if (uniqueSourceHosts.size < 2) {
    reasons.push('insufficient_independent_source_hosts');
  }
  if (!sources.some((source) => isPrimaryOrReuters(source.url))) {
    reasons.push('no_primary_or_reuters_source');
  }
  if (eventRisk === 'UNKNOWN') {
    reasons.push('event_risk_unknown');
  }
  if (eventRisk === 'HIGH') {
    reasons.push('high_impact_event_next_24h');
  }
  if (environment === 'INSUFFICIENT') {
    reasons.push('ai_environment_insufficient');
  }

  return {
    ok: reasons.length === 0,
    reasons,
    environment,
    source_count: sources.length,
    independent_source_host_count: new Set(sources.map((source) => hostname(source.url)).filter(Boolean)).size,
    primary_or_reuters_source_count: sources.filter((source) => isPrimaryOrReuters(source.url)).length,
    freshness,
    checked_at: now.toISOString()
  };
}

/**
 * Technical setup is created by code. AI only decides whether the current
 * macro/news environment is suitable for taking that already-qualified setup.
 */
export function buildEurUsdFundamentalDecision({
  candidate,
  assessment,
  minFundamentalConfidence = 0.65
}) {
  const c = String(candidate || 'WAIT').toUpperCase();
  const validation = validateEurUsdFundamentalAssessment(assessment);
  const environment = String(assessment?.environment || 'INSUFFICIENT').toUpperCase();
  const confidence = Number(assessment?.confidence);

  if (c === 'WAIT') {
    return {
      confirmed: false,
      decision: 'WAIT',
      environment,
      reason: 'technical_setup_wait',
      invalid_reasons: ['technical_setup_wait']
    };
  }

  if (!validation.ok) {
    return {
      confirmed: false,
      decision: 'WAIT',
      environment,
      reason: 'ai_environment_filter_failed',
      invalid_reasons: validation.reasons
    };
  }

  if (confidence < minFundamentalConfidence) {
    return {
      confirmed: false,
      decision: 'WAIT',
      environment,
      reason: 'ai_environment_confidence_below_threshold',
      invalid_reasons: ['ai_environment_confidence_below_threshold']
    };
  }

  if (environment !== 'FAVORABLE') {
    return {
      confirmed: false,
      decision: 'WAIT',
      environment,
      reason: 'ai_environment_not_favorable',
      invalid_reasons: ['ai_environment_not_favorable']
    };
  }

  return {
    confirmed: true,
    decision: c,
    environment,
    reason: 'technical_breakout_and_ai_environment_aligned',
    invalid_reasons: []
  };
}

export async function analyzeEurUsdFundamental({
  features,
  candidate,
  model = process.env.OPENAI_MODEL || 'gpt-5.5'
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const timeoutMs = Math.max(8000, Number(process.env.OPENAI_TIMEOUT_MS || 60000));
  const lookbackHours = Math.max(
    6,
    Number(process.env.EURUSD_FUNDAMENTAL_LOOKBACK_HOURS || process.env.FUNDAMENTAL_LOOKBACK_HOURS || 48)
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const now = new Date();

  const system = [
    'You are the environment filter for an EURUSD M15 high-quality range-breakout trading system.',
    'The deterministic technical engine already decided the technical candidate. Do not generate, change or veto the technical entry, stop loss, take profit or position size directly.',
    'Your job is to classify whether the CURRENT macro/news environment is suitable for taking a high-quality M15 range breakout.',
    'Return environment=FAVORABLE only when current evidence supports entering a fresh breakout; use CAUTION when conditions are mixed or timing is less attractive; use UNFAVORABLE when macro/event risk materially argues against taking a fresh breakout; use INSUFFICIENT when evidence cannot be verified.',
    'Use live web search before returning a current or mixed assessment.',
    'Prioritize information from the last ' + String(lookbackHours) + ' hours when available and check scheduled high-impact events for the next 24 hours and next 7 days.',
    'Review ECB and Federal Reserve policy/communication, relevant Euro-area and U.S. inflation/growth/labor data, U.S. yields and dollar conditions, and major geopolitical risk that can materially affect EURUSD.',
    'A scheduled or imminent high-impact event that can cause abnormal spread/volatility should normally make environment UNFAVORABLE.',
    'Use exact publication dates and event dates. Do not treat static or stale pages as current evidence.',
    'Use at least two independent sources and at least one primary source or Reuters when possible.',
    'fundamental.bias is informational context only. It is NOT the entry direction and must never be used to invent a technical setup.',
    'Every URL in fundamental.source_urls must be an exact URL returned by the web search and actually used for the assessment.',
    'Do not invent sources, dates, prices, yields, policy decisions or economic releases.',
    'Keep the environment decision conservative: uncertainty should produce CAUTION or INSUFFICIENT, not FAVORABLE.',
    'Return concise drivers, risks, and event_summary.'
  ].join('\n');

  const userInput = {
    market: 'EURUSD',
    technical_candidate: candidate,
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
          search_context_size: process.env.EURUSD_OPENAI_WEB_SEARCH_CONTEXT_SIZE || process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE || 'medium',
          external_web_access: true,
          filters: {
            allowed_domains: String(
              process.env.EURUSD_OPENAI_ALLOWED_DOMAINS ||
              'ecb.europa.eu,ec.europa.eu,federalreserve.gov,bls.gov,bea.gov,home.treasury.gov,fred.stlouisfed.org,reuters.com,cmegroup.com'
            )
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
            name: 'eurusd_environment_assessment',
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
      throw new Error('eurusd_environment_sources_unverified');
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
