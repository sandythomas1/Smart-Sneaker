import { SessionSchema, validateContract } from '../src';
import { validSession } from './fixtures';

describe('validateContract', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not a session'],
    ['a number', 42],
    ['an empty object', {}],
    ['an array', [validSession()]],
  ])('returns field-level issues for %s instead of throwing', (_name, input) => {
    const result = validateContract(SessionSchema, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      for (const issue of result.issues) {
        expect(typeof issue.path).toBe('string');
        expect(issue.path.length).toBeGreaterThan(0);
        expect(typeof issue.message).toBe('string');
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('names every missing required field for an empty object', () => {
    const result = validateContract(SessionSchema, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toEqual(
        expect.arrayContaining(['schemaVersion', 'sessionId', 'sportProfileId', 'startedAtMs', 'samples']),
      );
    }
  });

  it('reports nested paths dot-joined (descriptive, not generic)', () => {
    const session = validSession();
    (session.samples as Record<string, unknown>[])[1]!.foot = 'wrong';
    const result = validateContract(SessionSchema, session);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('samples.1.foot');
    }
  });

  it('uses "(root)" for top-level type mismatches', () => {
    const result = validateContract(SessionSchema, 'garbage');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('(root)');
    }
  });
});
