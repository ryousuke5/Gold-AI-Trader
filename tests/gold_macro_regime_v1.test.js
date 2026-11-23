import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateGoldDailyBars, buildGoldMacroSignal, parseFredCsv,
  simulateGoldMacroDailyTrade, trailingMacroChange
} from "../src/gold_macro_regime_v1.js";

test("parses FRED CSV and ignores missing observations", () => {
  const rows = parseFredCsv("observation_date,DTWEXBGS\n2024-01-01,120.0\n2024-01-02,.\n2024-01-03,119.0\n", "DTWEXBGS");
  assert.deepEqual(rows, [{ date: "2024-01-01", value: 120 }, { date: "2024-01-03", value: 119 }]);
});

test("same-day macro observation is excluded to prevent lookahead", () => {
  const rows = [
    { date: "2024-01-01", value: 100 }, { date: "2024-01-02", value: 101 },
    { date: "2024-01-03", value: 102 }, { date: "2024-01-04", value: 103 },
    { date: "2024-01-05", value: 104 }, { date: "2024-01-08", value: 110 }
  ];
  const change = trailingMacroChange(rows, "2024-01-08", 4);
  assert.equal(change.latestDate, "2024-01-05");
  assert.equal(change.latestValue, 104);
});

test("aligned falling USD and real yields produce BUY", () => {
  const dxy = [
    { date: "2024-01-01", value: 105 }, { date: "2024-01-02", value: 104.8 },
    { date: "2024-01-03", value: 104.6 }, { date: "2024-01-04", value: 104.4 },
    { date: "2024-01-05", value: 104.2 }, { date: "2024-01-08", value: 104.0 }
  ];
  const realYield = [
    { date: "2024-01-01", value: 2.40 }, { date: "2024-01-02", value: 2.38 },
    { date: "2024-01-03", value: 2.36 }, { date: "2024-01-04", value: 2.34 },
    { date: "2024-01-05", value: 2.32 }, { date: "2024-01-08", value: 2.30 }
  ];
  assert.equal(buildGoldMacroSignal("2024-01-09", dxy, realYield).side, "BUY");
});

test("aligned rising USD and real yields produce SELL", () => {
  const dxy = [
    { date: "2024-01-01", value: 100 }, { date: "2024-01-02", value: 100.1 },
    { date: "2024-01-03", value: 100.2 }, { date: "2024-01-04", value: 100.3 },
    { date: "2024-01-05", value: 100.4 }, { date: "2024-01-08", value: 100.6 }
  ];
  const realYield = [
    { date: "2024-01-01", value: 2.00 }, { date: "2024-01-02", value: 2.02 },
    { date: "2024-01-03", value: 2.04 }, { date: "2024-01-04", value: 2.06 },
    { date: "2024-01-05", value: 2.08 }, { date: "2024-01-08", value: 2.10 }
  ];
  assert.equal(buildGoldMacroSignal("2024-01-09", dxy, realYield).side, "SELL");
});

test("mixed macro directions do not create a signal", () => {
  const dxy = [
    { date: "2024-01-01", value: 100 }, { date: "2024-01-02", value: 100.1 },
    { date: "2024-01-03", value: 100.2 }, { date: "2024-01-04", value: 100.3 },
    { date: "2024-01-05", value: 100.4 }, { date: "2024-01-08", value: 100.6 }
  ];
  const realYield = [
    { date: "2024-01-01", value: 2.40 }, { date: "2024-01-02", value: 2.38 },
    { date: "2024-01-03", value: 2.36 }, { date: "2024-01-04", value: 2.34 },
    { date: "2024-01-05", value: 2.32 }, { date: "2024-01-08", value: 2.30 }
  ];
  assert.equal(buildGoldMacroSignal("2024-01-09", dxy, realYield).side, "WAIT");
});

test("stale macro observations are not used", () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({
    date: "2024-01-" + String(i + 1).padStart(2, "0"), value: 100 + i
  }));
  assert.equal(trailingMacroChange(rows, "2024-01-20", 5), null);
});

test("daily full-session aggregation rejects partial Sunday sessions", () => {
  const bars = [];
  for (let i = 0; i < 276; i += 1) {
    bars.push({
      time: Date.parse("2024-01-08T00:00:00Z") / 1000 + i * 300,
      open: 2000 + i, high: 2001 + i, low: 1999 + i, close: 2000.5 + i
    });
  }
  for (let i = 0; i < 24; i += 1) {
    bars.push({
      time: Date.parse("2024-01-07T22:00:00Z") / 1000 + i * 300,
      open: 2000, high: 2001, low: 1999, close: 2000
    });
  }
  const daily = aggregateGoldDailyBars(bars);
  assert.equal(daily.length, 1);
  assert.equal(daily[0].date, "2024-01-08");
});

test("round-trip spread and slippage are charged symmetrically", () => {
  const day = { open: 2000, close: 2010 };
  const long = simulateGoldMacroDailyTrade(day, "BUY", { spreadPrice: 0.75, slippagePrice: 0.10 });
  const short = simulateGoldMacroDailyTrade(day, "SELL", { spreadPrice: 0.75, slippagePrice: 0.10 });
  assert.equal(Number(long.netPnl.toFixed(2)), 9.05);
  assert.equal(Number(short.netPnl.toFixed(2)), -10.95);
  assert.equal(Number(long.estimatedCost.toFixed(2)), 0.95);
});
