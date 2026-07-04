import { InsightResultSchema, InsightSetSchema, validateContract } from '../src';
import { validInsightResult, validInsightSet } from './fixtures';

describe('InsightResultSchema', () => {
  it('accepts a numeric insight with confidence (Req. 10-11)', () => {
    expect(validateContract(InsightResultSchema, validInsightResult()).ok).toBe(true);
  });

  it('accepts a categorical insight (foot-strike type)', () => {
    const result = validateContract(
      InsightResultSchema,
      validInsightResult({ kind: 'foot_strike', value: 'midfoot', unit: undefined }),
    );
    expect(result.ok).toBe(true);
  });

  it('can express an unreliable insight instead of omitting it (Req. 11)', () => {
    const result = validateContract(
      InsightResultSchema,
      validInsightResult({ confidence: 0.2, reliable: false, note: 'too few clean gait cycles' }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ['confidence above 1', validInsightResult({ confidence: 1.2 })],
    ['negative confidence', validInsightResult({ confidence: -0.1 })],
    ['missing confidence', (() => { const i = validInsightResult(); delete (i as Record<string, unknown>).confidence; return i; })()],
    ['missing reliable flag', (() => { const i = validInsightResult(); delete (i as Record<string, unknown>).reliable; return i; })()],
    ['empty kind', validInsightResult({ kind: '' })],
    ['empty string value', validInsightResult({ value: '' })],
  ])('rejects %s', (_name, payload) => {
    expect(validateContract(InsightResultSchema, payload).ok).toBe(false);
  });
});

describe('InsightSetSchema', () => {
  it('accepts a valid on-phone insight set', () => {
    expect(validateContract(InsightSetSchema, validInsightSet()).ok).toBe(true);
  });

  it('accepts a cloud-worker insight set (authoritative source, Req. 17)', () => {
    expect(validateContract(InsightSetSchema, validInsightSet({ computedBy: 'cloud-worker' })).ok).toBe(true);
  });

  it.each([
    ['unknown computedBy', validInsightSet({ computedBy: 'on-shoe' })],
    ['empty insights array', validInsightSet({ insights: [] })],
    ['non-uuid sessionId', validInsightSet({ sessionId: '123' })],
  ])('rejects %s', (_name, payload) => {
    expect(validateContract(InsightSetSchema, payload).ok).toBe(false);
  });
});
