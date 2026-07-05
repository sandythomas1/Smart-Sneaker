import {
  AuthoritativeResultStore,
  CreateResultOutcome,
  SessionBlobReader,
  StoredAuthoritativeResult,
} from './ports';

/** In-memory SessionBlobReader for unit tests and local development. */
export class InMemorySessionBlobReader implements SessionBlobReader {
  readonly blobs = new Map<string, string>();

  async get(path: string): Promise<string | null> {
    return this.blobs.get(path) ?? null;
  }
}

/** In-memory AuthoritativeResultStore for unit tests and local development. */
export class InMemoryAuthoritativeResultStore implements AuthoritativeResultStore {
  readonly results = new Map<string, StoredAuthoritativeResult>();

  async createIfAbsent(result: StoredAuthoritativeResult): Promise<CreateResultOutcome> {
    const existing = this.results.get(result.sessionId);
    if (existing) {
      return { created: false, existing };
    }
    this.results.set(result.sessionId, result);
    return { created: true };
  }
}
