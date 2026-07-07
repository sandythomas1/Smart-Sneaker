import type { Firestore } from 'firebase-admin/firestore';
import { SessionResult, SessionResultSchema, validateContract } from '@smart-sneaker/data-contracts';
import type { SessionResultQuery } from './ports';

/**
 * Firestore adapter over the worker's results collection
 * (sessionResults/{sessionId} → SessionResult, see session-worker's
 * gcp-adapters). Every document is validated against the shared contract
 * before it is served: the dashboard treats the store as a boundary, not as
 * implicitly trusted state.
 */

const SESSION_RESULTS = 'sessionResults';

export type WarnLogger = (message: string, context: Record<string, unknown>) => void;

export class FirestoreSessionResultQuery implements SessionResultQuery {
  constructor(
    private readonly db: Firestore,
    /** Where contract-invalid documents get reported. */
    private readonly warn: WarnLogger = () => {},
  ) {}

  async getBySessionId(sessionId: string): Promise<SessionResult | null> {
    const snapshot = await this.db.collection(SESSION_RESULTS).doc(sessionId).get();
    if (!snapshot.exists) {
      return null;
    }
    const validation = validateContract(SessionResultSchema, snapshot.data());
    if (!validation.ok) {
      // A single unreadable document must fail loudly for its own session…
      throw new Error(`session result ${sessionId} failed contract validation`);
    }
    return validation.data;
  }

  async listByAthlete(athleteId: string): Promise<SessionResult[]> {
    const snapshot = await this.db
      .collection(SESSION_RESULTS)
      .where('ownerAthleteId', '==', athleteId)
      .get();
    const results: SessionResult[] = [];
    for (const doc of snapshot.docs) {
      const validation = validateContract(SessionResultSchema, doc.data());
      if (validation.ok) {
        results.push(validation.data);
      } else {
        // …but one corrupt document must not take down an athlete's whole
        // trend view (Resilience NFR: degraded beats total failure).
        this.warn('skipping contract-invalid session result', {
          sessionId: doc.id,
          issues: validation.issues,
        });
      }
    }
    return results;
  }
}
