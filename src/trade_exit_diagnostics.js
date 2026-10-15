const NUMERIC_FIELDS = [
  'range_atr',
  'breakout_atr',
  'body_atr',
  'close_location',
  'volume_ratio',
  'extension_atr',
  'entry_gap_atr',
  'mfe_r',
  'mae_r',
  'net_r',
  'holding_minutes',
  'holding_bars'
];

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function valueR(trade) {
  return finiteOrNull(trade?.net_r ?? trade?.result_r ?? trade?.r_multiple);
}

function holdingBars(trade) {
  const explicit = finiteOrNull(trade?.holding_bars ?? trade?.hold_bars);
  if (explicit !== null && explicit >= 0) return explicit;
  const index = finiteOrNull(trade?.exit_bar_index);
  return index !== null && index >= 0 ? index + 1 : null;
}

export function classifyTradeExit(trade = {}) {
  const reason = String(trade?.exit_reason ?? '').trim().toUpperCase();
  const r = valueR(trade);
  const bars = holdingBars(trade);
  const entryBar = trade?.entry_bar_exit === true || (bars !== null && bars <= 1);

  if (['STOP', 'STOP_LOSS', 'SL', 'SL_FIRST_ASSUMPTION',
       'STOP_AND_TARGET_SAME_BAR_CONSERVATIVE'].includes(reason)) {
    return entryBar ? 'ENTRY_BAR_STOP_LOSS' : 'LATER_STOP_LOSS';
  }

  if (['TIME', 'MAXIMUM_HOLD_TIME', 'TIME_EXIT', 'TIME_LIMIT'].includes(reason)) {
    if (r === null) return 'TIME_EXIT_RESULT_UNKNOWN';
    if (r < 0) return 'TIME_EXIT_LOSS';
    if (r > 0) return 'TIME_EXIT_WIN';
    return 'TIME_EXIT_BREAKEVEN';
  }

  if (['TARGET', 'TAKE_PROFIT'].includes(reason)) return 'TARGET_EXIT';
  if (reason.includes('DATA_GAP')) return 'DATA_GAP_EXIT';
  if (reason.startsWith('SAFETY_') || reason.includes('FORCE_CLOSE')) return 'SAFETY_EXIT';
  return 'OTHER_EXIT';
}

function summarizeMetric(rows, field) {
  const values = rows.map(row => finiteOrNull(row?.[field])).filter(value => value !== null);
  return {
    n: values.length,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  };
}

function summarizeGroup(rows, total) {
  const rs = rows.map(valueR).filter(value => value !== null);
  const losses = rs.filter(value => value < 0);
  const wins = rs.filter(value => value > 0);
  const result = {
    trades: rows.length,
    share_pct: total ? rows.length / total * 100 : 0,
    wins: wins.length,
    losses: losses.length,
    breakeven_or_unknown: rows.length - wins.length - losses.length,
    loss_rate_pct: rows.length ? losses.length / rows.length * 100 : 0,
    total_r: rs.reduce((sum, value) => sum + value, 0),
    average_r: rs.length ? rs.reduce((sum, value) => sum + value, 0) / rs.length : null,
    average_loss_r: losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : null,
    average_holding_minutes: summarizeMetric(rows, 'holding_minutes'),
    average_holding_bars: summarizeMetric(rows, 'holding_bars'),
    average_mfe_r: summarizeMetric(rows, 'mfe_r'),
    average_mae_r: summarizeMetric(rows, 'mae_r'),
    feature_means: Object.fromEntries(
      ['range_atr', 'breakout_atr', 'body_atr', 'close_location', 'volume_ratio', 'extension_atr', 'entry_gap_atr']
        .map(field => [field, summarizeMetric(rows, field)])
    ),
    by_side: {},
    by_utc_hour: {}
  };

  for (const side of ['BUY', 'SELL', 'UNKNOWN']) {
    const sideRows = rows.filter(row => {
      const value = String(row?.side ?? row?.direction ?? '').toUpperCase();
      return side === 'UNKNOWN' ? !['BUY', 'SELL'].includes(value) : value === side;
    });
    if (sideRows.length) {
      const sideRs = sideRows.map(valueR).filter(value => value !== null);
      result.by_side[side] = {
        trades: sideRows.length,
        losses: sideRs.filter(value => value < 0).length,
        total_r: sideRs.reduce((sum, value) => sum + value, 0),
        average_r: sideRs.length ? sideRs.reduce((sum, value) => sum + value, 0) / sideRs.length : null
      };
    }
  }

  for (const row of rows) {
    const hour = finiteOrNull(row?.hour_utc);
    const key = hour !== null && hour >= 0 && hour <= 23 ? String(Math.floor(hour)).padStart(2, '0') : 'unknown';
    if (!result.by_utc_hour[key]) result.by_utc_hour[key] = { trades: 0, losses: 0, total_r: 0, r_count: 0 };
    const item = result.by_utc_hour[key];
    item.trades += 1;
    const r = valueR(row);
    if (r !== null) {
      item.r_count += 1;
      item.total_r += r;
      if (r < 0) item.losses += 1;
    }
  }
  for (const item of Object.values(result.by_utc_hour)) {
    item.average_r = item.r_count ? item.total_r / item.r_count : null;
    delete item.r_count;
  }

  return result;
}

/**
 * Classify outcomes without changing trade decisions or execution.
 * MAE/MFE are only OHLC-bar approximations when the exact intrabar path is unavailable.
 */
export function summarizeExitMechanisms(trades = []) {
  const rows = (Array.isArray(trades) ? trades : []).map(trade => ({
    ...trade,
    exit_class: trade?.exit_class || classifyTradeExit(trade)
  }));
  const classes = [
    'ENTRY_BAR_STOP_LOSS',
    'LATER_STOP_LOSS',
    'TIME_EXIT_LOSS',
    'TIME_EXIT_WIN',
    'TIME_EXIT_BREAKEVEN',
    'TIME_EXIT_RESULT_UNKNOWN',
    'TARGET_EXIT',
    'DATA_GAP_EXIT',
    'SAFETY_EXIT',
    'OTHER_EXIT'
  ];
  const counts = Object.fromEntries(classes.map(key => [key, rows.filter(row => row.exit_class === key).length]));
  const lossCount = rows.filter(row => {
    const value = valueR(row);
    return value !== null && value < 0;
  }).length;

  return {
    sample_size: rows.length,
    loss_trades: lossCount,
    classification_counts: counts,
    categories: Object.fromEntries(classes.map(key => [
      key,
      summarizeGroup(rows.filter(row => row.exit_class === key), rows.length)
    ])),
    entry_bar_stop_vs_time_exit_loss: {
      entry_bar_stop: summarizeGroup(rows.filter(row => row.exit_class === 'ENTRY_BAR_STOP_LOSS'), rows.length),
      time_exit_loss: summarizeGroup(rows.filter(row => row.exit_class === 'TIME_EXIT_LOSS'), rows.length)
    },
    notes: [
      'ENTRY_BAR_STOP_LOSS means the stop was touched in the first candle used by the OHLC backtest; it is not an exact intrabar timestamp.',
      'TIME_EXIT_LOSS means the trade reached the configured maximum holding window without a prior stop/target exit and ended with negative modeled R.',
      'MFE/MAE are OHLC-bar approximations; candle data cannot establish the sequence of the high and low inside one candle.'
    ]
  };
}
