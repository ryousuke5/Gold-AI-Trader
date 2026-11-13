// Shared, deterministic execution-price contract for BID-based XAUUSD bars.
// Strategy stop/target levels are expressed in BID chart-price coordinates.
// BUY closes transact on BID; SELL closes transact on ASK = BID + spread.
function finite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be a finite number`);
  return n;
}
function sideOf(side) {
  const s = String(side || '').toUpperCase();
  if (s !== 'BUY' && s !== 'SELL') throw new TypeError("side must be BUY or SELL");
  return s;
}
function costs(spread, slippage) {
  const s = finite(spread ?? 0, 'spread');
  const slip = finite(slippage ?? 0, 'slippage');
  if (s < 0 || slip < 0) throw new RangeError('spread and slippage must be >= 0');
  return { spread: s, slippage: slip };
}

export function calculateEntryFill({ side, bidOpen, spread = 0, slippage = 0 }) {
  const direction = sideOf(side);
  const bid = finite(bidOpen, 'bidOpen');
  const c = costs(spread, slippage);
  if (!(bid > 0)) throw new RangeError('bidOpen must be > 0');
  // BUY enters at ASK; SELL enters at BID.
  return direction === 'BUY' ? bid + c.spread + c.slippage : bid - c.slippage;
}

export function isStopTriggered({ side, bidBar, stopLossBid }) {
  const direction = sideOf(side);
  const level = finite(stopLossBid, 'stopLossBid');
  const high = finite(bidBar?.high, 'bidBar.high');
  const low = finite(bidBar?.low, 'bidBar.low');
  // Levels are defined from BID candles. Do not add spread to the SELL trigger.
  return direction === 'BUY' ? low <= level : high >= level;
}

export function isTargetTriggered({ side, bidBar, takeProfitBid }) {
  const direction = sideOf(side);
  const level = finite(takeProfitBid, 'takeProfitBid');
  const high = finite(bidBar?.high, 'bidBar.high');
  const low = finite(bidBar?.low, 'bidBar.low');
  return direction === 'BUY' ? high >= level : low <= level;
}

export function calculateExpectedStopFill({ side, stopLossBid, spread = 0, slippage = 0 }) {
  const direction = sideOf(side);
  const stop = finite(stopLossBid, 'stopLossBid');
  const c = costs(spread, slippage);
  // A BUY stop is a BID sell; a SELL stop is an ASK buy-to-cover.
  return direction === 'BUY' ? stop - c.slippage : stop + c.spread + c.slippage;
}

export function calculateEffectiveRiskDistance({
  side, entryFill, stopLossBid, spread = 0, slippage = 0
}) {
  const entry = finite(entryFill, 'entryFill');
  const stopFill = calculateExpectedStopFill({ side, stopLossBid, spread, slippage });
  const distance = sideOf(side) === 'BUY' ? entry - stopFill : stopFill - entry;
  if (!(distance > 0)) return null;
  return distance;
}

export function calculateExitFill({
  side, reason, bidBar, levelBid = null, spread = 0, slippage = 0
}) {
  const direction = sideOf(side);
  const c = costs(spread, slippage);
  const reasonCode = String(reason || '').toUpperCase();
  const open = finite(bidBar?.open, 'bidBar.open');
  const close = finite(bidBar?.close, 'bidBar.close');

  if (reasonCode === 'DATA_GAP' || reasonCode === 'TIME') {
    return direction === 'BUY' ? close - c.slippage : close + c.spread + c.slippage;
  }

  const level = finite(levelBid, 'levelBid');
  if (reasonCode === 'STOP') {
    if (direction === 'BUY') {
      const bidFill = open <= level ? open : level; // adverse open-through gap
      return bidFill - c.slippage;
    }
    const bidFill = open >= level ? open : level;
    return bidFill + c.spread + c.slippage;
  }

  if (reasonCode === 'TARGET') {
    if (direction === 'BUY') {
      const bidFill = open >= level ? open : level; // favorable open-through gap
      return bidFill - c.slippage;
    }
    const bidFill = open <= level ? open : level;
    return bidFill + c.spread + c.slippage;
  }

  throw new TypeError('reason must be STOP, TARGET, DATA_GAP, or TIME');
}
