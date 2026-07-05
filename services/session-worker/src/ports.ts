import type { Foot, InsightSet } from '@smart-sneaker/data-contracts';

/**
 * Ports for the session worker (Req. 17-18). The processing logic depends on
 * these interfaces only; production binds Cloud Storage / Firestore adapters,
 * tests bind the in-memory implementations.
 */

export interface SessionBlobReader {
  /** Raw session JSON at the given path, or null if no such blob exists. */
  get(path: string): Promise<string | null>;
}

/** One per-insight client/cloud comparison, keyed by (kind, foot) (Consistency NFR). */
export interface InsightComparison {
  kind: string;
  foot?: Foot;
  status: 'within-tolerance' | 'out-of-tolerance' | 'not-compared';
  workerValue: number | string;
  onPhoneValue?: number | string;
  /** |worker − phone| / |worker|, for numeric insights that were compared. */
  relativeDifference?: number;
  /** Why a pair was not compared (unreliable on either side, missing counterpart, type mismatch). */
  reason?: string;
}

export interface ConsistencyReport {
  workerEngineVersion: string;
  onPhoneEngineVersion: string;
  engineVersionMatch: boolean;
  comparisons: InsightComparison[];
  /** False if any compared insight exceeded its tolerance. */
  withinTolerance: boolean;
}

/**
 * The authoritative processing outcome for one session (Req. 17) — what the
 * dashboard reads instead of the client's provisional result. A failed
 * validation is persisted too, so redelivery stays idempotent and the failure
 * is visible rather than silently retried forever.
 */
export interface StoredAuthoritativeResult {
  sessionId: string;
  ownerAthleteId: string;
  correlationId: string;
  status: 'processed' | 'failed-validation';
  /** Present when status is 'processed'. */
  insights?: InsightSet;
  /** Present when the upload carried an on-phone result to compare against. */
  consistency?: ConsistencyReport;
  /** Present when status is 'failed-validation'. */
  failureReason?: string;
  /** True when the session needs human review (consistency out of tolerance). */
  flaggedForReview: boolean;
  processedAtMs: number;
}

export type CreateResultOutcome =
  | { created: true }
  | { created: false; existing: StoredAuthoritativeResult };

export interface AuthoritativeResultStore {
  /**
   * Atomically create the result unless one already exists for this session
   * ID — the idempotency commit point for Req. 18's worker half.
   */
  createIfAbsent(result: StoredAuthoritativeResult): Promise<CreateResultOutcome>;
}
