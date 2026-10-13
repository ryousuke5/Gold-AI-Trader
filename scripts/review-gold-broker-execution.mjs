#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseCsv(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (inQuotes) throw new Error('Malformed CSV: unterminated quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(value => value !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0].map((header, index) => {
    const normalized = String(header).trim().replace(/^"|"$/g, '');
    if (!normalized) throw new Error(`Malformed CSV: blank header at column ${index + 1}`);
    return normalized;
  });
  if (new Set(headers).size !== headers.length) throw new Error('Malformed CSV: duplicate headers');

  return rows.slice(1).map((values, rowIndex) => {
    const record = {};
    for (let i = 0; i < headers.length; i++) record[headers[i]] = values[i] ?? '';
    if (values.length > headers.length) {
      throw new Error(`Malformed CSV: row ${rowIndex + 2} has more cells than headers`);
    }
    return record;
  });
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : null;
}

function profitFactor(values) {
  const wins = sum(values.filter(value => value > 0));
  const losses = -sum(values.filter(value => value < 0));
  if (losses > 0) return wins / losses;
  if (wins > 0) return null; // Undefined/infinite PF is reported separately.
  return 0;
}

function financialStats(trades, pnlGetter) {
  const pnlValues = trades.map(pnlGetter).filter(Number.isFinite);
  const wins = pnlValues.filter(value => value > 0);
  const losses = pnlValues.filter(value => value < 0);
  const grossWins = sum(wins);
  const grossLosses = -sum(losses);
  return {
    trades: trades.length,
    trades_with_value: pnlValues.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: pnlValues.filter(value => value === 0).length,
    win_rate_pct: pnlValues.length ? wins.length / pnlValues.length * 100 : null,
    profit_factor: profitFactor(pnlValues),
    pf_has_no_losses: grossLosses === 0 && grossWins > 0,
    total: pnlValues.length ? sum(pnlValues) : null,
    average: pnlValues.length ? mean(pnlValues) : null,
    average_win: wins.length ? mean(wins) : null,
    average_loss: losses.length ? mean(losses) : null,
    gross_profit: grossWins,
    gross_loss: grossLosses
  };
}

function summarizeTrades(trades) {
  const matchedEntry = trades.filter(trade => trade.entryQuote !== null);
  const matchedExit = trades.filter(trade => trade.exitQuote !== null);
  const matchedBoth = trades.filter(trade => trade.entryQuote !== null && trade.exitQuote !== null);
  const commissionKnown = trades.filter(trade => trade.commission !== null);
  const swapKnown = trades.filter(trade => trade.swap !== null);
  const netKnown = trades.filter(trade => trade.netProfit !== null);

  return {
    trades: trades.length,
    gross: financialStats(trades, trade => trade.grossProfit),
    net_after_commission_swap: financialStats(netKnown, trade => trade.netProfit),
    commissions: {
      known_trades: commissionKnown.length,
      signed_total: commissionKnown.length ? sum(commissionKnown.map(trade => trade.commission)) : null
    },
    swaps: {
      known_trades: swapKnown.length,
      signed_total: swapKnown.length ? sum(swapKnown.map(trade => trade.swap)) : null
    },
    quote_matching: {
      entry_matched: matchedEntry.length,
      entry_coverage_pct: trades.length ? matchedEntry.length / trades.length * 100 : null,
      exit_matched: matchedExit.length,
      exit_coverage_pct: trades.length ? matchedExit.length / trades.length * 100 : null,
      both_matched: matchedBoth.length,
      both_coverage_pct: trades.length ? matchedBoth.length / trades.length * 100 : null
    },
    execution_prices: {
      mean_entry_spread_price: mean(matchedEntry.map(trade => trade.entrySpreadPrice).filter(Number.isFinite)),
      mean_exit_spread_price: mean(matchedExit.map(trade => trade.exitSpreadPrice).filter(Number.isFinite)),
      mean_entry_slippage_estimate_price: mean(matchedEntry.map(trade => trade.entrySlippagePrice).filter(Number.isFinite)),
      mean_exit_slippage_estimate_price: mean(matchedExit.map(trade => trade.exitSlippagePrice).filter(Number.isFinite)),
      mean_round_trip_slippage_estimate_price: mean(matchedBoth.map(trade =>
        trade.entrySlippagePrice + trade.exitSlippagePrice).filter(Number.isFinite)),
      entry_quote_match_delta_seconds_mean: mean(matchedEntry.map(trade => Math.abs(trade.entryQuoteDeltaSeconds))),
      exit_quote_match_delta_seconds_mean: mean(matchedExit.map(trade => Math.abs(trade.exitQuoteDeltaSeconds)))
    }
  };
}

