import {
  insertEurUsdForwardTrade,
  listEurUsdForwardOpenTrades,
  listEurUsdForwardTrades,
  updateEurUsdForwardTrade
} from './db.js';

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function finite(n) {
  return Number.isFinite(Number(n));
}

function barCloseMs(features) {
  const time = Number(features?.barTime || 0);
  return time > 0 ? time * 1000 + 900000 : Date.now();
}

function settlementR(side, entry, stopLoss, exitPrice) {
  const risk = Math.abs(entry - stopLoss);
  if (!(risk > 0)) return 0;
  return side === 'BUY'
    ? (exitPrice - entry) / risk
    : (entry - exitPrice) / risk;
}

function chooseBarExit(trade, bar) {
  const side = String(trade.side).toUpperCase();
  const high = Number(bar.high);
  const low = Number(bar.low);
  const sl = Number(trade.stop_loss);
  const tp = Number(trade.take_profit);

  if (![high, low, sl, tp].every(finite)) return null;

  if (side === 'BUY') {
    const stopHit = low <= sl;
    const targetHit = high >= tp;
    if (stopHit) return { price: sl, reason: targetHit ? 'SL_FIRST_ASSUMPTION' : 'STOP_LOSS' };
    if (targetHit) return { price: tp, reason: 'TAKE_PROFIT' };
  } else if (side === 'SELL') {
    const stopHit = high >= sl;
    const targetHit = low <= tp;
    if (stopHit) return { price: sl, reason: targetHit ? 'SL_FIRST_ASSUMPTION' : 'STOP_LOSS' };
    if (targetHit) return { price: tp, reason: 'TAKE_PROFIT' };
  }
  return null;
}

function markStatus(rMultiple) {
  if (rMultiple > 0) return 'WIN';
  if (rMultiple < 0) return 'LOSS';
  return 'BREAKEVEN';
}

export function getEurUsdForwardConfig() {
  return {
    enabled: envBool('EURUSD_FORWARD_TEST_ENABLED', false),
    maxHoldSeconds: Math.max(60, Number(process.env.EURUSD_MAX_HOLD_SECONDS || 3600)),
    maxTrades: Math.max(1, Number(process.env.EURUSD_FORWARD_MAX_TRADES || 1)),
    startingEquity: Math.max(1, Number(process.env.EURUSD_FORWARD_STARTING_EQUITY || 100000))
  };
}

export async function settleEurUsdForwardTrades({
  features,
  safety,
  nowMs = Date.now()
} = {}) {
  const openTrades = await listEurUsdForwardOpenTrades();
  const bar = Array.isArray(features?.recentM15) ? features.recentM15.at(-1) : null;
  const barTimeMs = barCloseMs(features);

  const results = [];
  for (const trade of openTrades) {
    if (Number(trade.opened_bar_time ? Date.parse(trade.opened_bar_time) : NaN) >= barTimeMs) {
      continue;
    }

    let exit = null;
    const safetyForceClose = safety?.forceClose === true;

    if (safetyForceClose) {
      const side = String(trade.side).toUpperCase();
      const market = side === 'BUY' ? Number(features.bid) : Number(features.ask);
      if (market > 0) {
        const reason = Array.isArray(safety?.actions) && safety.actions.includes('FORCE_CLOSE_WEEKEND_POSITIONS')
          ? 'SAFETY_WEEKEND_FORCE_CLOSE'
          : Array.isArray(safety?.actions) && safety.actions.includes('FORCE_CLOSE_NEWS_EXPOSED_POSITIONS')
            ? 'SAFETY_NEWS_FORCE_CLOSE'
            : 'SAFETY_MAX_HOLD_FORCE_CLOSE';
        exit = { price: market, reason };
      }
    }

    if (!exit && bar) {
      exit = chooseBarExit(trade, bar);
    }

    const openedMs = Date.parse(trade.opened_at);
    const holdingSeconds = Number.isFinite(openedMs)
      ? Math.max(0, (barTimeMs - openedMs) / 1000)
      : 0;

    if (!exit && holdingSeconds > getEurUsdForwardConfig().maxHoldSeconds) {
      const side = String(trade.side).toUpperCase();
      const market = side === 'BUY' ? Number(features.bid) : Number(features.ask);
      if (market > 0) exit = { price: market, reason: 'MAXIMUM_HOLD_TIME' };
    }

    if (!exit) continue;

    const rMultiple = settlementR(
      String(trade.side).toUpperCase(),
      Number(trade.entry),
      Number(trade.stop_loss),
      Number(exit.price)
    );

    const status = exit.reason === 'MAXIMUM_HOLD_TIME'
      ? 'EXPIRED'
      : markStatus(rMultiple);

    const updated = await updateEurUsdForwardTrade(trade.id, {
      status,
      exit_price: Number(exit.price),
      exit_at: new Date(barTimeMs).toISOString(),
      exit_bar_time: new Date(barTimeMs).toISOString(),
      exit_reason: exit.reason,
      r_multiple: rMultiple,
      holding_seconds: Math.round(holdingSeconds)
    });

    results.push(updated.row);
  }

  return results;
}

