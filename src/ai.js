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
        risks: { type: 'array', items: { type: 'string' } }
      },
      required: ['bias', 'confidence', 'freshness', 'summary', 'drivers', 'risks']
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
  const found = [];
  const push = (source) => {
    const url = typeof source?.url === 'string' ? source.url : null;
    if (!url) return;
    const title = typeof source?.title === 'string' ? source.title : url;
    if (!found.some((x) => x.url === url)) found.push({ title, url });
  };
  for (const source of Array.isArray(response?.sources) ? response.sources : []) push(source);
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    const sources = item?.action?.sources || item?.sources;
    for (const source of Array.isArray(sources) ? sources : []) push(source);
  }
  return found.slice(0, 8);
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
    'Return the fundamental assessment as structured data with concise drivers and risks.'
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
          external_web_access: true
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
    return {
      decision,
      responseId: envelope?.id || null,
      model,
      sources: collectSources(envelope),
      webSearchUsed: true
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OpenAI request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
