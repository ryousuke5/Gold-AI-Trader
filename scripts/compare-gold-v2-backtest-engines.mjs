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
    effective_rr: {
      reference: effectiveRr(reference),
      resumable: effectiveRr(resumable)
    }
  };
}

const referenceTrades = parseCsv(await fs.readFile(referenceCsv, 'utf8'));
const resumableTrades = JSON.parse(await fs.readFile(resumableJson, 'utf8'));
if (!Array.isArray(resumableTrades)) throw new Error('Resumable trade output must be an array');

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
    below_resumable_rr_floor_1_5: rr !== null && rr < 1.5
  };
});
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
    'The reference engine does not currently enforce the resumable engine’s minimum effective-RR floor, so trade-count differences can be expected and are surfaced rather than treated as parity.',
    'Shared trade identities should also match side, entry/SL/TP, exit time/reason, and net R before the engines are treated as reconciled.',
    'This output is research diagnostics only; it does not alter strategy parameters or real execution.'
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
  reference_only_below_rr_floor: referenceOnlyDetails.filter(row => row.below_resumable_rr_floor_1_5).length,
  output: comparisonPath
}));
