import type { SessionResult } from '@smart-sneaker/data-contracts';
import type { SessionResultQuery } from './ports';

/** In-memory SessionResultQuery for unit tests and local development. */
export class InMemorySessionResultQuery implements SessionResultQuery {
  readonly results = new Map<string, SessionResult>();

  add(result: SessionResult): void {
    this.results.set(result.sessionId, result);
  }

  async getBySessionId(sessionId: string): Promise<SessionResult | null> {
    return this.results.get(sessionId) ?? null;
  }

  async listByAthlete(athleteId: string): Promise<SessionResult[]> {
    return [...this.results.values()].filter((r) => r.ownerAthleteId === athleteId);
  }
}
