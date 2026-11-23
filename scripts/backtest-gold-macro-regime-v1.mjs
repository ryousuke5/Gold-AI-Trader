import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  aggregateGoldDailyBars, buildGoldMacroSignal, parseFredCsv,
  simulateGoldMacroDailyTrade
} from "../src/gold_macro_regime_v1.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.resolve(process.env.GOLD_BACKTEST_DATA_FILE || path.join(ROOT, "gold-xauusd-data", "xauusd-m5.json.gz"));
const OUTPUT_DIR = path.resolve(process.env.GOLD_MACRO_OUTPUT_DIR || path.join(ROOT, "gold-macro-regime-v1-output"));
const PERIODS = {
  is: { start: "2021-10-06", endExclusive: "2024-10-05" },
  oos: { start: "2024-10-05", endExclusive: "2026-10-05" },
  full: { start: "2021-10-06", endExclusive: "2026-10-05" }
};
const SIGNAL_CONFIG = {
  lookbackObservations: 5,
  minDxyChangePct: 0.25,
  minRealYieldChangeBp: 5,
  maxStaleDays: 4,
  maxSpanDays: 10
};
const COSTS = {
  baseline: { spreadPrice: 0.50, slippagePrice: 0.05 },
  conservative: { spreadPrice: 0.75, slippagePrice: 0.10 },
  stress: { spreadPrice: 1.00, slippagePrice: 0.15 }
};
const BOOTSTRAP = { replicates: 5000, blockTradingDays: 5, seed: 20261124 };

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

async function fetchFredCsv(seriesId, startDate, endDate) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", seriesId);
  url.searchParams.set("cosd", startDate);
  url.searchParams.set("coed", endDate);
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Gold-AI-Trader-Research/1.0", accept: "text/csv" }
      });
      if (!response.ok) throw new Error(seriesId + ": HTTP " + response.status);
      const csv = await response.text();
      if (!csv.includes(",")) throw new Error(seriesId + ": response is not CSV");
      return { url: url.toString(), csv };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

async function loadGoldM5() {
  const bytes = await fs.readFile(DATA_FILE);
  const text = DATA_FILE.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length < 200000) {
    throw new Error("Invalid prepared XAUUSD M5 data: " + (Array.isArray(parsed) ? parsed.length : "not an array"));
  }
  return parsed;
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position), upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function blockBootstrapMean(sessionRows, replicates, blockSize, seed) {
  const rng = makeRng(seed), samples = [], n = sessionRows.length;
  if (n < blockSize) return { lower95: null, upper95: null, replicates: 0 };
  for (let r = 0; r < replicates; r += 1) {
    let sum = 0, trades = 0, sampledSessions = 0;
    while (sampledSessions < n) {
      const start = Math.floor(rng() * n);
      const length = Math.min(blockSize, n - sampledSessions);
      for (let k = 0; k < length; k += 1) {
        const row = sessionRows[(start + k) % n];
        if (row.netPnl !== null) {
          sum += row.netPnl;
          trades += 1;
        }
      }
      sampledSessions += length;
    }
    if (trades > 0) samples.push(sum / trades);
  }
  samples.sort((a, b) => a - b);
  return {
    lower95: percentile(samples, 0.025),
    upper95: percentile(samples, 0.975),
    replicates: samples.length,
    blockTradingDays: blockSize
  };
}

