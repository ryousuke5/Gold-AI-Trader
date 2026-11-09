const DATASETS = {
  "market-safety": {
    filename: "GOLD_MarketSafety.csv",
    columns: [
      "created_at_utc", "symbol", "status", "freshness", "reported_allowed",
      "api_validation_allowed", "reason", "quote_time_utc", "quote_age_seconds",
      "bid", "ask", "mid_price", "spread_price", "stable_tick_count",
      "anomaly_active", "reopen_lock_until_utc", "api_validation_reasons",
      "enable_signal_requests", "run_ai_test_once", "allow_auto_orders",
      "timer_seconds", "flow_status", "flow_reason", "current_closed_m5_bar_open_utc",
      "last_handled_m5_bar_open_utc", "last_attempted_m5_bar_open_utc",
      "last_attempt_at_utc", "research_snapshot_available"
    ]
  },
  "m5-h1": {
    filename: "GOLD_M5_H1_Data.csv",
    columns: [
      "captured_at_utc", "source_event_id", "request_id", "signal_id", "symbol",
      "strategy_version", "timeframe", "bar_time_utc", "open", "high", "low",
      "close", "volume", "bid", "ask", "spread", "point", "m5_ema20",
      "m5_ema50", "m5_rsi14", "m5_atr14", "h1_close", "h1_ema20",
      "h1_ema50", "h1_ema200", "h1_rsi14", "h1_atr14"
    ]
  },
  "signals": {
    filename: "GOLD_SignalHistory.csv",
    columns: [
      "created_at_utc", "id", "request_id", "symbol", "timeframe", "bar_time_utc",
      "strategy_version", "candidate", "decision", "confidence", "market_regime",
      "entry", "stop_loss", "take_profit", "risk_reward", "reason", "invalid_reasons"
    ]
  },
  "paper-trades": {
    filename: "GOLD_Paper_Trades.csv",
    columns: [
      "created_at_utc", "id", "order_id", "symbol", "mode", "strategy_version",
      "result", "entry_price", "exit_price", "stop_loss", "take_profit",
      "spread_price", "slippage_price", "commission", "swap", "profit",
      "r_multiple", "mfe_r", "mae_r", "holding_seconds", "exit_reason"
    ]
  }
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteOrBlank(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function epochToIso(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (Number.isFinite(number) && number > 1_000_000_000) {
    const date = new Date(number * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  let text;
  if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);

  // Prevent spreadsheet formula execution for untrusted text cells.
  if (typeof value !== "number" && /^[\s]*[=+@]/.test(text)) text = "'" + text;
  if (/^[\s]*-/.test(text) && typeof value !== "number" && !/^[\s]*-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    text = "'" + text;
  }
  if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function rowsToCsv(rows, columns) {
  const header = columns.map(csvCell).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column])).join(","));
  return "\uFEFF" + [header, ...body].join("\r\n") + "\r\n";
}

function eventMetadata(event) {
  return isObject(event?.metadata) ? event.metadata : {};
}

