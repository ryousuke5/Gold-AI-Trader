const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    market_regime: { type: 'string', enum: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'HIGH_VOLATILITY', 'UNCLEAR'] },
    entry: { type: 'number' },
    stop_loss: { type: 'number' },
    take_profit: { type: 'number' },
    risk_reward: { type: 'number', minimum: 0 },
    reason: { type: 'string' },
    invalid_reasons: { type: 'array', items: { type: 'string' } },
    fundamental: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bias: { type: 'string', enum: ['BULLISH_GOLD', 'BEARISH_GOLD', 'NEUTRAL', 'INSUFFICIENT'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        freshness: { type: 'string', enum: ['CURRENT', 'MIXED', 'STALE', 'INSUFFICIENT'] },
        summary: { type: 'string' },
        drivers: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        source_urls: { type: 'array', items: { type: 'string' } }
      },
      required: ['bias', 'confidence', 'freshness', 'summary', 'drivers', 'risks', 'source_urls']
    }
  },
  required: ['decision', 'confidence', 'market_regime', 'entry', 'stop_loss', 'take_profit', 'risk_reward', 'reason', 'invalid_reasons', 'fundamental']
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
  return all.slice(0, 20);
}

function selectFundamentalSources(decision, response) {
  const catalog = collectSources(response);
  const requested = Array.isArray(decision?.fundamental?.source_urls)
    ? decision.fundamental.source_urls.filter((x) => typeof x === 'string' && x.trim())
    : [];
  const exact = catalog.filter((source) => requested.includes(source.url)).slice(0, 8);
  const cited = [];
  const citedSet = new Set();
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        if (annotation?.type !== 'url_citation') continue;
        const source = annotation?.url_citation;
        if (typeof source?.url !== 'string' || citedSet.has(source.url)) continue;
        citedSet.add(source.url);
        cited.push({ title: typeof source.title === 'string' ? source.title : source.url, url: source.url });
      }
    }
  }
  const selected = exact.length ? exact : cited.slice(0, 8);
  return {
    selected,
    catalog,
    selectionMethod: exact.length ? 'MODEL_URLS_MATCHED_TO_SEARCH_RESULTS' : (cited.length ? 'ANNOTATIONS' : 'NONE')
  };
}