function nearestQuote(quotes, timestamp, maxDistanceSeconds) {
  if (!Number.isFinite(timestamp) || quotes.length === 0) return null;
  let low = 0;
  let high = quotes.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (quotes[mid].serverTime < timestamp) low = mid + 1;
    else high = mid;
  }

  const candidates = [];
  if (low < quotes.length) {
    if (quotes[low].serverTime === timestamp) {
      let end = low + 1;
      while (end < quotes.length && quotes[end].serverTime === timestamp) end++;
      candidates.push(quotes[end - 1]);
    } else {
      candidates.push(quotes[low]);
    }
  }
  if (low > 0) candidates.push(quotes[low - 1]);

  candidates.sort((a, b) => {
    const da = Math.abs(a.serverTime - timestamp);
    const db = Math.abs(b.serverTime - timestamp);
    if (da !== db) return da - db;
    // On ties, prefer the observation before the order's second-level timestamp.
    return a.serverTime - b.serverTime;
  });

  const best = candidates[0];
  if (!best || Math.abs(best.serverTime - timestamp) > maxDistanceSeconds) return null;
  return { ...best, deltaSeconds: best.serverTime - timestamp };
}

function normalizeQuotes(rawQuotes) {
  const rejected = [];
  const quotes = [];
  rawQuotes.forEach((raw, rowIndex) => {
    const symbol = String(raw.symbol ?? '').trim();
    const serverTime = numberOrNull(raw.timestamp_server_epoch);
    const bid = numberOrNull(raw.bid);
    const ask = numberOrNull(raw.ask);
    const point = numberOrNull(raw.point);
    const sequence = numberOrNull(raw.tick_sequence) ?? rowIndex;

    if (!symbol || serverTime === null || bid === null || ask === null || point === null ||
        bid <= 0 || ask < bid || point <= 0) {
      rejected.push({ row: rowIndex + 2, symbol, reason: 'missing_or_invalid_quote_fields' });
      return;
    }
    quotes.push({
      symbol,
      serverTime,
      bid,
      ask,
      spreadPrice: ask - bid,
      point,
      digits: numberOrNull(raw.digits),
      sequence,
      sourceRow: rowIndex + 2
    });
  });

  quotes.sort((a, b) =>
    a.symbol.localeCompare(b.symbol) ||
    a.serverTime - b.serverTime ||
    a.sequence - b.sequence ||
    a.sourceRow - b.sourceRow
  );
  const bySymbol = new Map();
  for (const quote of quotes) {
    if (!bySymbol.has(quote.symbol)) bySymbol.set(quote.symbol, []);
    bySymbol.get(quote.symbol).push(quote);
  }
  return { quotes, bySymbol, rejected };
}

function normalizeOrders(rawOrders) {
  const rejected = [];
  const orders = [];
  rawOrders.forEach((raw, rowIndex) => {
    if (String(raw.record_type ?? '').trim() !== 'closed_trade') return;
    const ticket = String(raw.ticket ?? '').trim();
    const symbol = String(raw.symbol ?? '').trim();
    const side = String(raw.side ?? '').trim().toUpperCase();
    const openTime = numberOrNull(raw.open_time_server_epoch);
    const closeTime = numberOrNull(raw.close_time_server_epoch);
    const lots = numberOrNull(raw.lots);
    const openPrice = numberOrNull(raw.open_price);
    const closePrice = numberOrNull(raw.close_price);
    const grossProfit = numberOrNull(raw.profit_before_costs);
    const commission = numberOrNull(raw.commission);
    const swap = numberOrNull(raw.swap);
    const explicitNetProfit = numberOrNull(raw.net_profit);

    if (!ticket || !symbol || !['BUY', 'SELL'].includes(side) ||
        openTime === null || closeTime === null || closeTime < openTime ||
        lots === null || lots <= 0 || openPrice === null || closePrice === null ||
        grossProfit === null) {
      rejected.push({ row: rowIndex + 2, ticket, symbol, reason: 'missing_or_invalid_trade_fields' });
      return;
    }
    const netProfit = explicitNetProfit !== null
      ? explicitNetProfit
      : (commission !== null && swap !== null ? grossProfit + commission + swap : null);
    const stopLoss = numberOrNull(raw.stop_loss);
    const riskPrice = stopLoss !== null ? Math.abs(openPrice - stopLoss) : null;
    const directionAdjustedProfitPrice = side === 'BUY'
      ? closePrice - openPrice
      : openPrice - closePrice;

    orders.push({
      recordType: 'closed_trade',
      ticket,
      symbol,
      side,
      lots,
      openTimeServer: String(raw.open_time_server ?? ''),
      openTimeServerEpoch: openTime,
      closeTimeServer: String(raw.close_time_server ?? ''),
      closeTimeServerEpoch: closeTime,
      openPrice,
      closePrice,
      stopLoss,
      takeProfit: numberOrNull(raw.take_profit),
      grossProfit,
      commission,
      swap,
      netProfit,
      magicNumber: raw.magic_number ?? '',
      accountCurrency: raw.account_currency ?? '',
      comment: raw.comment ?? '',
      sourceRow: rowIndex + 2,
      priceBasedRealizedR: riskPrice > 0 ? directionAdjustedProfitPrice / riskPrice : null
    });
  });
  return { orders, rejected };
}