function marketSafetyRows(events) {
  return (events || []).map((event) => {
    const metadata = eventMetadata(event);
    const ea = isObject(metadata.ea_runtime) ? metadata.ea_runtime : {};
    return {
      created_at_utc: epochToIso(event.created_at || metadata.received_at),
      symbol: metadata.symbol || "",
      status: metadata.status || "",
      freshness: metadata.freshness || "",
      reported_allowed: metadata.reported_allowed,
      api_validation_allowed: metadata.api_validation_allowed,
      reason: metadata.reason || "",
      quote_time_utc: epochToIso(metadata.quote_time_utc),
      quote_age_seconds: finiteOrBlank(metadata.quote_age_seconds),
      bid: finiteOrBlank(metadata.bid),
      ask: finiteOrBlank(metadata.ask),
      mid_price: finiteOrBlank(metadata.mid_price),
      spread_price: finiteOrBlank(metadata.spread_price),
      stable_tick_count: finiteOrBlank(metadata.stable_tick_count),
      anomaly_active: metadata.anomaly_active,
      reopen_lock_until_utc: epochToIso(metadata.reopen_lock_until_utc),
      api_validation_reasons: metadata.api_validation_reasons || [],
      enable_signal_requests: ea.enable_signal_requests,
      run_ai_test_once: ea.run_ai_test_once,
      allow_auto_orders: ea.allow_auto_orders,
      timer_seconds: finiteOrBlank(ea.timer_seconds),
      flow_status: ea.flow_status || "",
      flow_reason: ea.flow_reason || "",
      current_closed_m5_bar_open_utc: epochToIso(ea.current_closed_m5_bar_open_utc),
      last_handled_m5_bar_open_utc: epochToIso(ea.last_handled_m5_bar_open_utc),
      last_attempted_m5_bar_open_utc: epochToIso(ea.last_attempted_m5_bar_open_utc),
      last_attempt_at_utc: epochToIso(ea.last_attempt_at_utc),
      research_snapshot_available: isObject(metadata.research_snapshot)
    };
  });
}

function marketDataRows(events) {
  const deduped = new Map();
  for (const event of events || []) {
    const metadata = eventMetadata(event);
    const snapshot = isObject(metadata.research_snapshot)
      ? metadata.research_snapshot
      : (isObject(metadata.features) ? metadata.features : null);
    if (!snapshot) continue;

    const features = isObject(metadata.features) ? metadata.features : snapshot;
    const m5 = isObject(snapshot.m5) ? snapshot.m5 : (isObject(features.m5) ? features.m5 : {});
    const h1 = isObject(snapshot.h1) ? snapshot.h1 : (isObject(features.h1) ? features.h1 : {});
    const recentM5 = Array.isArray(snapshot.recent_m5) ? snapshot.recent_m5
      : (Array.isArray(snapshot.recentM5) ? snapshot.recentM5
      : (Array.isArray(features.recentM5) ? features.recentM5 : []));
    const recentH1 = Array.isArray(snapshot.recent_h1) ? snapshot.recent_h1
      : (Array.isArray(snapshot.recentH1) ? snapshot.recentH1
      : (Array.isArray(features.recentH1) ? features.recentH1 : []));
    const symbol = String(metadata.symbol || snapshot.symbol || "");
    const strategyVersion = String(metadata.strategy_version || snapshot.strategy_version || "");
    const common = {
      captured_at_utc: epochToIso(event.created_at || snapshot.captured_at_utc),
      source_event_id: event.id || "",
      request_id: metadata.request_id || "",
      signal_id: metadata.signal_id || "",
      symbol,
      strategy_version: strategyVersion,
      bid: finiteOrBlank(snapshot.bid ?? features.bid),
      ask: finiteOrBlank(snapshot.ask ?? features.ask),
      spread: finiteOrBlank(snapshot.spread ?? features.spread),
      point: finiteOrBlank(snapshot.point ?? features.point),
      m5_ema20: finiteOrBlank(m5.ema20),
      m5_ema50: finiteOrBlank(m5.ema50),
      m5_rsi14: finiteOrBlank(m5.rsi14),
      m5_atr14: finiteOrBlank(m5.atr14),
      h1_close: finiteOrBlank(h1.close),
      h1_ema20: finiteOrBlank(h1.ema20),
      h1_ema50: finiteOrBlank(h1.ema50),
      h1_ema200: finiteOrBlank(h1.ema200),
      h1_rsi14: finiteOrBlank(h1.rsi14),
      h1_atr14: finiteOrBlank(h1.atr14)
    };

    const appendBars = (bars, timeframe) => {
      for (const bar of bars) {
        if (!isObject(bar)) continue;
        const barTime = epochToIso(bar.time ?? bar.bar_time_utc);
        if (!barTime) continue;
        const row = {
          ...common,
          timeframe,
          bar_time_utc: barTime,
          open: finiteOrBlank(bar.open),
          high: finiteOrBlank(bar.high),
          low: finiteOrBlank(bar.low),
          close: finiteOrBlank(bar.close),
          volume: finiteOrBlank(bar.volume)
        };
        const key = [symbol, timeframe, barTime, strategyVersion].join("|");
        deduped.set(key, row);
      }
    };
    appendBars(recentM5, "M5");
    appendBars(recentH1, "H1");
  }
  return [...deduped.values()].sort((a, b) =>
    String(a.bar_time_utc).localeCompare(String(b.bar_time_utc)) ||
    String(a.timeframe).localeCompare(String(b.timeframe))
  );
}

