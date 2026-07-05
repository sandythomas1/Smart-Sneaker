import type { Session, SessionReceivedEvent } from '@smart-sneaker/data-contracts';
import { generateSyntheticRun } from '../../../packages/insights-engine/test/fixtures/synthetic';
import { InMemoryAuthoritativeResultStore, InMemorySessionBlobReader } from '../src/in-memory-adapters';
import { ProcessSessionDeps } from '../src/process-session';

export const OWNER_ID = 'athlete-1';
export const CORRELATION_ID = '0b8f8f6a-3c2d-4e1f-9a7b-5c6d7e8f9a0b';

/** A clean synthetic run that segments well — same shape the engine's own tests use. */
export function syntheticSession(): Session {
  return generateSyntheticRun({
    durationMs: 10_000,
    strideIntervalMs: 700,
    contactMs: 200,
    sampleIntervalMs: 10,
    rightFootOffsetMs: 350,
  }).session;
}

export function eventFor(session: Session): SessionReceivedEvent {
  return {
    sessionId: session.sessionId,
    ownerAthleteId: OWNER_ID,
    blobPath: `raw-sessions/${OWNER_ID}/${session.sessionId}.json`,
    correlationId: CORRELATION_ID,
  };
}

export interface WorkerHarness {
  deps: ProcessSessionDeps;
  blobs: InMemorySessionBlobReader;
  results: InMemoryAuthoritativeResultStore;
}

/** Deps with the session already stored at the event's blob path. */
export function harnessWithSession(session: Session): WorkerHarness {
  const blobs = new InMemorySessionBlobReader();
  const results = new InMemoryAuthoritativeResultStore();
  blobs.blobs.set(eventFor(session).blobPath, JSON.stringify(session));
  return { deps: { blobReader: blobs, resultStore: results, nowMs: () => 1_750_000_100_000 }, blobs, results };
}
