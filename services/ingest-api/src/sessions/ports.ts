import type { SessionLabels, SessionReceivedEvent } from '@smart-sneaker/data-contracts';

/**
 * Ports for the session ingest pipeline (Req. 14). The route logic depends on
 * these interfaces only; production binds Cloud Storage / Firestore / Pub/Sub
 * adapters, tests bind the in-memory implementations.
 */

/** Metadata persisted per accepted session. Ownership is set server-side from the auth token — never from the payload (Req. 16). */
export interface StoredSessionRecord {
  sessionId: string;
  ownerAthleteId: string;
  sportProfileId: string;
  startedAtMs: number;
  sampleCount: number;
  /** Where the raw session blob lives (Req. 22: raw data is retained). */
  blobPath: string;
  receivedAtMs: number;
  /** Traces this session across upload → event → worker (Observability NFR). */
  correlationId: string;
  /** True when the upload carried labels — the queryable flag the labeled
   * dataset store (T13) filters on, so finding training sessions never means
   * reading every raw blob. */
  hasLabels: boolean;
  /** The labels themselves, copied from the session at ingest (Req. 8). */
  labels?: SessionLabels;
}

export type CreateRecordResult =
  | { created: true }
  | { created: false; existing: StoredSessionRecord };

export interface SessionRecordStore {
  /**
   * Atomically create the record unless one already exists for this session
   * ID — the idempotency commit point for Req. 18's ingest half.
   */
  createIfAbsent(record: StoredSessionRecord): Promise<CreateRecordResult>;
}

export interface SessionBlobStore {
  /** Durably store the raw session JSON at the given path. Overwriting the same path with the same session is harmless. */
  put(path: string, contentJson: string): Promise<void>;
}

/** The session-processing event consumed by the worker (T7). Contract lives in data-contracts; re-exported for local convenience. */
export type { SessionReceivedEvent };

export interface SessionEventPublisher {
  publishSessionReceived(event: SessionReceivedEvent): Promise<void>;
}