function reconcileTrade(trade, symbolQuotes, maxDistanceSeconds) {
  const entryQuote = symbolQuotes
    ? nearestQuote(symbolQuotes, trade.openTimeServerEpoch, maxDistanceSeconds)
    : null;
  const exitQuote = symbolQuotes
    ? nearestQuote(symbolQuotes, trade.closeTimeServerEpoch, maxDistanceSeconds)
    : null;

  const entryExecutablePrice = entryQuote
    ? (trade.side === 'BUY' ? entryQuote.ask : entryQuote.bid)
    : null;
  const exitExecutablePrice = exitQuote
    ? (trade.side === 'BUY' ? exitQuote.bid : exitQuote.ask)
    : null;

  // Positive estimates are adverse to the trader; negative estimates are favorable.
  // Quotes and OrderOpenTime/OrderCloseTime have only second-level timestamps.
  const entrySlippagePrice = entryExecutablePrice === null
    ? null
    : (trade.side === 'BUY'
        ? trade.openPrice - entryExecutablePrice
        : entryExecutablePrice - trade.openPrice);
  const exitSlippagePrice = exitExecutablePrice === null
    ? null
    : (trade.side === 'BUY'
        ? exitExecutablePrice - trade.closePrice
        : trade.closePrice - exitExecutablePrice);

  return {
    ...trade,
    entryQuote,
    exitQuote,
    entryExecutablePrice,
    exitExecutablePrice,
    entrySpreadPrice: entryQuote?.spreadPrice ?? null,
    exitSpreadPrice: exitQuote?.spreadPrice ?? null,
    entryQuoteDeltaSeconds: entryQuote?.deltaSeconds ?? null,
    exitQuoteDeltaSeconds: exitQuote?.deltaSeconds ?? null,
    entrySlippagePrice,
    exitSlippagePrice,
    entrySlippagePoints: entryQuote && entrySlippagePrice !== null
      ? entrySlippagePrice / entryQuote.point
      : null,
    exitSlippagePoints: exitQuote && exitSlippagePrice !== null
      ? exitSlippagePrice / exitQuote.point
      : null
  };
}

