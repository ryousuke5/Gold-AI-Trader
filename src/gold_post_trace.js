import crypto from 'node:crypto';

function fingerprint(secret, value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  return crypto
    .createHmac('sha256', String(secret || 'gold-post-source-trace'))
    .update(normalized, 'utf8')
    .digest('hex')
    .slice(0, 12);
}

function forwardedHops(value) {
  const headers = Array.isArray(value) ? value : [value];
  return headers
    .filter((item) => item !== undefined && item !== null)
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Create a compact, privacy-conscious record for correlating GOLD signal POSTs.
 *
 * IP-like values are hashed before logging. X-Forwarded-For entries are not
 * trusted as authoritative identities; clients may supply forged values. The
 * fingerprints are only clues for correlation. Prefer a server-controlled
 * client-IP header where the hosting proxy guarantees its provenance, and use
 * X-Gold-Client-ID for definitive separation of multiple MT4 installations.
 */
export function buildGoldPostTrace({
  req,
  requestId = null,
  symbol = null,
  timeframe = null,
  features = {},
  event = 'REQUEST',
  reason = null,
  receivedAt = new Date().toISOString(),
  fingerprintSecret = 'gold-post-source-trace'
} = {}) {
  const headers = req?.headers || {};
  const xff = forwardedHops(headers['x-forwarded-for']);
  const cfConnectingIp = String(headers['cf-connecting-ip'] ?? '').trim();
  const socketPeer = String(req?.socket?.remoteAddress ?? '').trim();
  const rawClientId = String(headers['x-gold-client-id'] ?? '').trim();
  const clientId = /^[A-Za-z0-9._:-]{1,64}$/.test(rawClientId) ? rawClientId : null;
  const userAgent = String(headers['user-agent'] ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 120) || null;

  const barEpoch = Number(features?.barTime ?? features?.bar_time);
  const barTimeUtc = Number.isFinite(barEpoch) && barEpoch > 0
    ? new Date(barEpoch * 1000).toISOString()
    : null;

  return {
    event: String(event || 'REQUEST').slice(0, 32),
    request_id: String(requestId || '').slice(0, 100) || null,
    received_at: String(receivedAt),
    // Useful only for log correlation; do not use for authorization.
    cf_ip_fingerprint: fingerprint(fingerprintSecret, cfConnectingIp),
    // Retain the whole hashed chain so no hop is silently assumed to be
    // the client. XFF values are untrusted and can be spoofed by callers.
    forwarded_hops: xff.length,
    xff_hop_fingerprints_untrusted: xff.map((value) => fingerprint(fingerprintSecret, value)),
    socket_peer_fingerprint: fingerprint(fingerprintSecret, socketPeer),
    client_id: clientId,
    user_agent: userAgent,
    symbol: String(symbol || '').slice(0, 24),
    timeframe: String(timeframe || '').slice(0, 12),
    bar_time_utc: barTimeUtc,
    reason: reason === null ? null : String(reason).slice(0, 80)
  };
}
