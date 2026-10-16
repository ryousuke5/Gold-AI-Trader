import fs from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve(process.env.GOLD_BACKTEST_OUTPUT_DIR || 'gold-backtest-output');
const referenceCsv = path.resolve(
  process.env.GOLD_REFERENCE_TRADES_CSV || path.join(outputDir, 'reference-engine/gold_v2_trades_baseline.csv')
);
const resumableJson = path.resolve(
  process.env.GOLD_RESUMABLE_TRADES_JSON || path.join(outputDir, 'gold_v2_resumed_trades.json')
);
const comparisonPath = path.join(outputDir, 'gold_v2_engine_comparison.json');
const referenceReportPath = path.join(outputDir, 'reference-engine/gold_v2_backtest_report.json');
const resumableDiagnosticsPath = path.join(outputDir, 'gold_v2_funnel_diagnostics.json');

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).filter(Boolean).map((line, index) => {
    const values = line.split(',');
    if (values.length !== headers.length) {
      throw new Error('CSV field count mismatch at data row ' + (index + 1));
    }
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function key(trade) {
  return String(trade.signal_time) + ':' + String(trade.entry_time);
}

function effectiveRr(trade) {
  const entry = asNumber(trade.entry);
  const stop = asNumber(trade.stop_loss);
  const target = asNumber(trade.take_profit);
  const risk = entry === null || stop === null ? null : Math.abs(entry - stop);
  if (risk === null || risk <= 0 || target === null) return null;
  return Math.abs(target - entry) / risk;
}

function compareMatched(reference, resumable) {
  const priceFields = ['entry', 'stop_loss', 'take_profit'];
  const prices = Object.fromEntries(priceFields.map(field => {
    const left = asNumber(reference[field]);
    const right = asNumber(resumable[field]);
    return [field, {
      reference: left,
      resumable: right,
      absolute_difference: left === null || right === null ? null : Math.abs(left - right)
    }];
  }));
  const refR = asNumber(reference.net_r);
  const resR = asNumber(resumable.net_r);
  return {
    key: key(reference),
    side_match: String(reference.side) === String(resumable.side),
    setup_type_match: String(reference.setup_type) === String(resumable.setup_type),
    prices,
    exit_reason: { reference: reference.exit_reason, resumable: resumable.exit_reason },
    exit_time: {
      reference: asNumber(reference.exit_time),
      resumable: asNumber(resumable.exit_time)
    },
    net_r: {
      reference: refR,
      resumable: resR,
      absolute_difference: refR === null || resR === null ? null : Math.abs(refR - resR)
    },
    net_pnl: {
      reference: asNumber(reference.net_pnl),
      resumable: asNumber(resumable.net_pnl),
      absolute_difference: asNumber(reference.net_pnl) === null || asNumber(resumable.net_pnl) === null
        ? null
        : Math.abs(asNumber(reference.net_pnl) - asNumber(resumable.net_pnl))
    },
    entry_gap_atr: {
      reference: asNumber(reference.entry_gap_atr),
      resumable: asNumber(resumable.entry_gap_atr),
      absolute_difference: asNumber(reference.entry_gap_atr) === null || asNumber(resumable.entry_gap_atr) === null
        ? null
        : Math.abs(asNumber(reference.entry_gap_atr) - asNumber(resumable.entry_gap_atr))
    },
    effective_rr: {
      reference: effectiveRr(reference),
      resumable: effectiveRr(resumable)
    }
  };
}

const referenceTrades = parseCsv(await fs.readFile(referenceCsv, 'utf8'));
const resumableTrades = JSON.parse(await fs.readFile(resumableJson, 'utf8'));
if (!Array.isArray(resumableTrades)) throw new Error('Resumable trade output must be an array');
const minimumEffectiveRR = Number(process.env.GOLD_BACKTEST_MIN_EFFECTIVE_RR || 1.50);
if (!Number.isFinite(minimumEffectiveRR) || minimumEffectiveRR < 0) throw new Error('Invalid minimum effective RR');
const belowFloorReference = referenceTrades.filter(trade => {
  const rr = effectiveRr(trade);
  return rr === null || rr + 1e-12 < minimumEffectiveRR;
});
const belowFloorResumable = resumableTrades.filter(trade => {
  const rr = effectiveRr(trade);
  return rr === null || rr + 1e-12 < minimumEffectiveRR;
});

const referenceByKey = new Map(referenceTrades.map(trade => [key(trade), trade]));
const resumableByKey = new Map(resumableTrades.map(trade => [key(trade), trade]));
const sharedKeys = [...referenceByKey.keys()].filter(k => resumableByKey.has(k)).sort();
const referenceOnly = [...referenceByKey.keys()].filter(k => !resumableByKey.has(k)).sort();
const resumableOnly = [...resumableByKey.keys()].filter(k => !referenceByKey.has(k)).sort();

const matchedOutcomes = sharedKeys.map(k => compareMatched(referenceByKey.get(k), resumableByKey.get(k)));
const mismatched = matchedOutcomes.filter(row =>
  !row.side_match
  || !row.setup_type_match
  || row.exit_reason.reference !== row.exit_reason.resumable
  || row.exit_time.reference !== row.exit_time.resumable
  || row.net_r.absolute_difference === null
  || row.net_r.absolute_difference > 1e-9
  || row.net_pnl.absolute_difference === null
  || row.net_pnl.absolute_difference > 1e-7
  || row.entry_gap_atr.absolute_difference === null
  || row.entry_gap_atr.absolute_difference > 1e-9
  || Object.values(row.prices).some(v =>
    v.absolute_difference === null || v.absolute_difference > 1e-9
  )
);

const referenceOnlyDetails = referenceOnly.map(k => {
  const trade = referenceByKey.get(k);
  const rr = effectiveRr(trade);
  return {
    key: k,
    side: trade.side,
    exit_reason: trade.exit_reason,
    net_r: asNumber(trade.net_r),
    effective_rr: rr,
    below_effective_rr_floor_1_5: rr !== null && rr < 1.5
  };
});
const referenceReport = JSON.parse(await fs.readFile(referenceReportPath, 'utf8'));
const resumableFunnel = JSON.parse(await fs.readFile(resumableDiagnosticsPath, 'utf8'));
const referenceFunnel = referenceReport.results?.baseline?.funnel_diagnostics;
if (!referenceFunnel || !resumableFunnel) throw new Error('Missing funnel diagnostics from one or both backtest engines');

const funnelFields = [
  'bars_scanned',
  'bars_skipped_while_in_trade',
  'invalid_m5_feature_bars',
  'invalid_h1_feature_bars',
  'signals_evaluated',
  'candidates',
  'candidates_buy',
  'candidates_sell',
  'candidates_other',
  'risk_gate_checks',
  'risk_gate_blocked_candidates',
  'risk_gate_passed',
  'rejected_next_bar_gap',
  'trade_attempts',
  'rejected_invalid_geometry',
  'rejected_entry_gap',
  'rejected_effective_rr',
  'trades_accepted'
];
const funnelMismatches = [];
for (const field of funnelFields) {
  const referenceValue = Number(referenceFunnel[field]);
  const resumableValue = Number(resumableFunnel[field]);
  if (!Number.isFinite(referenceValue) || !Number.isFinite(resumableValue) || referenceValue !== resumableValue) {
    funnelMismatches.push({ field, reference: referenceFunnel[field], resumable: resumableFunnel[field] });
  }
}
function canonicalObject(value) {
  return JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b))));
}
for (const field of ['setup_wait_reasons', 'risk_gate_blocks']) {
  if (canonicalObject(referenceFunnel[field]) !== canonicalObject(resumableFunnel[field])) {
    funnelMismatches.push({ field, reference: referenceFunnel[field], resumable: resumableFunnel[field] });
  }
}
const result = {
  generated_at: new Date().toISOString(),
  data_source: 'same prepared XAUUSD M5 dataset and default risk/cost/strategy parameters; no strategy or execution settings are modified by this comparison step',
  engines: {
    reference: {
      name: 'backtest-gold-v2.mjs',
      trades: referenceTrades.length,
      csv: path.relative(process.cwd(), referenceCsv)
    },
    resumable: {
      name: 'backtest-gold-v2-resumable.mjs',
      trades: resumableTrades.length,
      json: path.relative(process.cwd(), resumableJson)
    }
  },
  trade_identity: 'signal_time + entry_time',
  unified_minimum_effective_rr: minimumEffectiveRR,
  effective_rr_floor_violations: {
    reference: belowFloorReference.length,
    resumable: belowFloorResumable.length
  },
  h1_aggregation_timezone: process.env.GOLD_BACKTEST_SERVER_TIMEZONE || 'Europe/Nicosia',
  funnel_diagnostics: {
    fields_compared: funnelFields.length + 2,
    mismatch_count: funnelMismatches.length,
    mismatches: funnelMismatches
  },
  counts: {
    matched: sharedKeys.length,
    reference_only: referenceOnly.length,
    resumable_only: resumableOnly.length,
    matched_outcomes_with_differences: mismatched.length
  },
  reference_only_trades: referenceOnlyDetails,
  resumable_only_keys: resumableOnly,
  matched_trade_comparisons: matchedOutcomes,
  interpretation: [
    'Both engines must use the same effective-RR floor, entry-gap calculation, H1 aggregation timezone, risk/cost settings, and data before parity is accepted.',
    'Shared trade identities are compared on side, setup type, entry/SL/TP, exit time/reason, net R, net PnL, and entry gap.',
    'Funnel counters and setup wait-reason distributions are compared independently of trade identities.',
    'This output is research diagnostics only; it does not alter live execution or the strategy thresholds.'
  ]
};

await fs.writeFile(comparisonPath, JSON.stringify(result, null, 2));
console.log('GOLD V2 ENGINE COMPARISON', JSON.stringify({
  reference_trades: referenceTrades.length,
  resumable_trades: resumableTrades.length,
  matched: sharedKeys.length,
  reference_only: referenceOnly.length,
  resumable_only: resumableOnly.length,
  matched_outcomes_with_differences: mismatched.length,
  funnel_mismatches: funnelMismatches.length,
  effective_rr_floor_violations: {
    reference: belowFloorReference.length,
    resumable: belowFloorResumable.length
  },
  reference_only_below_rr_floor: referenceOnlyDetails.filter(row => row.below_effective_rr_floor_1_5).length,
  output: comparisonPath
}));

if (process.env.GOLD_REQUIRE_ENGINE_PARITY === 'true') {
  const failed = referenceOnly.length > 0 || resumableOnly.length > 0 || mismatched.length > 0
    || funnelMismatches.length > 0 || belowFloorReference.length > 0 || belowFloorResumable.length > 0;
  if (failed) {
    throw new Error('GOLD engines are not yet at parity; inspect ' + comparisonPath);
  }
  console.log('GOLD V2 ENGINE PARITY PASS');
}
