import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoldPostTrace } from '../src/gold_post_trace.js';

test('fingerprints source hints without leaking raw addresses or request secrets', () => {
  const record = buildGoldPostTrace({
    req: {
      headers: {
        'cf-connecting-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.44, 203.0.113.10',
        'x-gold-client-id': 'GOLD_V18_HOME',
        'user-agent': 'MetaTrader 4\r\nBadHeader: yes'
      },
      socket: { remoteAddress: '10.0.0.9' }
    },
    requestId: 'req-123',
    symbol: 'GOLD',
    timeframe: 'M5',
    features: { barTime: Date.parse('2026-10-23T00:00:00.000Z') / 1000 },
    event: 'DUPLICATE_BAR',
    reason: 'persisted_bar_already_exists',
    receivedAt: '2026-10-23T00:00:01.000Z',
    fingerprintSecret: 'test-only-secret'
  });

  assert.equal(record.event, 'DUPLICATE_BAR');
  assert.equal(record.request_id, 'req-123');
  assert.equal(record.client_id, 'GOLD_V18_HOME');
  assert.equal(record.forwarded_hops, 2);
  assert.equal(record.xff_hop_fingerprints_untrusted.length, 2);
  assert.match(record.cf_ip_fingerprint, /^[a-f0-9]{12}$/);
  assert.match(record.socket_peer_fingerprint, /^[a-f0-9]{12}$/);
  assert.equal(record.bar_time_utc, '2026-10-23T00:00:00.000Z');
  assert.equal(record.user_agent.includes('\r'), false);
  assert.equal(record.user_agent.includes('\n'), false);

  const serialized = JSON.stringify(record);
  for (const privateValue of ['203.0.113.10', '198.51.100.44', '10.0.0.9', 'test-only-secret']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('same source hints yield stable fingerprints and different source hints do not', () => {
  const build = (ip) => buildGoldPostTrace({
    req: { headers: { 'cf-connecting-ip': ip }, socket: { remoteAddress: '127.0.0.1' } },
    fingerprintSecret: 'same-test-secret'
  });
  assert.equal(build('203.0.113.1').cf_ip_fingerprint, build('203.0.113.1').cf_ip_fingerprint);
  assert.notEqual(build('203.0.113.1').cf_ip_fingerprint, build('203.0.113.2').cf_ip_fingerprint);
});

test('drops invalid client identifiers and caps forwarded hops', () => {
  const xff = Array.from({ length: 12 }, (_, index) => '198.51.100.' + (index + 1)).join(', ');
  const trace = buildGoldPostTrace({
    req: {
      headers: {
        'x-gold-client-id': 'bad id with spaces',
        'x-forwarded-for': xff
      }
    }
  });
  assert.equal(trace.client_id, null);
  assert.equal(trace.forwarded_hops, 8);
  assert.equal(trace.xff_hop_fingerprints_untrusted.length, 8);
});
