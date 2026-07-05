import {
  CreateRecordResult,
  SessionBlobStore,
  SessionEventPublisher,
  SessionReceivedEvent,
  SessionRecordStore,
  StoredSessionRecord,
} from './ports';

/** In-memory SessionRecordStore for unit tests and local development. */
export class InMemorySessionRecordStore implements SessionRecordStore {
  readonly records = new Map<string, StoredSessionRecord>();

  async createIfAbsent(record: StoredSessionRecord): Promise<CreateRecordResult> {
    const existing = this.records.get(record.sessionId);
    if (existing) {
      return { created: false, existing };
    }
    this.records.set(record.sessionId, record);
    return { created: true };
  }
}

/** In-memory SessionBlobStore for unit tests and local development. */
export class InMemorySessionBlobStore implements SessionBlobStore {
  readonly blobs = new Map<string, string>();

  async put(path: string, contentJson: string): Promise<void> {
    this.blobs.set(path, contentJson);
  }
}

/** In-memory SessionEventPublisher that records published events for assertions. */
export class InMemorySessionEventPublisher implements SessionEventPublisher {
  readonly published: SessionReceivedEvent[] = [];

  async publishSessionReceived(event: SessionReceivedEvent): Promise<void> {
    this.published.push(event);
  }
}