function plainExecution(row) {
  return {
    ticket: row.ticket,
    symbol: row.symbol,
    side: row.side,
    lots: row.lots,
    open_time_server: row.openTimeServer,
    open_time_server_epoch: row.openTimeServerEpoch,
    close_time_server: row.closeTimeServer,
    close_time_server_epoch: row.closeTimeServerEpoch,
    open_price: row.openPrice,
    close_price: row.closePrice,
    stop_loss: row.stopLoss,
    take_profit: row.takeProfit,
    profit_before_costs: row.grossProfit,
    commission: row.commission,
    swap: row.swap,
    net_profit_after_commission_swap: row.netProfit,
    account_currency: row.accountCurrency,
    price_based_realized_R_before_commission_swap: row.priceBasedRealizedR,
    entry_quote_matched: row.entryQuote !== null,
    entry_quote_server_time_epoch: row.entryQuote?.serverTime ?? null,
    entry_quote_match_delta_seconds: row.entryQuoteDeltaSeconds,
    entry_bid: row.entryQuote?.bid ?? null,
    entry_ask: row.entryQuote?.ask ?? null,
    entry_spread_price: row.entrySpreadPrice,
    entry_executable_quote_price: row.entryExecutablePrice,
    estimated_entry_slippage_price: row.entrySlippagePrice,
    estimated_entry_slippage_points: row.entrySlippagePoints,
    exit_quote_matched: row.exitQuote !== null,
    exit_quote_server_time_epoch: row.exitQuote?.serverTime ?? null,
    exit_quote_match_delta_seconds: row.exitQuoteDeltaSeconds,
    exit_bid: row.exitQuote?.bid ?? null,
    exit_ask: row.exitQuote?.ask ?? null,
    exit_spread_price: row.exitSpreadPrice,
    exit_executable_quote_price: row.exitExecutablePrice,
    estimated_exit_slippage_price: row.exitSlippagePrice,
    estimated_exit_slippage_points: row.exitSlippagePoints,
    magic_number: row.magicNumber,
    source_row: row.sourceRow
  };
}

function flattenSummary(symbol, side, trades) {
  const summary = summarizeTrades(trades);
  return {
    symbol,
    side,
    trade_count: summary.trades,
    gross_trade_count: summary.gross.trades_with_value,
    gross_net_profit: summary.gross.total,
    gross_profit_factor: summary.gross.profit_factor,
    net_known_trade_count: summary.net_after_commission_swap.trades_with_value,
    net_pnl_after_commission_swap: summary.net_after_commission_swap.total,
    net_profit_factor: summary.net_after_commission_swap.profit_factor,
    net_win_rate_pct: summary.net_after_commission_swap.win_rate_pct,
    commission_rows: summary.commissions.known_trades,
    commission_signed_total: summary.commissions.signed_total,
    swap_rows: summary.swaps.known_trades,
    swap_signed_total: summary.swaps.signed_total,
    entry_quote_coverage_pct: summary.quote_matching.entry_coverage_pct,
    exit_quote_coverage_pct: summary.quote_matching.exit_coverage_pct,
    both_quote_coverage_pct: summary.quote_matching.both_coverage_pct,
    mean_entry_spread_price: summary.execution_prices.mean_entry_spread_price,
    mean_exit_spread_price: summary.execution_prices.mean_exit_spread_price,
    mean_estimated_entry_slippage_price: summary.execution_prices.mean_entry_slippage_estimate_price,
    mean_estimated_exit_slippage_price: summary.execution_prices.mean_exit_slippage_estimate_price,
    mean_estimated_round_trip_slippage_price: summary.execution_prices.mean_round_trip_slippage_estimate_price
  };
}

