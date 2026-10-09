import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEurUsdDirectionalDiagnostics } from '../src/eurusd_diagnostics.js';

test('H1 RANGE reclassifies directional diagnostics as not evaluated and preserves candidate values', () => {
  const setup = {
    candidate: 'WAIT',
    trend: 'RANGE',
    entry: 0,
    stop_loss: 0,
    take_profit: 0,
    risk_reward: 0,
    reasons: [
      'h1_trend_not_clear',
      'm15_ema_not_aligned',
      'm15_rsi_out_of_breakout_zone',
      'range_width_outside_atr_band',
      'spread_filter_failed',
      'breakout_penetration_too_small',
      'breakout_body_too_small',
      'breakout_close_location_weak',
      'breakout_volume_confirmation_failed'
    ]
  };

  const normalized = normalizeEurUsdDirectionalDiagnostics(setup);

  assert.equal(normalized.candidate, setup.candidate);
  assert.equal(normalized.trend, setup.trend);
  assert.equal(normalized.entry, setup.entry);
  assert.equal(normalized.stop_loss, setup.stop_loss);
  assert.equal(normalized.take_profit, setup.take_profit);
  assert.equal(normalized.risk_reward, setup.risk_reward);
  assert.deepEqual(normalized.reasons, [
    'h1_trend_not_clear',
    'm15_ema_not_evaluated_h1_unclear',
    'm15_rsi_not_evaluated_h1_unclear',
    'range_width_outside_atr_band',
    'spread_filter_failed',
    'breakout_penetration_not_evaluated_h1_unclear',
    'breakout_body_too_small',
    'breakout_close_location_not_evaluated_h1_unclear',
    'breakout_volume_confirmation_failed'
  ]);
  assert.deepEqual(setup.reasons.slice(0, 3), [
    'h1_trend_not_clear',
    'm15_ema_not_aligned',
    'm15_rsi_out_of_breakout_zone'
  ]);
});

test('clear UP/DOWN trend keeps genuine directional failures unchanged', () => {
  for (const trend of ['UP', 'DOWN']) {
    const setup = {
      candidate: 'WAIT',
      trend,
      reasons: [
        'm15_ema_not_aligned',
        'm15_rsi_out_of_breakout_zone',
        'breakout_penetration_too_small',
        'breakout_close_location_weak'
      ]
    };
    assert.equal(normalizeEurUsdDirectionalDiagnostics(setup), setup);
    assert.deepEqual(setup.reasons, [
      'm15_ema_not_aligned',
      'm15_rsi_out_of_breakout_zone',
      'breakout_penetration_too_small',
      'breakout_close_location_weak'
    ]);
  }
});

test('missing or malformed setup diagnostics are left unchanged safely', () => {
  assert.equal(normalizeEurUsdDirectionalDiagnostics(null), null);
  assert.equal(normalizeEurUsdDirectionalDiagnostics(undefined), undefined);
  const setupWithoutReasons = { candidate: 'WAIT', trend: 'RANGE' };
  assert.equal(normalizeEurUsdDirectionalDiagnostics(setupWithoutReasons), setupWithoutReasons);
  const setupWithStringReasons = { candidate: 'WAIT', trend: 'RANGE', reasons: 'h1_trend_not_clear' };
  assert.equal(normalizeEurUsdDirectionalDiagnostics(setupWithStringReasons), setupWithStringReasons);
});
