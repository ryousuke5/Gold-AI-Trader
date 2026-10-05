function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function bars(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(-24).map((b) => ({
    time: n(b.time), open: n(b.open), high: n(b.high), low: n(b.low), close: n(b.close), volume: n(b.volume)
  }));
}
export function normalizeFeatures(input = {}) {
  return {
    bid: n(input.bid), ask: n(input.ask), point: n(input.point), spread: n(input.spread), spreadPoints: n(input.spread_points), barTime: n(input.bar_time),
    m5: { ema20: n(input.m5?.ema20), ema50: n(input.m5?.ema50), rsi14: n(input.m5?.rsi14), atr14: n(input.m5?.atr14), high20: n(input.m5?.high20), low20: n(input.m5?.low20) },
    h1: { close: n(input.h1?.close), ema20: n(input.h1?.ema20), ema50: n(input.h1?.ema50), ema200: n(input.h1?.ema200), rsi14: n(input.h1?.rsi14), atr14: n(input.h1?.atr14) },
    recentM5: bars(input.recent_m5), recentH1: bars(input.recent_h1)
  };
}
export function validateFeatures(f) {
  const errors = [];
  if (!(f.bid > 0) || !(f.ask > 0)) errors.push('invalid_price');
  if (!(f.ask >= f.bid)) errors.push('ask_below_bid');
  if (!(f.spread >= 0)) errors.push('invalid_spread');
  if (!(f.spreadPoints >= 0)) errors.push('invalid_spread_points');
  if (!(f.point > 0)) errors.push('missing_point');
  if (!(f.barTime > 0)) errors.push('missing_bar_time');
  const required = [
    ['m5.ema20', f.m5.ema20], ['m5.ema50', f.m5.ema50], ['m5.rsi14', f.m5.rsi14], ['m5.atr14', f.m5.atr14],
    ['h1.close', f.h1.close], ['h1.ema20', f.h1.ema20], ['h1.ema50', f.h1.ema50], ['h1.ema200', f.h1.ema200], ['h1.rsi14', f.h1.rsi14], ['h1.atr14', f.h1.atr14]
  ];
  for (const [name, value] of required) if (!(value > 0) && !name.includes('rsi14')) errors.push(`invalid_${name}`);
  if (f.m5.rsi14 < 0 || f.m5.rsi14 > 100) errors.push('invalid_m5_rsi');
  if (f.h1.rsi14 < 0 || f.h1.rsi14 > 100) errors.push('invalid_h1_rsi');
  if (f.recentM5.some((b) => !(b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close))) errors.push('invalid_recent_m5_bar');
  if (f.recentH1.some((b) => !(b.high >= b.low && b.high >= b.open && b.high >= b.close && b.low <= b.open && b.low <= b.close))) errors.push('invalid_recent_h1_bar');
  return errors;
}
export function ruleCandidate(f) {
  const up = f.h1.ema20 > f.h1.ema50 && f.h1.ema50 > f.h1.ema200;
  const down = f.h1.ema20 < f.h1.ema50 && f.h1.ema50 < f.h1.ema200;
  const m5Up = f.m5.ema20 > f.m5.ema50;
  const m5Down = f.m5.ema20 < f.m5.ema50;
  if (up && m5Up && f.m5.rsi14 >= 35 && f.m5.rsi14 <= 62) return 'BUY';
  if (down && m5Down && f.m5.rsi14 >= 38 && f.m5.rsi14 <= 65) return 'SELL';
  return 'WAIT';
}