import crypto from 'node:crypto';
import {
  normalizeEurUsdFeatures,
  validateEurUsdFeatures,
  buildEurUsdSetup
} from './eurusd_features.js';
import { buildEurUsdTrendPullbackSetup } from './eurusd_pullback.js';
import {
  analyzeEurUsdFundamental,
  buildEurUsdFundamentalDecision
} from './eurusd_ai.js';
import { evaluateEurUsdRisk, getEurUsdRiskLimits } from './eurusd_risk.js';
import { getEurUsdNewsFeedState } from './eurusd_news_feed.js';
import {
  getRiskBySignal,
  getSignalByKey,
  getState,
  insertEvent,
  insertOrder,
  insertRisk,
  insertSignal
} from './db.js';

function timingSafeEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function auth(req, res, next) {
  const expected = process.env.GOLD_API_KEY;
  if (!expected) return res.status(503).json({ ok: false, error: 'GOLD_API_KEY is not configured' });
  const supplied = String(req.headers['x-gold-api-key'] || '');
  if (!timingSafeEquals(supplied, expected)) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

function nowIso() {
  return new Date().toISOString();
}

function emptyFundamental(reason = 'Fundamental search not run because the technical setup was WAIT.') {
  return {
    bias: 'INSUFFICIENT',
    confidence: 0,
    freshness: 'INSUFFICIENT',
    summary: reason,
    drivers: [],
    risks: [],
    source_urls: [],
    event_risk_next_24h: 'UNKNOWN',
    event_summary: ''
  };
}

function buildDecision(setup, fundamentalAssessment, fundamentalResult) {
  const candidate = String(setup?.candidate || 'WAIT').toUpperCase();
  const confirmation = buildEurUsdFundamentalDecision({
    candidate,
    assessment: fundamentalAssessment,
    minFundamentalConfidence: getEurUsdRiskLimits().minAiEnvironmentConfidence
  });
  const f = fundamentalAssessment?.fundamental || emptyFundamental();
  const decision = confirmation.decision;
  return {
    decision,
    candidate,
    confidence: Math.min(1, Math.max(0, Number(setup?.quality_score || 0) / 100)),
    market_regime: setup?.trend === 'UP' ? 'TREND_UP' : setup?.trend === 'DOWN' ? 'TREND_DOWN' : 'RANGE',
    entry: decision === 'WAIT' ? 0 : Number(setup.entry),
    stop_loss: decision === 'WAIT' ? 0 : Number(setup.stop_loss),
    take_profit: decision === 'WAIT' ? 0 : Number(setup.take_profit),
    risk_reward: decision === 'WAIT' ? 0 : Number(setup.risk_reward),
    reason: confirmation.reason,
    invalid_reasons: confirmation.invalid_reasons,
    ai_environment: {
      status: String(confirmation.environment || 'INSUFFICIENT').toUpperCase(),
      confidence: Number.isFinite(Number(fundamentalAssessment?.confidence)) ? Number(fundamentalAssessment.confidence) : 0,
      freshness: String(fundamentalAssessment?.freshness || 'INSUFFICIENT').toUpperCase(),
      event_risk_next_24h: String(fundamentalAssessment?.event_risk_next_24h || 'UNKNOWN').toUpperCase(),
      event_summary: String(fundamentalAssessment?.event_summary || '')
    },
    fundamental: {
      bias: String(f.bias || 'INSUFFICIENT').toUpperCase(),
      confidence: Number.isFinite(Number(f.confidence))
        ? Number(f.confidence)
        : Number.isFinite(Number(fundamentalAssessment?.confidence))
          ? Number(fundamentalAssessment.confidence)
          : 0,
      freshness: String(fundamentalAssessment?.freshness || f.freshness || 'INSUFFICIENT').toUpperCase(),
      summary: String(f.summary || ''),
      drivers: Array.isArray(f.drivers) ? f.drivers.map(String) : [],
      risks: Array.isArray(f.risks) ? f.risks.map(String) : [],
      source_urls: Array.isArray(f.source_urls) ? f.source_urls.map(String) : [],
      event_risk_next_24h: String(fundamentalAssessment?.event_risk_next_24h || 'UNKNOWN').toUpperCase(),
      event_summary: String(fundamentalAssessment?.event_summary || ''),
      sources_count: Array.isArray(fundamentalResult?.sources) ? fundamentalResult.sources.length : 0
    }
  };
}

function dummyAccount() {
  return {
    equity: 100000,
    open_positions: 0,
    daily_pnl_pct: 0,
    drawdown_pct: 0,
    risk_data_ready: true,
    trade_allowed: 1,
    tick_size: 0.00001,
    tick_value: 1,
    min_lot: 0.01,
    max_lot: 100,
    lot_step: 0.01
  };
}

function executionEnabled() {
  return String(process.env.EURUSD_EXECUTION_ENABLED || 'false').toLowerCase() === 'true';
}

function aiEnvironmentEnabled() {
  return String(process.env.EURUSD_AI_ENABLED || 'false').toLowerCase() === 'true';
}

function buildTechnicalOnlyDecision(setup) {
  const candidate = String(setup?.candidate || 'WAIT').toUpperCase();
  if (!['BUY', 'SELL'].includes(candidate)) {
    return buildDecision(setup, emptyFundamental('AI environment filter disabled and technical setup was WAIT.'), null);
  }

  const confidence = Math.min(1, Math.max(0, Number(setup?.quality_score || 100) / 100));
  return {
    decision: candidate,
    candidate,
    confidence,
    market_regime: setup?.trend === 'UP' ? 'TREND_UP' : setup?.trend === 'DOWN' ? 'TREND_DOWN' : 'RANGE',
    entry: Number(setup.entry),
    stop_loss: Number(setup.stop_loss),
    take_profit: Number(setup.take_profit),
    risk_reward: Number(setup.risk_reward),
    reason: 'technical_setup_confirmed_ai_disabled',
    invalid_reasons: [],
    ai_environment: {
      status: 'DISABLED',
      confidence: 1,
      freshness: 'CURRENT',
      event_risk_next_24h: 'UNKNOWN',
      event_summary: 'AI environment filter disabled.'
    },
    fundamental: emptyFundamental('AI environment filter disabled.')
  };
}

export function eurUsdLiveTradingApproved() {
  return String(process.env.EURUSD_LIVE_TRADING_APPROVED || 'false').toLowerCase() === 'true';
}

function executionGate() {
  const execution = executionEnabled();
  const approved = eurUsdLiveTradingApproved();
  if (!execution) return { allowed: false, reason: 'execution_disabled' };
  if (!approved) return { allowed: false, reason: 'live_backtest_gate_not_approved' };
  return { allowed: true, reason: 'approved' };
}

export function registerEurUsdRoutes(app) {
  app.post('/api/eurusd/ai-test', auth, async (req, res) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
    try {
      const body = req.body || {};
      const symbol = String(body.symbol || 'EURUSD');
      const timeframe = String(body.timeframe || 'M15');
      if (symbol !== 'EURUSD') return res.status(400).json({ ok: false, error: 'EURUSD endpoint requires symbol=EURUSD', request_id: requestId });
      if (timeframe !== 'M15') return res.status(400).json({ ok: false, error: 'EURUSD V1 supports M15 only', request_id: requestId });

      const features = normalizeEurUsdFeatures(body.features || body);
      const featureErrors = validateEurUsdFeatures(features);
      if (featureErrors.length) return res.status(400).json({ ok: false, error: 'invalid_features', reasons: featureErrors, request_id: requestId });

      const setup = buildEurUsdSetup(features);
      if (setup.candidate === 'WAIT') {
        const decision = buildDecision(setup, emptyFundamental('AI fundamental search skipped because M15 setup was WAIT.'), null);
        const risk = evaluateEurUsdRisk({ decision, setup, features, account: dummyAccount() });
        return res.json({
          ok: true,
          request_id: requestId,
          symbol,
          timeframe,
          strategy_version: process.env.EURUSD_STRATEGY_VERSION || 'eurusd-m15-h1-ai-environment-v3-balanced-weekly',
          setup,
          h1_trend: setup.trend,
          candidate: setup.candidate,
          decision,
          risk,
          fundamental_sources: [],
          openai: { called: false, response_id: null, model: null, web_search_used: false },
          order_allowed: false,
          execution_test_only: true
        });
      }

      const fundamental = await analyzeEurUsdFundamental({
        features,
        candidate: setup.candidate,
        model: process.env.OPENAI_MODEL || 'gpt-5.5'
      });
      const decision = buildDecision(setup, fundamental.assessment, fundamental);
      const risk = evaluateEurUsdRisk({
        decision,
        setup,
        features,
        account: dummyAccount(),
        fundamentalAssessment: fundamental.assessment
      });
      res.json({
        ok: true,
        request_id: requestId,
        symbol,
        timeframe,
        strategy_version: process.env.EURUSD_STRATEGY_VERSION || 'eurusd-m15-h1-ai-environment-v3-balanced-weekly',
        setup,
        h1_trend: setup.trend,
        candidate: setup.candidate,
        decision,
        risk,
        fundamental_sources: fundamental.sources,
        fundamental_source_selection_method: fundamental.sources.length ? 'MODEL_URLS_MATCHED_TO_SEARCH_RESULTS_OR_CITATIONS' : 'NONE',
        searched_sources_count: fundamental.searchedSources.length,
        fundamental_validation: fundamental.validation,
        openai: {
          called: true,
          response_id: fundamental.responseId,
          model: fundamental.model,
          web_search_used: fundamental.webSearchUsed
        },
        order_allowed: false,
        execution_test_only: true
      });
    } catch (error) {
      console.error('[eurusd/ai-test]', requestId, error);
      res.status(500).json({ ok: false, error: error.message || 'EURUSD AI test failed', request_id: requestId });
    }
  });

  app.post('/api/eurusd/signal', auth, async (req, res) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
    try {
      const body = req.body || {};
      const symbol = String(body.symbol || 'EURUSD');
      const timeframe = String(body.timeframe || 'M15');
      if (symbol !== 'EURUSD') return res.status(400).json({ ok: false, error: 'EURUSD endpoint requires symbol=EURUSD', request_id: requestId });
      if (timeframe !== 'M15') return res.status(400).json({ ok: false, error: 'EURUSD V1 supports M15 only', request_id: requestId });

      const features = normalizeEurUsdFeatures(body.features || body);
      const featureErrors = validateEurUsdFeatures(features);
      if (featureErrors.length) return res.status(400).json({ ok: false, error: 'invalid_features', reasons: featureErrors, request_id: requestId });

      const strategyVersion = process.env.EURUSD_STRATEGY_VERSION || 'eurusd-m15-h1-ai-environment-v3-balanced-weekly';
      const barTimeIso = new Date(features.barTime * 1000).toISOString();
      const existing = await getSignalByKey({ symbol, timeframe, barTimeIso, strategyVersion });
      if (existing) {
        return res.status(409).json({
          ok: false,
          error: 'duplicate_bar',
          request_id: requestId,
          signal_id: existing.id,
          decision: existing.decision,
          existing: true
        });
      }

      const setup = buildEurUsdSetup(features);
      let fundamental = null;
      let decision;
      if (setup.candidate === 'WAIT') {
        decision = buildDecision(setup, emptyFundamental('AI fundamental search skipped because M15 setup was WAIT.'), null);
      } else if (!aiEnvironmentEnabled()) {
        decision = buildTechnicalOnlyDecision(setup);
      } else {
        fundamental = await analyzeEurUsdFundamental({
          features,
          candidate: setup.candidate,
          model: process.env.OPENAI_MODEL || 'gpt-5.5'
        });
        decision = buildDecision(setup, fundamental.assessment, fundamental);
      }

      const signalCreatedAt = Date.now();
      const signalId = crypto.randomUUID();
      const account = body.account || {};
      const risk = evaluateEurUsdRisk({
        decision,
        setup,
        features,
        account,
        signalCreatedAt,
        now: Date.now(),
        fundamentalAssessment: fundamental?.assessment || null,
        safetyContext: {
          nowMs: Date.now(),
          safety: features.safety || {},
          newsFeed: getEurUsdNewsFeedState()
        }
      });

      const signalRow = {
        id: signalId,
        symbol,
        timeframe,
        bar_time: barTimeIso,
        strategy_version: strategyVersion,
        request_id: requestId,
        candidate: setup.candidate,
        decision: decision.decision,
        confidence: decision.confidence,
        market_regime: decision.market_regime,
        entry: decision.entry || null,
        stop_loss: decision.stop_loss || null,
        take_profit: decision.take_profit || null,
        risk_reward: decision.risk_reward || null,
        reason: decision.reason,
        invalid_reasons: decision.invalid_reasons,
        openai_response_id: fundamental?.responseId || null,
        model: fundamental?.model || null,
        created_at: nowIso()
      };

      try {
        await insertSignal(signalRow);
      } catch (error) {
        if (error?.code === '23505') {
          const raced = await getSignalByKey({ symbol, timeframe, barTimeIso, strategyVersion });
          return res.status(409).json({ ok: false, error: 'duplicate_bar', request_id: requestId, signal_id: raced?.id || null, existing: true });
        }
        throw error;
      }

      await insertRisk({
        signal_id: signalId,
        approved: risk.approved,
        reasons: risk.reasons,
        age_seconds: risk.ageSeconds,
        account_snapshot: {
          ...account,
          risk_limits: getEurUsdRiskLimits(),
          calculated_lots: risk.lots
        },
        created_at: nowIso()
      });

      if (fundamental?.webSearchUsed) {
        try {
          await insertEvent({
            level: 'INFO',
            event_type: 'eurusd_fundamental_analysis',
            message: 'EURUSD live web fundamental analysis completed',
            metadata: {
              request_id: requestId,
              signal_id: signalId,
              candidate: setup.candidate,
              setup,
              fundamental: decision.fundamental,
              sources: fundamental.sources,
              validation: fundamental.validation
            },
            created_at: nowIso()
          });
        } catch (eventError) {
          console.error('[eurusd/fundamental-event]', requestId, eventError);
        }
      }

      const gate = executionGate();
      const orderAllowed = Boolean(
        gate.allowed &&
        risk.approved &&
        ['DEMO', 'LIVE'].includes(String((await getState())?.mode || ''))
      );

      res.json({
        ok: true,
        request_id: requestId,
        signal_id: signalId,
        symbol,
        timeframe,
        strategy_version: strategyVersion,
        setup,
        h1_trend: setup.trend,
        candidate: setup.candidate,
        decision,
        risk,
        fundamental_sources: fundamental?.sources || [],
        searched_sources_count: Array.isArray(fundamental?.searchedSources) ? fundamental.searchedSources.length : 0,
        openai: {
          called: Boolean(fundamental?.responseId),
          response_id: fundamental?.responseId || null,
          model: fundamental?.model || null,
          web_search_used: fundamental?.webSearchUsed === true
        },
        order_allowed: orderAllowed,
        execution_enabled: executionEnabled(),
        live_trading_approved: eurUsdLiveTradingApproved(),
        execution_gate: gate,
        ai_environment_enabled: aiEnvironmentEnabled(),
        safety: risk.safety,
        persisted: true,
        orders_executed: false
      });
    } catch (error) {
      console.error('[eurusd/signal]', requestId, error);
      try {
        await insertEvent({
          level: 'ERROR',
          event_type: 'eurusd_signal_error',
          message: error.message || String(error),
          metadata: { request_id: requestId },
          created_at: nowIso()
        });
      } catch {}
      res.status(500).json({ ok: false, error: error.message || 'EURUSD signal generation failed', request_id: requestId });
    }
  });


  app.post('/api/eurusd/pullback-ai-test', auth, async (req, res) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
    try {
      const body = req.body || {};
      const symbol = String(body.symbol || 'EURUSD');
      const timeframe = String(body.timeframe || 'M15');
      if (symbol !== 'EURUSD') return res.status(400).json({ ok: false, error: 'EURUSD endpoint requires symbol=EURUSD', request_id: requestId });
      if (timeframe !== 'M15') return res.status(400).json({ ok: false, error: 'EURUSD V1 supports M15 only', request_id: requestId });

      const features = normalizeEurUsdFeatures(body.features || body);
      const featureErrors = validateEurUsdFeatures(features);
      if (featureErrors.length) return res.status(400).json({ ok: false, error: 'invalid_features', reasons: featureErrors, request_id: requestId });

      const setup = buildEurUsdTrendPullbackSetup(features);
      const strategyVersion = process.env.EURUSD_PULLBACK_STRATEGY_VERSION || 'eurusd-m15-h1-trend-pullback-v1';

      if (setup.candidate === 'WAIT') {
        const decision = buildDecision(setup, emptyFundamental('AI fundamental search skipped because trend-pullback setup was WAIT.'), null);
        const risk = evaluateEurUsdRisk({ decision, setup, features, account: dummyAccount() });
        return res.json({
          ok: true,
          request_id: requestId,
          symbol,
          timeframe,
          strategy_version: strategyVersion,
          setup,
          h1_trend: setup.trend,
          candidate: setup.candidate,
          decision,
          risk,
          fundamental_sources: [],
          openai: { called: false, response_id: null, model: null, web_search_used: false },
          order_allowed: false,
          execution_test_only: true
        });
      }

      const fundamental = await analyzeEurUsdFundamental({
        features,
        candidate: setup.candidate,
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        strategyType: 'TREND_PULLBACK'
      });
      const decision = buildDecision(setup, fundamental.assessment, fundamental);
      const risk = evaluateEurUsdRisk({
        decision,
        setup,
        features,
        account: dummyAccount(),
        fundamentalAssessment: fundamental.assessment
      });

      res.json({
        ok: true,
        request_id: requestId,
        symbol,
        timeframe,
        strategy_version: strategyVersion,
        setup,
        h1_trend: setup.trend,
        candidate: setup.candidate,
        decision,
        risk,
        fundamental_sources: fundamental.sources,
        searched_sources_count: fundamental.searchedSources.length,
        fundamental_validation: fundamental.validation,
        openai: {
          called: true,
          response_id: fundamental.responseId,
          model: fundamental.model,
          web_search_used: fundamental.webSearchUsed
        },
        order_allowed: false,
        execution_test_only: true
      });
    } catch (error) {
      console.error('[eurusd/pullback-ai-test]', requestId, error);
      res.status(500).json({ ok: false, error: error.message || 'EURUSD pullback AI test failed', request_id: requestId });
    }
  });

  app.post('/api/eurusd/pullback-signal', auth, async (req, res) => {
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID());
    try {
      const body = req.body || {};
      const symbol = String(body.symbol || 'EURUSD');
      const timeframe = String(body.timeframe || 'M15');
      if (symbol !== 'EURUSD') return res.status(400).json({ ok: false, error: 'EURUSD endpoint requires symbol=EURUSD', request_id: requestId });
      if (timeframe !== 'M15') return res.status(400).json({ ok: false, error: 'EURUSD V1 supports M15 only', request_id: requestId });

      const features = normalizeEurUsdFeatures(body.features || body);
      const featureErrors = validateEurUsdFeatures(features);
      if (featureErrors.length) return res.status(400).json({ ok: false, error: 'invalid_features', reasons: featureErrors, request_id: requestId });

      const strategyVersion = process.env.EURUSD_PULLBACK_STRATEGY_VERSION || 'eurusd-m15-h1-trend-pullback-v1';
      const barTimeIso = new Date(features.barTime * 1000).toISOString();
      const existing = await getSignalByKey({ symbol, timeframe, barTimeIso, strategyVersion });
      if (existing) {
        return res.status(409).json({
          ok: false,
          error: 'duplicate_bar',
          request_id: requestId,
          signal_id: existing.id,
          decision: existing.decision,
          existing: true
        });
      }

      const setup = buildEurUsdTrendPullbackSetup(features);
      let fundamental = null;
      let decision;

      if (setup.candidate === 'WAIT') {
        decision = buildDecision(setup, emptyFundamental('AI fundamental search skipped because trend-pullback setup was WAIT.'), null);
      } else {
        fundamental = await analyzeEurUsdFundamental({
          features,
          candidate: setup.candidate,
          model: process.env.OPENAI_MODEL || 'gpt-5.5',
          strategyType: 'TREND_PULLBACK'
        });
        decision = buildDecision(setup, fundamental.assessment, fundamental);
      }

      const signalCreatedAt = Date.now();
      const signalId = crypto.randomUUID();
      const account = body.account || {};
      const risk = evaluateEurUsdRisk({
        decision,
        setup,
        features,
        account,
        signalCreatedAt,
        now: Date.now(),
        fundamentalAssessment: fundamental?.assessment || null
      });

      const signalRow = {
        id: signalId,
        symbol,
        timeframe,
        bar_time: barTimeIso,
        strategy_version: strategyVersion,
        request_id: requestId,
        candidate: setup.candidate,
        decision: decision.decision,
        confidence: decision.confidence,
        market_regime: decision.market_regime,
        entry: decision.entry || null,
        stop_loss: decision.stop_loss || null,
        take_profit: decision.take_profit || null,
        risk_reward: decision.risk_reward || null,
        reason: decision.reason,
        invalid_reasons: decision.invalid_reasons,
        openai_response_id: fundamental?.responseId || null,
        model: fundamental?.model || null,
        created_at: nowIso()
      };

      try {
        await insertSignal(signalRow);
      } catch (error) {
        if (error?.code === '23505') {
          const raced = await getSignalByKey({ symbol, timeframe, barTimeIso, strategyVersion });
          return res.status(409).json({
            ok: false,
            error: 'duplicate_bar',
            request_id: requestId,
            signal_id: raced?.id || null,
            existing: true
          });
        }
        throw error;
      }

      await insertRisk({
        signal_id: signalId,
        approved: risk.approved,
        reasons: risk.reasons,
        age_seconds: risk.ageSeconds,
        account_snapshot: {
          ...account,
          risk_limits: getEurUsdRiskLimits(),
          calculated_lots: risk.lots
        },
        created_at: nowIso()
      });

      if (fundamental?.webSearchUsed) {
        try {
          await insertEvent({
            level: 'INFO',
            event_type: 'eurusd_pullback_fundamental_analysis',
            message: 'EURUSD trend pullback live web fundamental analysis completed',
            metadata: {
              request_id: requestId,
              signal_id: signalId,
              candidate: setup.candidate,
              setup,
              fundamental: decision.fundamental,
              sources: fundamental.sources,
              validation: fundamental.validation
            },
            created_at: nowIso()
          });
        } catch (eventError) {
          console.error('[eurusd/pullback-fundamental-event]', requestId, eventError);
        }
      }

      const state = (await getState()) || {};
      const gate = executionGate();
      const orderAllowed = Boolean(
        gate.allowed &&
        risk.approved &&
        ['DEMO', 'LIVE'].includes(String(state.mode || ''))
      );

      res.json({
        ok: true,
        request_id: requestId,
        signal_id: signalId,
        symbol,
        timeframe,
        strategy_version: strategyVersion,
        setup,
        h1_trend: setup.trend,
        candidate: setup.candidate,
        decision,
        risk,
        fundamental_sources: fundamental?.sources || [],
        searched_sources_count: Array.isArray(fundamental?.searchedSources) ? fundamental.searchedSources.length : 0,
        openai: {
          called: Boolean(fundamental?.responseId),
          response_id: fundamental?.responseId || null,
          model: fundamental?.model || null,
          web_search_used: fundamental?.webSearchUsed === true
        },
        order_allowed: orderAllowed,
        execution_enabled: executionEnabled(),
        live_trading_approved: eurUsdLiveTradingApproved(),
        execution_gate: gate,
        persisted: true,
        orders_executed: false
      });
    } catch (error) {
      console.error('[eurusd/pullback-signal]', requestId, error);
      try {
        await insertEvent({
          level: 'ERROR',
          event_type: 'eurusd_pullback_signal_error',
          message: error.message || String(error),
          metadata: { request_id: requestId },
          created_at: nowIso()
        });
      } catch {}
      res.status(500).json({ ok: false, error: error.message || 'EURUSD pullback signal generation failed', request_id: requestId });
    }
  });

  app.get('/api/eurusd/pullback-status', auth, async (req, res) => {
    try {
      const state = await getState();
      res.json({
        ok: true,
        service: 'eurusd-m15-h1-trend-pullback-v1',
        symbol: 'EURUSD',
        timeframe: 'M15',
        strategy_version: process.env.EURUSD_PULLBACK_STRATEGY_VERSION || 'eurusd-m15-h1-trend-pullback-v1',
        execution_enabled: executionEnabled(),
        live_trading_approved: eurUsdLiveTradingApproved(),
        execution_gate: executionGate(),
        risk_limits: getEurUsdRiskLimits(),
        state: state || null
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'EURUSD pullback status failed' });
    }
  });

  app.get('/api/eurusd/safety-status', auth, async (req, res) => {
    try {
      const feed = getEurUsdNewsFeedState();
      res.json({
        ok: true,
        symbol: 'EURUSD',
        safety_mode: 'FAIL_CLOSED',
        ai_environment_enabled: aiEnvironmentEnabled(),
        news_feed: feed
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'EURUSD safety status failed' });
    }
  });

  app.post('/api/eurusd/safety-check', auth, async (req, res) => {
    try {
      const body = req.body || {};
      const safety = body.safety && typeof body.safety === 'object' ? body.safety : {};
      const result = evaluateEurUsdSafety({
        nowMs: Date.now(),
        safety,
        newsFeed: getEurUsdNewsFeedState(),
        config: getEurUsdRiskLimits().safety
      });
      res.json({
        ok: true,
        symbol: 'EURUSD',
        safety_mode: 'FAIL_CLOSED',
        evaluated_at: new Date().toISOString(),
        safety: result
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'EURUSD safety check failed' });
    }
  });

  app.get('/api/eurusd/status', auth, async (req, res) => {
    try {
      const state = await getState();
      res.json({
        ok: true,
        service: 'eurusd-m15-h1-ai-environment-v3-balanced-weekly',
        symbol: 'EURUSD',
        timeframe: 'M15',
        strategy_version: process.env.EURUSD_STRATEGY_VERSION || 'eurusd-m15-h1-ai-environment-v3-balanced-weekly',
        execution_enabled: executionEnabled(),
        risk_limits: getEurUsdRiskLimits(),
        state: state || null
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'EURUSD status failed' });
    }
  });

  app.post('/api/eurusd/execution-result', auth, async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.signal_id || !body.idempotency_key) {
        return res.status(400).json({ ok: false, error: 'signal_id and idempotency_key are required' });
      }
      const signal = await getSignalByKey({ signalId: String(body.signal_id) });
      if (!signal || String(signal.symbol) !== 'EURUSD' || String(signal.timeframe) !== 'M15') {
        return res.status(404).json({ ok: false, error: 'eurusd_signal_not_found' });
      }
      const risk = await getRiskBySignal(String(body.signal_id));
      if (!risk?.approved) return res.status(409).json({ ok: false, error: 'signal_was_not_risk_approved' });
      const side = String(body.side || '').toUpperCase();
      if (!['BUY', 'SELL'].includes(side) || side !== String(signal.decision).toUpperCase()) return res.status(400).json({ ok: false, error: 'side_mismatch' });
      const status = String(body.status || 'UNKNOWN').toUpperCase();
      const ticket = Number(body.mt4_ticket || 0) || null;
      if (status === 'FILLED' && !ticket) return res.status(400).json({ ok: false, error: 'filled_order_requires_ticket' });

      const saved = await insertOrder({
        id: body.order_id || crypto.randomUUID(),
        signal_id: body.signal_id,
        idempotency_key: String(body.idempotency_key),
        symbol: 'EURUSD',
        mt4_ticket: ticket,
        side,
        requested_price: Number(body.requested_price || 0) || null,
        filled_price: Number(body.filled_price || 0) || null,
        volume: Number(body.volume || 0) || null,
        stop_loss: Number(body.stop_loss || 0) || null,
        take_profit: Number(body.take_profit || 0) || null,
        status,
        broker_error: body.broker_error ? String(body.broker_error) : null,
        metadata: body.metadata || {},
        created_at: nowIso()
      });
      res.json({ ok: true, persisted: saved.persisted, order: saved.row });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || 'EURUSD execution result failed' });
    }
  });
}