export function analyzeData(rawQuotes, rawOrders, options = {}) {
  const maxDistanceSeconds = Math.max(0, Number(options.maxQuoteDistanceSeconds ?? 10));
  const normalizedQuotes = normalizeQuotes(rawQuotes);
  const normalizedOrders = normalizeOrders(rawOrders);
  const reconciled = normalizedOrders.orders.map(trade => {
    const quotes = normalizedQuotes.bySymbol.get(trade.symbol) ?? null;
    return reconcileTrade(trade, quotes, maxDistanceSeconds);
  });

  const bySymbolSide = [];
  const symbolSet = [...new Set(reconciled.map(trade => trade.symbol))].sort();
  for (const symbol of symbolSet) {
    for (const side of ['BUY', 'SELL']) {
      const trades = reconciled.filter(trade => trade.symbol === symbol && trade.side === side);
      if (trades.length) bySymbolSide.push(flattenSummary(symbol, side, trades));
    }
  }
  for (const side of ['BUY', 'SELL']) {
    const trades = reconciled.filter(trade => trade.side === side);
    if (trades.length) bySymbolSide.push(flattenSummary('ALL_SYMBOLS', side, trades));
  }

  const months = new Map();
  for (const trade of reconciled) {
    const date = trade.openTimeServer.slice(0, 7);
    const monthKey = date || 'UNKNOWN_SERVER_MONTH';
    const key = `${monthKey}|${trade.symbol}|${trade.side}`;
    if (!months.has(key)) months.set(key, { month_server_time: monthKey, symbol: trade.symbol, side: trade.side, trades: [] });
    months.get(key).trades.push(trade);
  }
  const byMonthSide = [...months.values()].map(group => ({
    month_server_time: group.month_server_time,
    symbol: group.symbol,
    side: group.side,
    ...flattenSummary(group.symbol, group.side, group.trades)
  })).sort((a, b) =>
    a.month_server_time.localeCompare(b.month_server_time) ||
    a.symbol.localeCompare(b.symbol) ||
    a.side.localeCompare(b.side)
  );

  const quoteTimes = normalizedQuotes.quotes.map(quote => quote.serverTime);
  const summary = summarizeTrades(reconciled);
  const missingCommissionCount = reconciled.filter(trade => trade.commission === null).length;
  const missingSwapCount = reconciled.filter(trade => trade.swap === null).length;
  const missingNetCount = reconciled.filter(trade => trade.netProfit === null).length;
  const quality = {
    order_rows_read: rawOrders.length,
    closed_trades_valid: reconciled.length,
    invalid_order_rows: normalizedOrders.rejected.length,
    quote_rows_read: rawQuotes.length,
    valid_quote_rows: normalizedQuotes.quotes.length,
    invalid_quote_rows: normalizedQuotes.rejected.length,
    quote_symbols: [...normalizedQuotes.bySymbol.keys()].sort(),
    orders_missing_commission: missingCommissionCount,
    orders_missing_swap: missingSwapCount,
    orders_missing_net_pnl: missingNetCount,
    no_quote_data: normalizedQuotes.quotes.length === 0,
    quote_period_server_epoch: quoteTimes.length
      ? { first: Math.min(...quoteTimes), last: Math.max(...quoteTimes) }
      : null,
    entry_quote_coverage_pct: summary.quote_matching.entry_coverage_pct,
    exit_quote_coverage_pct: summary.quote_matching.exit_coverage_pct,
    full_round_trip_quote_coverage_pct: summary.quote_matching.both_coverage_pct,
    note: 'MQL4 timestamps are broker-server time scalars for matching; do not interpret them as UTC. Fill deviations are estimates against the nearest saved executable quote, not exact slippage, because the recorder timestamps and closed-history timestamps have one-second granularity.'
  };

  const summaryRows = bySymbolSide;
  return {
    generated_at_utc: new Date().toISOString(),
    method: 'actual MT4 history PnL/commission/swap plus nearest observed bid/ask quote reconciliation',
    max_quote_match_distance_seconds: maxDistanceSeconds,
    data_quality: quality,
    overall: summary,
    by_symbol_side: summaryRows,
    by_server_month_side: byMonthSide,
    trades: reconciled,
    rejected_orders: normalizedOrders.rejected,
    rejected_quotes: normalizedQuotes.rejected
  };
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, headers) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map(header => csvCell(row[header])).join(','));
  return lines.join('\r\n') + '\r\n';
}

function fmt(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return Number(value).toFixed(4);
}

