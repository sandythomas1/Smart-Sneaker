import type {
  ConsistencyReport,
  InsightComparison,
  SessionResult,
} from '@smart-sneaker/data-contracts';

/**
 * Ports for the session worker (Req. 17-18). The processing logic depends on
 * these interfaces only; production binds Cloud Storage / Firestore adapters,
 * tests bind the in-memory implementations.
 *
 * The result/consistency shapes live in data-contracts (SessionResultSchema):
 * the worker writes them and the dashboard reads them, so the contract crosses
 * a service boundary. Local aliases keep this service's vocabulary
 * ("authoritative result") intact.
 */

export interface SessionBlobReader {
  /** Raw session JSON at the given path, or null if no such blob exists. */
  get(path: string): Promise<string | null>;
}

export type { ConsistencyReport, InsightComparison };

/** The authoritative processing outcome for one session (Req. 17) — what the dashboard reads. */
export type StoredAuthoritativeResult = SessionResult;

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
