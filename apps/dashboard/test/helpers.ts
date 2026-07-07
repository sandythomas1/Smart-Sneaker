import { randomUUID } from 'node:crypto';
import type { InsightSet, SessionResult } from '@smart-sneaker/data-contracts';
import {
  InMemorySharingStore,
  InMemoryUserDirectory,
  TokenVerifier,
} from '@smart-sneaker/ingest-api';
import { InMemorySessionResultQuery } from '../src/in-memory-adapters';
import { buildDashboardServer } from '../src/server';

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
  app: ReturnType<typeof buildDashboardServer>;
  users: InMemoryUserDirectory;
  sharing: InMemorySharingStore;
  results: InMemorySessionResultQuery;
}

export function buildTestHarness(tokens: Record<string, string>): TestHarness {
  const users = new InMemoryUserDirectory();
  const sharing = new InMemorySharingStore();
  const results = new InMemorySessionResultQuery();
  const app = buildDashboardServer({
    tokenVerifier: new FakeTokenVerifier(tokens),
    userDirectory: users,
    sharingStore: sharing,
    resultQuery: results,
  });
  return { app, users, sharing, results };
}

/** A worker-shaped InsightSet with all four running insights. */
export function workerInsightSet(sessionId: string, overrides: Partial<InsightSet> = {}): InsightSet {
  return {
    sessionId,
    sportProfileId: 'running-v1',
    computedBy: 'cloud-worker',
    engineVersion: '0.1.0',
    computedAtMs: 1_750_000_100_000,
    insights: [
      { kind: 'pressure_balance', value: 52.3, unit: '% left', confidence: 0.9, reliable: true },
      { kind: 'ground_contact_time', foot: 'left', value: 210, unit: 'ms', confidence: 0.9, reliable: true },
      { kind: 'ground_contact_time', foot: 'right', value: 205, unit: 'ms', confidence: 0.9, reliable: true },
      { kind: 'cadence', value: 171.4, unit: 'steps/min', confidence: 0.9, reliable: true },
      { kind: 'foot_strike', value: 'heel', confidence: 0.85, reliable: true },
    ],
    ...overrides,
  };
}

export interface ProcessedResultInput {
  ownerAthleteId: string;
  sessionId?: string;
  sessionStartedAtMs?: number;
  insights?: InsightSet;
  flaggedForReview?: boolean;
}

/** A processed authoritative result, as the session worker (T7) persists it. */
export function processedResult(input: ProcessedResultInput): SessionResult {
  const sessionId = input.sessionId ?? randomUUID();
  const result: SessionResult = {
    sessionId,
    ownerAthleteId: input.ownerAthleteId,
    correlationId: randomUUID(),
    status: 'processed',
    insights: input.insights ?? workerInsightSet(sessionId),
    flaggedForReview: input.flaggedForReview ?? false,
    processedAtMs: 1_750_000_200_000,
  };
  if (input.sessionStartedAtMs !== undefined) {
    result.sessionStartedAtMs = input.sessionStartedAtMs;
  }
  return result;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
