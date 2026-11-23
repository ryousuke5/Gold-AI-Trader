const DAY_MS = 86400000;

function dateMs(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return NaN;
  const value = Date.parse(String(date) + "T00:00:00.000Z");
  return Number.isFinite(value) ? value : NaN;
}
function daysBetween(later, earlier) {
  return Math.round((dateMs(later) - dateMs(earlier)) / DAY_MS);
}

export function parseFredCsv(csvText, seriesId = "FRED") {
  const lines = String(csvText || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error(seriesId + ": FRED CSV has no observations");
  const header = lines[0].split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
  const dateIndex = header.findIndex((x) => /^(observation_date|date)$/i.test(x));
  const valueIndex = header.findIndex((_, i) => i !== dateIndex);
  if (dateIndex < 0 || valueIndex < 0) throw new Error(seriesId + ": unexpected FRED CSV header: " + lines[0]);

  const byDate = new Map();
  for (const line of lines.slice(1)) {
    const columns = line.split(",");
    const date = String(columns[dateIndex] || "").trim().replace(/^"|"$/g, "");
    const raw = String(columns[valueIndex] || "").trim().replace(/^"|"$/g, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || raw === "" || raw === ".") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) byDate.set(date, value);
  }
  const rows = [...byDate.entries()].map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 10) throw new Error(seriesId + ": too few usable FRED observations (" + rows.length + ")");
  return rows;
}

export function trailingMacroChange(rows, tradeDate, lookbackObservations = 5, options = {}) {
  const maxStaleDays = Number(options.maxStaleDays ?? 4);
  const maxSpanDays = Number(options.maxSpanDays ?? 10);
  if (!Array.isArray(rows) || rows.length < lookbackObservations + 1 || !Number.isFinite(dateMs(tradeDate))) return null;
  // Strictly exclude same-day observations to prevent publication-time lookahead.
  const eligible = rows.filter((row) => row.date < tradeDate);
  if (eligible.length < lookbackObservations + 1) return null;
  const latest = eligible.at(-1);
  const base = eligible.at(-(lookbackObservations + 1));
  const latestAgeDays = daysBetween(tradeDate, latest.date);
  const lookbackSpanDays = daysBetween(latest.date, base.date);
  if (latestAgeDays < 1 || latestAgeDays > maxStaleDays || lookbackSpanDays > maxSpanDays) return null;
  return {
    latestDate: latest.date, baseDate: base.date,
    latestValue: latest.value, baseValue: base.value,
    change: latest.value - base.value,
    changePct: base.value !== 0 ? (latest.value / base.value - 1) * 100 : null,
    latestAgeDays, lookbackSpanDays
  };
}

export function buildGoldMacroSignal(tradeDate, dxyRows, realYieldRows, options = {}) {
  const lookbackObservations = Math.max(1, Math.floor(Number(options.lookbackObservations ?? 5)));
  const minDxyChangePct = Math.max(0, Number(options.minDxyChangePct ?? 0.25));
  const minRealYieldChangeBp = Math.max(0, Number(options.minRealYieldChangeBp ?? 5));
  const dxy = trailingMacroChange(dxyRows, tradeDate, lookbackObservations, options);
  const realYield = trailingMacroChange(realYieldRows, tradeDate, lookbackObservations, options);
  if (!dxy || !realYield || !Number.isFinite(dxy.changePct) || !Number.isFinite(realYield.change)) {
    return { side: "WAIT", reason: "macro_data_unavailable_or_stale", dxy, realYield };
  }

  // DFII10 is in percentage points: 0.05 = 5 basis points.
  const realYieldChangeBp = realYield.change * 100;
  const down = dxy.changePct <= -minDxyChangePct && realYieldChangeBp <= -minRealYieldChangeBp;
  const up = dxy.changePct >= minDxyChangePct && realYieldChangeBp >= minRealYieldChangeBp;
  if (down) return { side: "BUY", reason: "usd_and_real_yield_falling", dxy, realYield, realYieldChangeBp };
  if (up) return { side: "SELL", reason: "usd_and_real_yield_rising", dxy, realYield, realYieldChangeBp };
  return { side: "WAIT", reason: "macro_directions_not_both_materially_aligned", dxy, realYield, realYieldChangeBp };
}

export function aggregateGoldDailyBars(m5Bars, options = {}) {
  const minBars = Math.max(1, Math.floor(Number(options.minBars ?? 240)));
  const maxGapSeconds = Math.max(300, Number(options.maxGapSeconds ?? 4200));
  const grouped = new Map();
  for (const bar of m5Bars || []) {
    const time = Number(bar.time), open = Number(bar.open), high = Number(bar.high);
    const low = Number(bar.low), close = Number(bar.close);
    if (![time, open, high, low, close].every(Number.isFinite) || open <= 0 ||
        high < low || high < open || high < close || low > open || low > close) continue;
    const date = new Date(time * 1000).toISOString().slice(0, 10);
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push({ time, open, high, low, close });
  }

  const daily = [];
  for (const [date, bars] of grouped.entries()) {
    bars.sort((a, b) => a.time - b.time);
    const first = bars[0], last = bars.at(-1);
    const firstUtcSeconds = first.time % 86400, lastUtcSeconds = last.time % 86400;
    let maxGap = 0;
    for (let i = 1; i < bars.length; i += 1) maxGap = Math.max(maxGap, bars[i].time - bars[i - 1].time);
    // Full UTC sessions only. The regular maintenance break can be 65-70 minutes.
    if (firstUtcSeconds !== 0 || bars.length < minBars || lastUtcSeconds < 20 * 3600 || maxGap > maxGapSeconds) continue;
    daily.push({
      date, open: first.open, high: Math.max(...bars.map((bar) => bar.high)),
      low: Math.min(...bars.map((bar) => bar.low)), close: last.close,
      firstTime: first.time, lastTime: last.time, bars: bars.length, maxGapSeconds: maxGap
    });
  }
  return daily.sort((a, b) => a.date.localeCompare(b.date));
}

export function simulateGoldMacroDailyTrade(day, side, costs) {
  if (!day || !["BUY", "SELL"].includes(side)) throw new Error("Invalid daily trade input");
  const spread = Number(costs?.spreadPrice), slippage = Number(costs?.slippagePrice);
  if (!Number.isFinite(spread) || spread < 0 || !Number.isFinite(slippage) || slippage < 0) {
    throw new Error("Invalid cost assumptions");
  }
  const entry = side === "BUY" ? day.open + spread + slippage : day.open - slippage;
  const exit = side === "BUY" ? day.close - slippage : day.close + spread + slippage;
  const grossPnl = side === "BUY" ? day.close - day.open : day.open - day.close;
  return { entry, exit, grossPnl, estimatedCost: spread + 2 * slippage, netPnl: grossPnl - spread - 2 * slippage };
}
