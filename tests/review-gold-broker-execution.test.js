import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeData, parseCsv, runReview } from '../scripts/review-gold-broker-execution.mjs';

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


test('runReview writes the complete audit bundle and observed spread statistics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gold-broker-review-'));
  try {
    const quotesDir = path.join(root, 'quotes');
    const outDir = path.join(root, 'out');
    await fs.mkdir(quotesDir, { recursive: true });
    await fs.writeFile(path.join(quotesDir, 'gold_broker_quotes_GOLD_20260101.csv'), [
      'timestamp_server,timestamp_server_epoch,timestamp_utc_estimate,server_utc_offset_seconds,symbol,bid,ask,spread_price,spread_points,point,digits,tick_sequence',
      '2026.01.01 10:00:00,1767261600,2026.01.01 07:00:00,10800,GOLD,4500.00,4500.20,0.20,20,0.01,2,1',
      '2026.01.01 10:05:00,1767261900,2026.01.01 07:05:00,10800,GOLD,4501.00,4501.25,0.25,25,0.01,2,2',
      ''
    ].join('\n'), 'utf8');

    const ordersFile = path.join(root, 'gold_broker_orders_GOLD.csv');
    await fs.writeFile(ordersFile, [
      'record_type,ticket,symbol,side,lots,open_time_server,open_time_server_epoch,close_time_server,close_time_server_epoch,open_price,close_price,stop_loss,take_profit,profit_before_costs,commission,swap,net_profit,magic_number,account_currency,comment',
      'closed_trade,501,GOLD,BUY,0.10,2026.01.01 10:00:00,1767261600,2026.01.01 10:05:00,1767261900,4500.25,4501.00,4499.00,4503.00,7.50,-0.70,-0.20,6.60,1,USD,fixture',
      ''
    ].join('\n'), 'utf8');

    const report = await runReview({
      ordersFile,
      quotesDir,
      outDir,
      maxQuoteDistanceSeconds: 2
    });
    assert.equal(report.data_quality.closed_trades_valid, 1);
    assert.equal(report.quote_spread_summary_by_symbol[0].quote_count, 2);
    for (const filename of [
      'executions_reconciled.csv',
      'summary_by_symbol_side.csv',
      'summary_by_server_month_side.csv',
      'quote_spread_summary_by_symbol.csv',
      'execution_cost_summary.json',
      'execution_cost_summary.md'
    ]) {
      const stat = await fs.stat(path.join(outDir, filename));
      assert.ok(stat.size > 0, filename + ' was not written');
    }
    const markdown = await fs.readFile(path.join(outDir, 'execution_cost_summary.md'), 'utf8');
    assert.match(markdown, /Observed spread distribution/);
    assert.match(markdown, /6\.6000/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