function reportMarkdown(report) {
  const quality = report.data_quality;
  const overall = report.overall;
  const net = overall.net_after_commission_swap;
  const lines = [
    '# Broker Bid/Ask and actual execution cost review',
    '',
    '## Result',
    '',
    'This report uses closed-order history values exported by MT4. Broker-reported profit, commission and swap are kept separate; net PnL includes commission and swap when available.',
    '',
    'Estimated slippage is the difference between the actual fill and the nearest recorded executable-side quote (BUY entry vs Ask, SELL entry vs Bid; BUY exit vs Bid, SELL exit vs Ask). It is a proxy, not exact order-send slippage: MQL4 timestamps here have one-second granularity and do not store the quote at the instant of OrderSend.',
    '',
    '## Data completeness',
    '',
    `- Valid closed trades: **${quality.closed_trades_valid}**`,
    `- Valid tick quotes: **${quality.valid_quote_rows}**`,
    `- Quote period (server-time scalar): ${quality.quote_period_server_epoch ? `${quality.quote_period_server_epoch.first} to ${quality.quote_period_server_epoch.last}` : 'not available'}`,
    `- Entry quote coverage: **${fmt(quality.entry_quote_coverage_pct)}%**`,
    `- Exit quote coverage: **${fmt(quality.exit_quote_coverage_pct)}%**`,
    `- Both entry and exit quote coverage: **${fmt(quality.full_round_trip_quote_coverage_pct)}%**`,
    `- Trades with missing commission: **${quality.orders_missing_commission}**`,
    `- Trades with missing swap: **${quality.orders_missing_swap}**`,
    `- Trades with unknown net PnL after fees: **${quality.orders_missing_net_pnl}**`,
    '',
    '## Overall actual-account history',
    '',
    `- Gross broker PnL (before commission/swap): **${fmt(overall.gross.total)}**`,
    `- Commission total (signed as reported): **${fmt(overall.commissions.signed_total)}**`,
    `- Swap total (signed as reported): **${fmt(overall.swaps.signed_total)}**`,
    `- Net PnL after commission/swap: **${fmt(net.total)}**`,
    `- Net profit factor: **${fmt(net.profit_factor)}**`,
    `- Net win rate: **${fmt(net.win_rate_pct)}%**`,
    '',
    '## By symbol and direction',
    '',
    '| Symbol | Side | Trades | Gross PnL | Net PnL | Net PF | Net win rate | Entry spread avg | Exit spread avg | Entry slip estimate avg | Exit slip estimate avg | Quote coverage both |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
  ];

  for (const row of report.by_symbol_side.filter(item => item.symbol !== 'ALL_SYMBOLS')) {
    lines.push('| ' + [
      row.symbol, row.side, row.trade_count, fmt(row.gross_net_profit),
      fmt(row.net_pnl_after_commission_swap), fmt(row.net_profit_factor),
      fmt(row.net_win_rate_pct), fmt(row.mean_entry_spread_price),
      fmt(row.mean_exit_spread_price), fmt(row.mean_estimated_entry_slippage_price),
      fmt(row.mean_estimated_exit_slippage_price), fmt(row.both_quote_coverage_pct)
    ].join(' | ') + ' |');
  }
  if (report.by_symbol_side.filter(item => item.symbol !== 'ALL_SYMBOLS').length === 0) {
    lines.push('| No closed trade rows | — | 0 | — | — | — | — | — | — | — | — | — |');
  }

  lines.push(
    '',
    '## Limitations',
    '',
    '- Quote recording starts when the recorder is installed. Older account-history trades may have actual fill/commission/swap values but no matching saved Bid/Ask quotes.',
    '- A broker-server timestamp is used only to join quotes to order-history timestamps. The exported scalar is not converted to UTC because broker timezone/DST rules vary.',
    '- A nearest-quote comparison is not a definitive slippage measurement. For exact slippage, the live execution EA must log Bid/Ask immediately before OrderSend and the returned fill price, with a higher-resolution timestamp.',
    '- This review measures the account execution history. It does not claim to be a five-year variable-spread strategy backtest unless broker tick Bid/Ask data covers that whole test window and is replayed by the strategy backtester.',
    '- Values are in the account currency for PnL/fees and in quote-price units for spreads/slippage; point counts are in the per-symbol MT4 Point unit.',
    '',
    '## Raw audit output',
    '',
    '- `executions_reconciled.csv`: one row per validated closed trade with actual prices, commission, swap and the matched quotes.',
    '- `summary_by_symbol_side.csv`: grouped actual performance and quote coverage.',
    '- `summary_by_server_month_side.csv`: grouped by server-time month and direction.',
    '- `execution_cost_summary.json`: full structured output and rejected-row diagnostics.',
    '',
    'No production settings or order-execution gates are changed by this analysis.'
  );
  return lines.join('\n') + '\n';
}

