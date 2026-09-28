const decisionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
    confidence: { type: 'number' },
    market_regime: { type: 'string', enum: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'HIGH_VOLATILITY', 'UNCLEAR'] },
    entry: { type: 'number' },
    stop_loss: { type: 'number' },
    take_profit: { type: 'number' },
    risk_reward: { type: 'number' },
    reason: { type: 'string' },
    invalid_reasons: { type: 'array', items: { type: 'string' } }
  },
  required: ['decision', 'confidence', 'market_regime', 'entry', 'stop_loss', 'take_profit', 'risk_reward', 'reason', 'invalid_reasons']
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

export async function analyzeWithOpenAI({ features, candidate, symbol, model = process.env.OPENAI_MODEL || 'gpt-5.5' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS || 12000));
  const system = [
    'You are the decision layer of an XAUUSD trading system.',
    'You are not a broker and not a risk manager.',
    'Use only the supplied market data. Never invent news, price, or missing information.',
    'A BUY/SELL decision is a trading hypothesis, not a probability of profit.',
    'The deterministic risk engine will independently validate every price and risk constraint.',
    'Prefer WAIT when evidence conflicts, is stale, or is insufficient.',
    `A rule-based candidate has already been generated: ${candidate}.`,
    'Do not create a BUY/SELL trade against a WAIT candidate.',
    'For BUY: stop_loss must be below entry and take_profit above entry.',
    'For SELL: stop_loss must be above entry and take_profit below entry.',
    'For WAIT: entry, stop_loss, take_profit and risk_reward must all be 0.'
  ].join('\n');

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: process.env.OPENAI_REASONING_EFFORT || 'medium' },
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ symbol, candidate, features }) }] }
        ],
        text: {
          verbosity: 'low',
          format: { type: 'json_schema', name: 'gold_trade_decision', strict: true, schema: decisionSchema }
        }
      })
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${body.slice(0, 1000)}`);
    const envelope = JSON.parse(body);
    const raw = outputText(envelope);
    if (!raw) throw new Error('OpenAI structured output was empty');
    return { decision: JSON.parse(raw), responseId: envelope?.id || null, model };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('OpenAI request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}