function summarizeTrades(sessionRows, costName) {
  const trades = sessionRows.filter((row) => row.netPnl !== null);
  const net = trades.map((row) => row.netPnl);
  const wins = net.filter((x) => x > 0), losses = net.filter((x) => x < 0);
  const grossProfit = wins.reduce((sum, x) => sum + x, 0);
  const grossLoss = -losses.reduce((sum, x) => sum + x, 0);
  let cumulative = 0, peak = 0, maxDrawdown = 0;
  for (const pnl of net) {
    cumulative += pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  const byYear = new Map();
  for (const row of trades) {
    const year = row.date.slice(0, 4);
    const current = byYear.get(year) || { year, trades: 0, netPnl: 0, wins: 0 };
    current.trades += 1;
    current.netPnl += row.netPnl;
    if (row.netPnl > 0) current.wins += 1;
    byYear.set(year, current);
  }
  const mean = net.length ? net.reduce((sum, x) => sum + x, 0) / net.length : null;
  return {
    costScenario: costName, sessions: sessionRows.length, trades: trades.length,
    wins: wins.length, losses: losses.length,
    winRatePct: net.length ? wins.length / net.length * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
    totalNetPnlPrice: net.reduce((sum, x) => sum + x, 0),
    expectancyNetPricePerTrade: mean,
    medianNetPricePerTrade: net.length ? [...net].sort((a, b) => a - b)[Math.floor(net.length / 2)] : null,
    maxDrawdownPrice: maxDrawdown,
    positiveCalendarYears: [...byYear.values()].filter((x) => x.netPnl > 0).length,
    annual: [...byYear.values()].sort((a, b) => a.year.localeCompare(b.year))
  };
}

function evaluatePeriod(daily, dxy, realYield, period, costName, costs) {
  const sessionRows = [];
  for (const day of daily) {
    if (day.date < period.start || day.date >= period.endExclusive) continue;
    const signal = buildGoldMacroSignal(day.date, dxy, realYield, SIGNAL_CONFIG);
    if (signal.side === "WAIT") {
      sessionRows.push({ date: day.date, side: "WAIT", netPnl: null, signal });
      continue;
    }
    const result = simulateGoldMacroDailyTrade(day, signal.side, costs);
    sessionRows.push({
      date: day.date, side: signal.side, netPnl: result.netPnl,
      grossPnl: result.grossPnl, estimatedCost: result.estimatedCost,
      entry: result.entry, exit: result.exit, signal
    });
  }
  const summary = summarizeTrades(sessionRows, costName);
  summary.bootstrapMean = blockBootstrapMean(
    sessionRows, BOOTSTRAP.replicates, BOOTSTRAP.blockTradingDays,
    BOOTSTRAP.seed + period.start.charCodeAt(0) + costName.length
  );
  return { summary, sessionRows };
}

function makeCsv(rows) {
  const header = [
    "date", "side", "reason", "macro_asof_usd", "usd_change_5obs_pct",
    "macro_asof_real_yield", "real_yield_change_5obs_bp", "gross_pnl_price",
    "estimated_round_trip_cost", "net_pnl_baseline", "net_pnl_conservative", "net_pnl_stress"
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    if (row.side === "WAIT") continue;
    const dxy = row.signal.dxy, real = row.signal.realYield, pnl = {};
    for (const [name, costs] of Object.entries(COSTS)) {
      pnl[name] = simulateGoldMacroDailyTrade(row.day, row.side, costs);
    }
    lines.push([
      row.date, row.side, row.signal.reason, dxy.latestDate, dxy.changePct.toFixed(6),
      real.latestDate, (real.change * 100).toFixed(4),
      pnl.baseline.grossPnl.toFixed(5), pnl.conservative.estimatedCost.toFixed(5),
      pnl.baseline.netPnl.toFixed(5), pnl.conservative.netPnl.toFixed(5), pnl.stress.netPnl.toFixed(5)
    ].map(csvEscape).join(","));
  }
  return lines.join("\n") + "\n";
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const m5 = await loadGoldM5();
  const daily = aggregateGoldDailyBars(m5);
  if (daily.length < 700) throw new Error("Insufficient full UTC gold sessions: " + daily.length);

  const [dxyRaw, realYieldRaw] = await Promise.all([
    fetchFredCsv("DTWEXBGS", "2021-09-01", "2026-10-05"),
    fetchFredCsv("DFII10", "2021-09-01", "2026-10-05")
  ]);
  await fs.writeFile(path.join(OUTPUT_DIR, "DTWEXBGS.csv"), dxyRaw.csv, "utf8");
  await fs.writeFile(path.join(OUTPUT_DIR, "DFII10.csv"), realYieldRaw.csv, "utf8");
  const dxy = parseFredCsv(dxyRaw.csv, "DTWEXBGS");
  const realYield = parseFredCsv(realYieldRaw.csv, "DFII10");

  const results = {}, periodRows = {};
  for (const [periodName, period] of Object.entries(PERIODS)) {
    results[periodName] = {};
    periodRows[periodName] = {};
    for (const [costName, costs] of Object.entries(COSTS)) {
      const evaluated = evaluatePeriod(daily, dxy, realYield, period, costName, costs);
      results[periodName][costName] = evaluated.summary;
      periodRows[periodName][costName] = evaluated.sessionRows;
    }
  }

  const dayByDate = new Map(daily.map((day) => [day.date, day]));
  const tradeLedger = periodRows.full.baseline
    .filter((row) => row.side !== "WAIT")
    .map((row) => ({ ...row, day: dayByDate.get(row.date) }));
  await fs.writeFile(
    path.join(OUTPUT_DIR, "gold_macro_regime_v1_trade_ledger.csv"),
    makeCsv(tradeLedger),
    "utf8"
  );

  const gateReasons = [];
  const isConservative = results.is.conservative, oosConservative = results.oos.conservative;
  const isBaseline = results.is.baseline, oosBaseline = results.oos.baseline;
  if (isConservative.trades < 100) gateReasons.push("IS trades below 100");
  if (oosConservative.trades < 50) gateReasons.push("OOS trades below 50");
  for (const [label, metric] of [
    ["IS baseline", isBaseline], ["IS conservative", isConservative],
    ["OOS baseline", oosBaseline], ["OOS conservative", oosConservative]
  ]) {
    if (!(Number(metric.expectancyNetPricePerTrade) > 0)) gateReasons.push(label + ": net expectancy is not positive");
  }
  for (const [label, metric] of [["IS conservative", isConservative], ["OOS conservative", oosConservative]]) {
    if (!(Number(metric.profitFactor) >= 1.15)) gateReasons.push(label + ": PF below 1.15");
    if (!(Number(metric.bootstrapMean?.lower95) > 0)) gateReasons.push(label + ": 95% block-bootstrap lower bound is not positive");
  }
  if (oosConservative.positiveCalendarYears < 2) gateReasons.push("OOS positive calendar years below 2");

  const report = {
    version: "GOLD_MACRO_REGIME_V1",
    decision: gateReasons.length === 0 ? "PASS_TO_EXECUTION_RESEARCH" : "REJECT_OR_REDESIGN",
    gateReasons,
    hypothesis: "A five-observation decline in both the nominal broad USD index and the 10-year TIPS real yield biases the next eligible XAUUSD UTC session upward; a rise in both biases it downward.",
    sourceData: {
      xauusd: {
        file: DATA_FILE, provider: "Dukascopy historical M1 BID aggregated to M5",
        rawM5Bars: m5.length, completeUtcSessions: daily.length,
        firstSession: daily[0].date, lastSession: daily.at(-1).date
      },
      usdProxy: { seriesId: "DTWEXBGS", name: "Nominal Broad U.S. Dollar Index", url: dxyRaw.url, observations: dxy.length },
      realYield: { seriesId: "DFII10", name: "10-Year TIPS real yield", url: realYieldRaw.url, observations: realYield.length }
    },
    signal: {
      ...SIGNAL_CONFIG,
      timing: "For a gold trade date, only macro observations dated strictly before that UTC date are eligible. The latest macro observation must be no more than four calendar days old.",
      direction: "Both USD index and real yield materially down => BUY GOLD; both materially up => SELL GOLD; otherwise WAIT.",
      execution: "One trade per eligible UTC session, entered at the first 00:00 UTC M5 BID open and exited at the final available M5 BID close of that full session.",
      noParameterSearch: true
    },
    costs: {
      baseline: { ...COSTS.baseline, estimatedRoundTripPriceCost: COSTS.baseline.spreadPrice + 2 * COSTS.baseline.slippagePrice },
      conservative: { ...COSTS.conservative, estimatedRoundTripPriceCost: COSTS.conservative.spreadPrice + 2 * COSTS.conservative.slippagePrice },
      stress: { ...COSTS.stress, estimatedRoundTripPriceCost: COSTS.stress.spreadPrice + 2 * COSTS.stress.slippagePrice },
      note: "Static cost stress assumptions on BID historical bars; not a claim about realized XM spread. Validate against broker tick/forward data before any later execution study."
    },
    periods: PERIODS,
    bootstrap: {
      method: "circular block bootstrap over consecutive eligible XAUUSD UTC sessions",
      ...BOOTSTRAP,
      confidenceInterval: "percentile 95% interval for mean net price PnL per executed trade"
    },
    results,
    limitations: [
      "This is a one-day macro-direction event study, not a complete strategy with protective stop and position sizing.",
      "DTWEXBGS is the Federal Reserve Board's nominal broad dollar index, not the ICE U.S. Dollar Index (DXY).",
      "DFII10 is a daily 10-year TIPS real-yield observation; conservative date lag is applied to avoid same-day lookahead.",
      "Historical bid prices and static spread/slippage assumptions cannot reproduce XM's time-varying spread, commission, swaps, or execution quality.",
      "Passing this screen only authorizes a separate stop/exit and broker-cost validation study. It never enables live orders."
    ],
    createdAtUtc: new Date().toISOString()
  };
  await fs.writeFile(path.join(OUTPUT_DIR, "gold_macro_regime_v1_report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({
    version: report.version, decision: report.decision, gateReasons: report.gateReasons,
    isConservative: {
      trades: isConservative.trades, pf: isConservative.profitFactor,
      expectancy: isConservative.expectancyNetPricePerTrade, ciLower95: isConservative.bootstrapMean.lower95
    },
    oosConservative: {
      trades: oosConservative.trades, pf: oosConservative.profitFactor,
      expectancy: oosConservative.expectancyNetPricePerTrade, ciLower95: oosConservative.bootstrapMean.lower95
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