function sourceDateFromUrl(url) {
  const s = String(url || '');
  const match = s.match(/(?:^|[^0-9])(20\\d{2})[-_\/]?([01]\\d)[-_\/]?([0-3]\\d)(?:[^0-9]|$)/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function enforceFundamentalSafety(decision, freshnessCheck) {
  const next = JSON.parse(JSON.stringify(decision || {}));
  if (freshnessCheck?.ok !== false) return next;
  const f = next.fundamental || {};
  if (String(next.decision || 'WAIT').toUpperCase() !== 'WAIT') {
    next.decision = 'WAIT';
    next.entry = 0;
    next.stop_loss = 0;
    next.take_profit = 0;
    next.risk_reward = 0;
    next.invalid_reasons = Array.isArray(next.invalid_reasons) ? next.invalid_reasons.map(String) : [];
    if (!next.invalid_reasons.includes(freshnessCheck.reason)) next.invalid_reasons.push(freshnessCheck.reason);
  }
  next.fundamental = {
    bias: String(f.bias || 'INSUFFICIENT').toUpperCase(),
    confidence: Number.isFinite(Number(f.confidence)) ? Number(f.confidence) : 0,
    freshness: 'INSUFFICIENT',
    summary: String(f.summary || '') + ' Current-source verification was insufficient, so the trading decision was forced to WAIT.',
    drivers: Array.isArray(f.drivers) ? f.drivers.map(String) : [],
    risks: Array.isArray(f.risks) ? f.risks.map(String) : [],
    source_urls: Array.isArray(f.source_urls) ? f.source_urls.filter((x) => typeof x === 'string') : []
  };
  return next;
}

export function validateFundamentalSourceFreshness(sources, freshness, now = new Date(), lookbackHours = 48) {
  const level = String(freshness || 'INSUFFICIENT').toUpperCase();
  if (level !== 'CURRENT' && level !== 'MIXED') return { ok: true, reason: null, recent_count: 0 };
  const cutoff = new Date(now.getTime() - Math.max(1, Number(lookbackHours)) * 3600 * 1000);
  const recent = (Array.isArray(sources) ? sources : []).filter((source) => {
    const d = sourceDateFromUrl(source?.url);
    return d && d >= cutoff && d <= now;
  });
  if (recent.length > 0) return { ok: true, reason: null, recent_count: recent.length };
  return { ok: false, reason: 'fundamental_current_source_not_date_verifiable', recent_count: 0 };
}

export async function analyzeWithOpenAI({ features, candidate, symbol, model = process.env.OPENAI_MODEL || 'gpt-5.5' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const timeoutMs = Math.max(5000, Number(process.env.OPENAI_TIMEOUT_MS || 60000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const now = new Date();
  const lookbackHours = Math.max(6, Number(process.env.FUNDAMENTAL_LOOKBACK_HOURS || 48));

  const system = [
    'You are the decision layer of an XAUUSD trading system.',
    'You are not a broker and not a risk manager.',
    'Use only the supplied technical/account data plus facts retrieved from the live web search.',
    'Never invent news, price, macro data, or missing information.',
    'A BUY/SELL decision is a trading hypothesis, not a probability of profit.',
    'The deterministic risk engine will independently validate every price and risk constraint.',
    'Prefer WAIT when evidence conflicts, is stale, or is insufficient.',
    'A rule-based candidate has already been generated: ' + candidate + '.',
    'Do not create a BUY/SELL trade against a WAIT candidate.',
    'For BUY: stop_loss must be below entry and take_profit above entry.',
    'For SELL: stop_loss must be above entry and take_profit below entry.',
    'For WAIT: entry, stop_loss, take_profit and risk_reward must all be 0.',
    '',
    'FUNDAMENTAL ANALYSIS IS REQUIRED FOR EVERY BUY/SELL CANDIDATE.',
    'Before deciding, perform a live web search focused on the latest material affecting gold.',
    'Prefer information published within the last ' + String(lookbackHours) + ' hours when available, while also checking scheduled high-impact events over the next 7 days.',
    'Cover these areas when material:',
    '1) Federal Reserve policy, FOMC communication, and rate-cut/hike expectations.',
    '2) U.S. Treasury yields and real-yield direction when reliable data is available.',
    '3) U.S. dollar strength (DXY or equivalent reliable reporting).',
    '4) U.S. inflation, labor-market, and growth data that can change rate expectations.',
    '5) Central-bank gold demand, ETF flows, and major gold-market positioning when fresh and reliable.',
    '6) Major geopolitical or risk-off events that can materially affect safe-haven demand.',
    'Use exact publication/event dates. Prefer primary sources and reputable financial reporting.',
    'For CURRENT or MIXED assessments, do not use information older than the ' + String(lookbackHours) + '-hour lookback as current evidence, except clearly labeled structural background such as World Gold Council data.',
    'If an older source is retrieved, treat it as background only or ignore it; never cite an old source as evidence for a current market-moving claim.',
    'Prioritize these domains when relevant: federalreserve.gov, bls.gov, treasury.gov, fred.stlouisfed.org, reuters.com, gold.org, cmegroup.com.',
    'Do not let search-result breadth override source quality or recency.',
    'Do not treat a single headline as sufficient evidence.',
    '',
    'Fundamental bias must be based on the balance of current evidence:',
    'BULLISH_GOLD = fundamentals broadly support higher gold prices.',
    'BEARISH_GOLD = fundamentals broadly support lower gold prices.',
    'NEUTRAL = meaningful factors are balanced or unclear.',
    'INSUFFICIENT = current evidence is too weak, stale, contradictory, or unavailable.',
    'If fundamental bias strongly conflicts with the rule candidate and fundamental confidence is >= 0.70, prefer WAIT.',
    'If fundamental evidence is INSUFFICIENT or STALE, prefer WAIT for a BUY/SELL decision.',
    'Neutral fundamentals do not force WAIT by themselves when technical evidence is strong.',
    'Do not manufacture entry, stop, or take-profit values. For WAIT, all price fields must be 0.',
    'Return the fundamental assessment as structured data with concise drivers and risks.',
    'In fundamental.source_urls, list the exact URLs of the sources you actually used for the fundamental conclusion. Only use URLs returned by the web search.'
  ].join('\n');

  const userInput = {
    symbol,
    candidate,
    analysis_time_utc: now.toISOString(),
    fundamental_lookback_hours: lookbackHours,
    features
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
          search_context_size: process.env.OPENAI_WEB_SEARCH_CONTEXT_SIZE || 'low',
          external_web_access: true,
          filters: {
            allowed_domains: String(process.env.OPENAI_ALLOWED_DOMAINS || 'federalreserve.gov,bls.gov,bea.gov,home.treasury.gov,fred.stlouisfed.org,cmegroup.com,reuters.com,gold.org').split(',').map((x) => x.trim()).filter(Boolean)
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
            name: 'gold_trade_decision',
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

    const decision = JSON.parse(raw);
    const sourceSelection = selectFundamentalSources(decision, envelope);
    if (candidate !== 'WAIT' && sourceSelection.selected.length === 0) {
      throw new Error('fundamental_sources_unverified');
    }
    const freshnessCheck = validateFundamentalSourceFreshness(
      sourceSelection.selected,
      decision?.fundamental?.freshness,
      now,
      lookbackHours
    );
    const safeDecisionResult = candidate !== 'WAIT' ? enforceFundamentalSafety(decision, freshnessCheck) : decision;
    return {
      decision: safeDecisionResult,
      responseId: envelope?.id || null,
      model,
      sources: sourceSelection.selected,
      searchedSources: sourceSelection.catalog,
      sourceSelectionMethod: sourceSelection.selectionMethod,
      sourceFreshnessCheck: freshnessCheck,
      webSearchUsed: true
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OpenAI request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
