import { SessionReceivedEventSchema, validateContract } from '../src';

const validEvent = () => ({
  sessionId: '7f9b2c64-1d3e-4a5b-9c8d-2e1f0a3b4c5d',
  ownerAthleteId: 'athlete-1',
  blobPath: 'raw-sessions/athlete-1/7f9b2c64-1d3e-4a5b-9c8d-2e1f0a3b4c5d.json',
  correlationId: '0b8f8f6a-3c2d-4e1f-9a7b-5c6d7e8f9a0b',
});

describe('SessionReceivedEventSchema (ingest → worker contract)', () => {
  it('accepts the event shape the ingest API publishes', () => {
    expect(validateContract(SessionReceivedEventSchema, validEvent()).ok).toBe(true);
  });

  it.each([
    ['non-uuid sessionId', { ...validEvent(), sessionId: '123' }],
    ['malformed ownerAthleteId', { ...validEvent(), ownerAthleteId: 'a/b' }],
    ['blobPath with traversal segment', { ...validEvent(), blobPath: 'raw-sessions/../secrets.json' }],
    ['absolute blobPath', { ...validEvent(), blobPath: '/etc/passwd' }],
    ['blobPath with unsafe characters', { ...validEvent(), blobPath: 'raw-sessions/a%00b.json' }],
    ['missing correlationId', (() => { const e: Record<string, unknown> = validEvent(); delete e.correlationId; return e; })()],
  ])('rejects %s', (_name, payload) => {
    expect(validateContract(SessionReceivedEventSchema, payload).ok).toBe(false);
  });
});