function signalRows(signals) {
  return (signals || []).map((row) => ({
    created_at_utc: epochToIso(row.created_at),
    id: row.id || "",
    request_id: row.request_id || "",
    symbol: row.symbol || "",
    timeframe: row.timeframe || "",
    bar_time_utc: epochToIso(row.bar_time),
    strategy_version: row.strategy_version || "",
    candidate: row.candidate || "",
    decision: row.decision || "",
    confidence: finiteOrBlank(row.confidence),
    market_regime: row.market_regime || "",
    entry: finiteOrBlank(row.entry),
    stop_loss: finiteOrBlank(row.stop_loss),
    take_profit: finiteOrBlank(row.take_profit),
    risk_reward: finiteOrBlank(row.risk_reward),
    reason: row.reason || "",
    invalid_reasons: row.invalid_reasons || []
  }));
}

function paperTradeRows(trades) {
  return (trades || []).filter((row) => {
    const metadata = isObject(row.metadata) ? row.metadata : {};
    const capture = isObject(metadata.capture) ? metadata.capture : {};
    const mode = String(capture.mode || metadata.mode || "").toUpperCase();
    return mode === "PAPER" || mode === "FORWARD_PAPER" || mode === "ANALYSIS_PAPER";
  }).map((row) => {
    const metadata = isObject(row.metadata) ? row.metadata : {};
    const capture = isObject(metadata.capture) ? metadata.capture : metadata;
    return {
      created_at_utc: epochToIso(row.created_at),
      id: row.id || "",
      order_id: row.order_id || "",
      symbol: row.symbol || "",
      mode: capture.mode || metadata.mode || "",
      strategy_version: capture.strategy_version || metadata.strategy_version || "",
      result: row.result || "",
      entry_price: finiteOrBlank(capture.entry_price),
      exit_price: finiteOrBlank(capture.exit_price),
      stop_loss: finiteOrBlank(capture.stop_loss),
      take_profit: finiteOrBlank(capture.take_profit),
      spread_price: finiteOrBlank(capture.spread_price),
      slippage_price: finiteOrBlank(capture.slippage_price),
      commission: finiteOrBlank(capture.commission),
      swap: finiteOrBlank(capture.swap),
      profit: finiteOrBlank(row.profit),
      r_multiple: finiteOrBlank(row.r_multiple),
      mfe_r: finiteOrBlank(capture.mfe_r),
      mae_r: finiteOrBlank(capture.mae_r),
      holding_seconds: finiteOrBlank(row.holding_seconds),
      exit_reason: row.exit_reason || ""
    };
  });
}

export function buildGoldExportCsv(dataset, records = {}) {
  const definition = DATASETS[dataset];
  if (!definition) throw new Error("unsupported_export_dataset");
  let rows;
  if (dataset === "market-safety") rows = marketSafetyRows(records.events || []);
  else if (dataset === "m5-h1") rows = marketDataRows(records.events || []);
  else if (dataset === "signals") rows = signalRows(records.signals || []);
  else rows = paperTradeRows(records.trades || []);
  return {
    filename: definition.filename,
    rowCount: rows.length,
    content: rowsToCsv(rows, definition.columns)
  };
}
