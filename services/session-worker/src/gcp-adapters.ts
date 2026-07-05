import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import {
  AuthoritativeResultStore,
  CreateResultOutcome,
  SessionBlobReader,
  StoredAuthoritativeResult,
} from './ports';

/**
 * Production adapters, kept deliberately thin: all decision logic lives in
 * process-session.ts against the ports. Firestore document layout:
 * sessionResults/{sessionId} → StoredAuthoritativeResult.
 */

const SESSION_RESULTS = 'sessionResults';
/** gRPC status code Firestore uses when `create()` hits an existing document. */
const ALREADY_EXISTS = 6;
/** gRPC-style code GCS surfaces for a missing object. */
const NOT_FOUND = 404;

export class GcsSessionBlobReader implements SessionBlobReader {
  constructor(private readonly bucket: Bucket) {}

  async get(path: string): Promise<string | null> {
    try {
      const [contents] = await this.bucket.file(path).download();
      return contents.toString('utf8');
    } catch (error) {
      if ((error as { code?: number }).code === NOT_FOUND) {
        return null;
      }
      throw error;
    }
  }
}

export class FirestoreAuthoritativeResultStore implements AuthoritativeResultStore {
  constructor(private readonly db: Firestore) {}

  async createIfAbsent(result: StoredAuthoritativeResult): Promise<CreateResultOutcome> {
    const doc = this.db.collection(SESSION_RESULTS).doc(result.sessionId);
    try {
      await doc.create(result); // atomic create-or-fail — the idempotency guarantee (Req. 18)
      return { created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) {
        throw error;
      }
      const existing = (await doc.get()).data() as StoredAuthoritativeResult | undefined;
      if (!existing) {
        throw new Error(`result for session ${result.sessionId} exists but could not be read`);
      }
      return { created: false, existing };
    }
  }
}
