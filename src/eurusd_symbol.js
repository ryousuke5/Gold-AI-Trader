/**
 * Broker symbol allow-list for the EURUSD strategy.
 *
 * Preserve the broker-native symbol in payloads and persistence, but accept
 * only the unsuffixed symbol and the known XM-style '#' suffix.
 */
export function isSupportedEurUsdSymbol(value) {
  if (typeof value !== 'string') return false;
  const symbol = value.trim().toUpperCase();
  return symbol === 'EURUSD' || symbol === 'EURUSD#';
}