export async function runReview(options) {
  if (!options.ordersFile) throw new Error('Required: --orders <MT4 orders CSV>');
  if (!options.outDir) throw new Error('Required: --outdir <directory>');

  const orderText = await fs.readFile(options.ordersFile, 'utf8');
  const rawOrders = parseCsv(orderText);
  let quoteFiles = [];
  if (options.quoteFiles?.length) {
    quoteFiles = options.quoteFiles;
  } else if (options.quotesDir) {
    const entries = await fs.readdir(options.quotesDir, { withFileTypes: true });
    quoteFiles = entries
      .filter(entry => entry.isFile() && /_quotes_.*\.csv$/i.test(entry.name))
      .map(entry => path.join(options.quotesDir, entry.name))
      .sort();
  }

  const rawQuotes = [];
  const quoteFileNames = [];
  for (const file of quoteFiles) {
    const rows = parseCsv(await fs.readFile(file, 'utf8'));
    rawQuotes.push(...rows);
    quoteFileNames.push(path.basename(file));
  }

  const report = analyzeData(rawQuotes, rawOrders, {
    maxQuoteDistanceSeconds: options.maxQuoteDistanceSeconds
  });
  report.input_files = {
    orders: path.basename(options.ordersFile),
    quotes: quoteFileNames
  };
  await fs.mkdir(options.outDir, { recursive: true });

  const tradeRows = report.trades.map(plainExecution);
  const tradeHeaders = tradeRows.length
    ? Object.keys(tradeRows[0])
    : [
        'ticket','symbol','side','lots','open_time_server','open_time_server_epoch',
        'close_time_server','close_time_server_epoch','open_price','close_price',
        'stop_loss','take_profit','profit_before_costs','commission','swap',
        'net_profit_after_commission_swap','account_currency',
        'price_based_realized_R_before_commission_swap','entry_quote_matched',
        'entry_quote_server_time_epoch','entry_quote_match_delta_seconds','entry_bid',
        'entry_ask','entry_spread_price','entry_executable_quote_price',
        'estimated_entry_slippage_price','estimated_entry_slippage_points',
        'exit_quote_matched','exit_quote_server_time_epoch','exit_quote_match_delta_seconds',
        'exit_bid','exit_ask','exit_spread_price','exit_executable_quote_price',
        'estimated_exit_slippage_price','estimated_exit_slippage_points',
        'magic_number','source_row'
      ];
  await fs.writeFile(path.join(options.outDir, 'executions_reconciled.csv'),
    toCsv(tradeRows, tradeHeaders), 'utf8');

  const groupedHeaders = [
    'symbol','side','trade_count','gross_trade_count','gross_net_profit','gross_profit_factor',
    'net_known_trade_count','net_pnl_after_commission_swap','net_profit_factor','net_win_rate_pct',
    'commission_rows','commission_signed_total','swap_rows','swap_signed_total',
    'entry_quote_coverage_pct','exit_quote_coverage_pct','both_quote_coverage_pct',
    'mean_entry_spread_price','mean_exit_spread_price',
    'mean_estimated_entry_slippage_price','mean_estimated_exit_slippage_price',
    'mean_estimated_round_trip_slippage_price'
  ];
  const symbols = report.by_symbol_side.filter(item => item.symbol !== 'ALL_SYMBOLS');
  await fs.writeFile(path.join(options.outDir, 'summary_by_symbol_side.csv'),
    toCsv(symbols, groupedHeaders), 'utf8');
  const monthlyHeaders = ['month_server_time', ...groupedHeaders];
  await fs.writeFile(path.join(options.outDir, 'summary_by_server_month_side.csv'),
    toCsv(report.by_server_month_side, monthlyHeaders), 'utf8');

  await fs.writeFile(path.join(options.outDir, 'execution_cost_summary.json'),
    JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(options.outDir, 'execution_cost_summary.md'), reportMarkdown(report), 'utf8');
  return report;
}

function parseArgs(argv) {
  const out = { quoteFiles: [], maxQuoteDistanceSeconds: 10 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--orders') { out.ordersFile = next; i++; }
    else if (arg === '--quotes-dir') { out.quotesDir = next; i++; }
    else if (arg === '--quotes') { out.quoteFiles.push(...String(next ?? '').split(',').map(value => value.trim()).filter(Boolean)); i++; }
    else if (arg === '--outdir') { out.outDir = next; i++; }
    else if (arg === '--max-quote-distance-sec') { out.maxQuoteDistanceSeconds = Number(next); i++; }
    else if (arg === '--help' || arg === '-h') { out.help = true; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/review-gold-broker-execution.mjs --orders <orders.csv> --quotes-dir <MT4 Files directory> --outdir <report directory> [--max-quote-distance-sec 10]');
    process.exit(0);
  }
  const report = await runReview(options);
  console.log(JSON.stringify({
    output_dir: options.outDir,
    closed_trades: report.data_quality.closed_trades_valid,
    valid_quotes: report.data_quality.valid_quote_rows,
    entry_quote_coverage_pct: report.data_quality.entry_quote_coverage_pct,
    exit_quote_coverage_pct: report.data_quality.exit_quote_coverage_pct,
    net_pnl_after_commission_swap: report.overall.net_after_commission_swap.total,
    net_profit_factor: report.overall.net_after_commission_swap.profit_factor
  }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
