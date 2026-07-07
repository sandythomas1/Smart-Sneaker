import type { Session } from '@smart-sneaker/data-contracts';

/**
 * Local persistence for recorded sessions (Req. 5): a session lives here from
 * the moment recording ends until the server confirms receipt — `remove` is
 * for the sync layer (T11) to call after a confirmed upload, never before.
 * Production binds a React Native storage adapter (added with T11's sync
 * lifecycle); tests and development use the in-memory store.
 */
export interface LocalSessionStore {
  save(session: Session): Promise<void>;
  get(sessionId: string): Promise<Session | null>;
  /** All locally-held sessions, oldest first by session start. */
  list(): Promise<Session[]>;
  remove(sessionId: string): Promise<void>;
}

/** In-memory LocalSessionStore for unit tests and local development. */
export class InMemoryLocalSessionStore implements LocalSessionStore {
  private readonly sessions = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async list(): Promise<Session[]> {
    return [...this.sessions.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  }

  async remove(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}
