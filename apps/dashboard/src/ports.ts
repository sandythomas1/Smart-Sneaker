import type { SessionResult } from '@smart-sneaker/data-contracts';

/**
 * Ports for the dashboard's read side (Req. 19-20). The dashboard reads the
 * session worker's authoritative results (SessionResult contract) — it never
 * recomputes insights and never reads the client's provisional ones.
 * Production binds a Firestore adapter, tests bind the in-memory one.
 */
export interface SessionResultQuery {
  /** The authoritative result for one session, or null if none exists yet. */
  getBySessionId(sessionId: string): Promise<SessionResult | null>;
  /** All authoritative results owned by one athlete. */
  listByAthlete(athleteId: string): Promise<SessionResult[]>;
}
