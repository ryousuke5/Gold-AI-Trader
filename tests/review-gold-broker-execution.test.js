import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeData, parseCsv } from '../scripts/review-gold-broker-execution.mjs';

test('parseCsv handles BOM, quoted commas, escaped quotes, and CRLF', () => {
  const parsed = parseCsv('\uFEFFname,comment,value\r\nBUY,"has, comma",1\r\nSELL,"said ""hello""",2\r\n');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].comment, 'has, comma');
  assert.equal(parsed[1].comment, 'said "hello"');
  assert.equal(parsed[1].value, '2');
});

test('parseCsv rejects unterminated quoted fields', () => {
  assert.throws(() => parseCsv('symbol,comment\nGOLD,"not closed'), /unterminated quoted field/);
});

test('analyzeData reconciles actual order prices, Bid/Ask, commission, swap, and direction', () => {
  const quotes = [
    { timestamp_server_epoch: '100', symbol: 'XAUUSD', bid: '100.00', ask: '100.20', point: '0.01', digits: '2', tick_sequence: '1' },
    { timestamp_server_epoch: '200', symbol: 'XAUUSD', bid: '100.10', ask: '100.30', point: '0.01', digits: '2', tick_sequence: '2' }
  ];
  const orders = [
    {
      record_type: 'closed_trade', ticket: '101', symbol: 'XAUUSD', side: 'BUY', lots: '0.1',
      open_time_server: '1970.01.01 00:01:40', open_time_server_epoch: '100',
      close_time_server: '1970.01.01 00:03:20', close_time_server_epoch: '200',
      open_price: '100.25', close_price: '100.10', stop_loss: '99.00', take_profit: '102.00',
      profit_before_costs: '5.00', commission: '-1.00', swap: '-0.50', net_profit: '3.50',
      magic_number: '5', account_currency: 'USD', comment: 'comma, and "quotes"'
    },
    {
      record_type: 'closed_trade', ticket: '102', symbol: 'XAUUSD', side: 'SELL', lots: '0.1',
      open_time_server: '1970.01.01 00:01:40', open_time_server_epoch: '100',
      close_time_server: '1970.01.01 00:03:20', close_time_server_epoch: '200',
      open_price: '99.99', close_price: '100.31', stop_loss: '101.00', take_profit: '98.00',
      profit_before_costs: '-2.00', commission: '-1.00', swap: '0.00', net_profit: '-3.00',
      magic_number: '5', account_currency: 'USD', comment: 'second trade'
    }
  ];

  const report = analyzeData(quotes, orders, { maxQuoteDistanceSeconds: 2 });
  assert.equal(report.data_quality.valid_quote_rows, 2);
  assert.equal(report.data_quality.closed_trades_valid, 2);
  assert.equal(report.data_quality.full_round_trip_quote_coverage_pct, 100);
  assert.equal(report.quote_spread_summary_by_symbol[0].quote_count, 2);
  assert.ok(Math.abs(report.quote_spread_summary_by_symbol[0].mean_spread_price - 0.2) < 1e-9);
  assert.ok(Math.abs(report.quote_spread_summary_by_symbol[0].p90_spread_points - 20) < 1e-9);
  assert.equal(report.overall.gross.total, 3);
  assert.equal(report.overall.commissions.signed_total, -2);
  assert.equal(report.overall.swaps.signed_total, -0.5);
  assert.equal(report.overall.net_after_commission_swap.total, 0.5);
  assert.equal(report.overall.net_after_commission_swap.wins, 1);
  assert.equal(report.overall.net_after_commission_swap.losses, 1);

  const buy = report.trades.find(trade => trade.side === 'BUY');
  const sell = report.trades.find(trade => trade.side === 'SELL');
  assert.ok(Math.abs(buy.entrySpreadPrice - 0.2) < 1e-9);
  assert.ok(Math.abs(buy.exitSpreadPrice - 0.2) < 1e-9);
  assert.ok(Math.abs(buy.entrySlippagePrice - 0.05) < 1e-9);
  assert.ok(Math.abs(buy.exitSlippagePrice - 0.0) < 1e-9);
  assert.ok(Math.abs(sell.entrySlippagePrice - 0.01) < 1e-9);
  assert.ok(Math.abs(sell.exitSlippagePrice - 0.01) < 1e-9);
  assert.equal(buy.netProfit, 3.5);
  assert.equal(sell.netProfit, -3);
  assert.equal(report.by_symbol_side.find(row => row.symbol === 'XAUUSD' && row.side === 'BUY').trade_count, 1);
});

test('trade PnL and recorded commissions remain usable when historical quote data is unavailable', () => {
  const orders = [{
    record_type: 'closed_trade', ticket: '301', symbol: 'GOLD', side: 'SELL', lots: '0.1',
    open_time_server: '2026.01.01 10:00:00', open_time_server_epoch: '1767261600',
    close_time_server: '2026.01.01 10:05:00', close_time_server_epoch: '1767261900',
    open_price: '4500.00', close_price: '4501.00', stop_loss: '4502.00', take_profit: '4496.00',
    profit_before_costs: '-10', commission: '-0.7', swap: '-0.2', net_profit: '-10.9',
    magic_number: '10', account_currency: 'USD', comment: ''
  }];
  const report = analyzeData([], orders);
  assert.equal(report.data_quality.no_quote_data, true);
  assert.equal(report.data_quality.entry_quote_coverage_pct, 0);
  assert.equal(report.overall.net_after_commission_swap.total, -10.9);
  assert.equal(report.trades[0].entrySlippagePrice, null);
  assert.equal(report.data_quality.orders_missing_net_pnl, 0);
});

test('rows with malformed quotes or orders are quarantined rather than silently included', () => {
  const quotes = [
    { timestamp_server_epoch: '100', symbol: 'GOLD', bid: '10', ask: '9', point: '0.01' },
    { timestamp_server_epoch: '101', symbol: 'GOLD', bid: '10', ask: '10.2', point: '0.01' }
  ];
  const orders = [
    { record_type: 'closed_trade', ticket: '1', symbol: 'GOLD', side: 'HOLD', lots: '1', open_time_server_epoch: '100', close_time_server_epoch: '101', open_price: '10', close_price: '10', profit_before_costs: '0' }
  ];
  const report = analyzeData(quotes, orders);
  assert.equal(report.data_quality.valid_quote_rows, 1);
  assert.equal(report.data_quality.invalid_quote_rows, 1);
  assert.equal(report.data_quality.closed_trades_valid, 0);
  assert.equal(report.data_quality.invalid_order_rows, 1);
});
