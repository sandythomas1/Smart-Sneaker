import type { Session } from '@smart-sneaker/data-contracts';
import { InMemorySharingStore, InMemoryUserDirectory } from '../src/auth/in-memory-stores';
import { TokenVerifier } from '../src/auth/identity';
import { AllowAllRateLimiter, RateLimiter } from '../src/rate-limit';
import { buildServer, IngestApiDeps } from '../src/server';
import {
  InMemorySessionBlobStore,
  InMemorySessionEventPublisher,
  InMemorySessionRecordStore,
} from '../src/sessions/in-memory-adapters';

/** Maps literal bearer tokens to uids; anything else is rejected — a stand-in for Firebase verification. */
export class FakeTokenVerifier implements TokenVerifier {
  constructor(private readonly tokens: Record<string, string>) {}

  async verifyIdToken(idToken: string): Promise<{ uid: string }> {
    const uid = this.tokens[idToken];
    if (!uid) {
      throw new Error('token rejected by verifier');
    }
    return { uid };
  }
}

export interface TestHarness {
  app: ReturnType<typeof buildServer>;
  users: InMemoryUserDirectory;
  sharing: InMemorySharingStore;
  records: InMemorySessionRecordStore;
  blobs: InMemorySessionBlobStore;
  events: InMemorySessionEventPublisher;
}

export function buildTestHarness(
  tokens: Record<string, string>,
  overrides: Partial<Pick<IngestApiDeps, 'maxBodyBytes'>> & { rateLimiter?: RateLimiter } = {},
): TestHarness {
  const users = new InMemoryUserDirectory();
  const sharing = new InMemorySharingStore();
  const records = new InMemorySessionRecordStore();
  const blobs = new InMemorySessionBlobStore();
  const events = new InMemorySessionEventPublisher();
  const app = buildServer({
    tokenVerifier: new FakeTokenVerifier(tokens),
    userDirectory: users,
    sharingStore: sharing,
    sessionRecordStore: records,
    sessionBlobStore: blobs,
    sessionEventPublisher: events,
    rateLimiter: overrides.rateLimiter ?? new AllowAllRateLimiter(),
    ...(overrides.maxBodyBytes !== undefined ? { maxBodyBytes: overrides.maxBodyBytes } : {}),
  });
  return { app, users, sharing, records, blobs, events };
}

/** A minimal contract-valid session upload. */
export function validSessionPayload(overrides: Partial<Session> = {}): Session {
  return {
    schemaVersion: 1,
    sessionId: '7f9b2c64-1d3e-4a5b-9c8d-2e1f0a3b4c5d',
    sportProfileId: 'running-v1',
    startedAtMs: 1_750_000_000_000,
    samples: [
      {
        timestampMs: 0,
        foot: 'left',
        pressure: [1, 2, 3, 4],
        imu: { accel: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } },
      },
      {
        timestampMs: 10,
        foot: 'right',
        pressure: [1, 2, 3, 4],
        imu: { accel: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } },
      },
    ],
    ...overrides,
  };
}
