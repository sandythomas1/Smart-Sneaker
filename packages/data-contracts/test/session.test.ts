import { SessionSchema, SensorSampleSchema, validateContract } from '../src';
import { validSample, validSession, validInsightSet } from './fixtures';

describe('SensorSampleSchema', () => {
  it('accepts a valid sample', () => {
    expect(validateContract(SensorSampleSchema, validSample()).ok).toBe(true);
  });

  it.each([
    ['negative timestamp', validSample({ timestampMs: -1 })],
    ['non-integer timestamp', validSample({ timestampMs: 1.5 })],
    ['unknown foot', validSample({ foot: 'middle' })],
    ['empty pressure array', validSample({ pressure: [] })],
    ['negative pressure reading', validSample({ pressure: [0.1, -0.2] })],
    ['NaN pressure reading', validSample({ pressure: [Number.NaN] })],
    ['Infinity accel', validSample({ imu: { accel: { x: Infinity, y: 0, z: 0 }, gyro: { x: 0, y: 0, z: 0 } } })],
    ['more than 64 pressure channels', validSample({ pressure: new Array(65).fill(0.1) })],
  ])('rejects %s', (_name, payload) => {
    expect(validateContract(SensorSampleSchema, payload).ok).toBe(false);
  });
});

describe('SessionSchema', () => {
  it('accepts a valid session without labels', () => {
    const result = validateContract(SessionSchema, validSession());
    expect(result.ok).toBe(true);
  });

  it('accepts optional labels / known-condition metadata (Req. 8)', () => {
    const result = validateContract(
      SessionSchema,
      validSession({
        labels: { conditions: ['favor-left-leg', 'pace-5min-km'], notes: 'treadmill, lab session 3' },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects out-of-order sample timestamps with a field-level path', () => {
    const session = validSession({
      samples: [validSample({ timestampMs: 20 }), validSample({ timestampMs: 10 })],
    });
    const result = validateContract(SessionSchema, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('samples.1.timestampMs');
      expect(result.issues[0]?.message).toContain('ordered');
    }
  });

  it('accepts equal consecutive timestamps (left/right sampled in the same tick)', () => {
    const session = validSession({
      samples: [validSample({ timestampMs: 10 }), validSample({ timestampMs: 10, foot: 'right' })],
    });
    expect(validateContract(SessionSchema, session).ok).toBe(true);
  });

  it.each([
    ['empty samples array', validSession({ samples: [] })],
    ['missing sessionId', (() => { const s = validSession(); delete (s as Record<string, unknown>).sessionId; return s; })()],
    ['non-uuid sessionId', validSession({ sessionId: 'not-a-uuid' })],
    ['wrong schemaVersion', validSession({ schemaVersion: 2 })],
    ['empty labels.conditions', validSession({ labels: { conditions: [] } })],
  ])('rejects %s', (_name, payload) => {
    expect(validateContract(SessionSchema, payload).ok).toBe(false);
  });

  it('has no athlete-identity field: a smuggled athleteId is stripped, never parsed (Req. 16)', () => {
    const result = validateContract(SessionSchema, validSession({ athleteId: 'someone-else' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('athleteId' in result.data).toBe(false);
    }
  });

  it('rejects embedded onPhoneInsights whose sessionId does not match the session', () => {
    const result = validateContract(
      SessionSchema,
      validSession({
        onPhoneInsights: validInsightSet({ sessionId: '00000000-0000-4000-8000-000000000000' }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('onPhoneInsights.sessionId');
    }
  });

  it('accepts embedded onPhoneInsights with a matching sessionId', () => {
    const result = validateContract(SessionSchema, validSession({ onPhoneInsights: validInsightSet() }));
    expect(result.ok).toBe(true);
  });
});