export async function maybeOpenEurUsdForwardTrade({
  signalId,
  strategyVersion,
  decision,
  risk,
  features,
  account = {},
  nowMs = Date.now()
} = {}) {
  const config = getEurUsdForwardConfig();
  if (!config.enabled) return { opened: false, reason: 'forward_test_disabled' };

  const side = String(decision?.decision || 'WAIT').toUpperCase();
  if (!['BUY', 'SELL'].includes(side)) return { opened: false, reason: 'decision_wait' };
  if (risk?.approved !== true) return { opened: false, reason: 'risk_not_approved' };
  if (risk?.safety?.newOrdersAllowed !== true) return { opened: false, reason: 'safety_block' };

  const entry = Number(decision.entry);
  const stopLoss = Number(decision.stop_loss);
  const takeProfit = Number(decision.take_profit);
  const riskReward = Number(decision.risk_reward);
  const riskDistance = Math.abs(entry - stopLoss);

  if (![entry, stopLoss, takeProfit, riskReward, riskDistance].every(finite) || !(riskDistance > 0)) {
    return { opened: false, reason: 'invalid_trade_geometry' };
  }

  const currentOpen = await listEurUsdForwardOpenTrades();
  if (currentOpen.length >= config.maxTrades) {
    return { opened: false, reason: 'forward_max_open_trades' };
  }

  const openedAt = new Date(barCloseMs(features)).toISOString();
  const row = {
    signal_id: signalId,
    strategy_version: strategyVersion,
    symbol: 'EURUSD',
    timeframe: 'M15',
    side,
    entry,
    stop_loss: stopLoss,
    take_profit: takeProfit,
    risk_reward: riskReward,
    risk_distance: riskDistance,
    opened_at: openedAt,
    opened_bar_time: openedAt,
    status: 'OPEN',
    safety_snapshot: risk.safety || {},
    account_snapshot: account || {},
    metadata: {
      mode: 'FORWARD_PAPER',
      recorded_at: new Date(nowMs).toISOString(),
      technical_confidence: Number(decision.confidence || 0)
    }
  };

  const inserted = await insertEurUsdForwardTrade(row);
  return { opened: true, trade: inserted.row, persisted: inserted.persisted };
}

export function summarizeEurUsdForwardTrades(trades, nowMs = Date.now()) {
  const rows = Array.isArray(trades) ? trades : [];
  const closed = rows.filter(t => ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED'].includes(String(t.status).toUpperCase()));
  const wins = closed.filter(t => Number(t.r_multiple) > 0);
  const losses = closed.filter(t => Number(t.r_multiple) < 0);
  const netR = closed.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0);
  const grossWins = wins.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0);
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of [...closed].sort((a, b) => Date.parse(a.exit_at || a.opened_at) - Date.parse(b.exit_at || b.opened_at))) {
    equity += Number(trade.r_multiple || 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const firstMs = closed.length ? Date.parse(closed[0].opened_at) : NaN;
  const lastMs = closed.length ? Date.parse(closed.at(-1).exit_at || closed.at(-1).opened_at) : NaN;
  const weeks = Number.isFinite(firstMs) && Number.isFinite(lastMs)
    ? Math.max(1, (lastMs - firstMs) / 1000 / 86400 / 7)
    : 0;

  return {
    forward_test_enabled: getEurUsdForwardConfig().enabled,
    trades_total: rows.length,
    open_trades: rows.filter(t => String(t.status).toUpperCase() === 'OPEN').length,
    closed_trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    win_rate_pct: closed.length ? wins.length / closed.length * 100 : 0,
    net_r: netR,
    profit_factor: grossLosses > 0 ? grossWins / grossLosses : null,
    expectancy_r: closed.length ? netR / closed.length : 0,
    max_drawdown_r: maxDrawdown,
    trades_per_week: weeks ? closed.length / weeks : 0,
    evaluated_at: new Date(nowMs).toISOString()
  };
}
