import type { PubSub } from '@google-cloud/pubsub';
import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import {
  CreateRecordResult,
  SessionBlobStore,
  SessionEventPublisher,
  SessionReceivedEvent,
  SessionRecordStore,
  StoredSessionRecord,
} from './ports';

/**
 * Production adapters, kept deliberately thin: all decision logic lives in
 * the route/service layer against the ports, so these only translate calls.
 * Firestore document layout: sessions/{sessionId} → StoredSessionRecord.
 */

const SESSIONS = 'sessions';
/** gRPC status code Firestore uses when `create()` hits an existing document. */
const ALREADY_EXISTS = 6;

export class FirestoreSessionRecordStore implements SessionRecordStore {
  constructor(private readonly db: Firestore) {}

  async createIfAbsent(record: StoredSessionRecord): Promise<CreateRecordResult> {
    const doc = this.db.collection(SESSIONS).doc(record.sessionId);
    try {
      await doc.create(record); // atomic create-or-fail — the idempotency guarantee (Req. 18)
      return { created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== ALREADY_EXISTS) {
        throw error;
      }
      const existing = (await doc.get()).data() as StoredSessionRecord | undefined;
      if (!existing) {
        throw new Error(`session ${record.sessionId} exists but its record could not be read`);
      }
      return { created: false, existing };
    }
  }
}

export class GcsSessionBlobStore implements SessionBlobStore {
  constructor(private readonly bucket: Bucket) {}

  async put(path: string, contentJson: string): Promise<void> {
    await this.bucket.file(path).save(contentJson, {
      contentType: 'application/json',
      resumable: false,
    });
  }
}

export class PubSubSessionEventPublisher implements SessionEventPublisher {
  constructor(
    private readonly pubsub: PubSub,
    private readonly topicName: string,
  ) {}

  async publishSessionReceived(event: SessionReceivedEvent): Promise<void> {
    await this.pubsub.topic(this.topicName).publishMessage({ json: event });
  }
}
