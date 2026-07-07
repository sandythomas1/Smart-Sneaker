import type { FastifyInstance } from 'fastify';
import { SessionResult, UserIdSchema } from '@smart-sneaker/data-contracts';
import { z } from 'zod';
import {
  assertCanAccessAthleteData,
  AuthenticatedUser,
  InvalidRequestError,
  SharingStore,
} from '@smart-sneaker/ingest-api';
import type { SessionResultQuery } from '../ports';
import { buildTrends } from '../trends';

export interface AthleteRouteDeps {
  sharingStore: SharingStore;
  resultQuery: SessionResultQuery;
}

const SessionIdSchema = z.uuid();

/** Result not found *or* not visible to this caller — one indistinguishable 404, so the route never confirms another athlete's session IDs. */
class SessionNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('session not found');
    this.name = 'SessionNotFoundError';
  }
}

/** Compact listing entry; the full result (insights, consistency) comes from the per-session route. */
interface SessionSummary {
  sessionId: string;
  status: SessionResult['status'];
  flaggedForReview: boolean;
  processedAtMs: number;
  sessionStartedAtMs?: number;
  sportProfileId?: string;
}

function toSummary(result: SessionResult): SessionSummary {
  const summary: SessionSummary = {
    sessionId: result.sessionId,
    status: result.status,
    flaggedForReview: result.flaggedForReview,
    processedAtMs: result.processedAtMs,
  };
  if (result.sessionStartedAtMs !== undefined) summary.sessionStartedAtMs = result.sessionStartedAtMs;
  if (result.insights) summary.sportProfileId = result.insights.sportProfileId;
  return summary;
}

/**
 * Athlete data reads (Req. 19-20). Every route revalidates access server-side
 * via THE access rule (owner, or explicitly-shared coach) before touching the
 * store — the UI hiding a link is never the security boundary.
 */
export function registerAthleteRoutes(app: FastifyInstance, deps: AthleteRouteDeps): void {
  /** Parse the athleteId path segment and enforce the access rule; everything below assumes it ran. */
  async function authorizeAthleteParam(
    identity: AuthenticatedUser,
    rawAthleteId: string,
  ): Promise<string> {
    if (!UserIdSchema.safeParse(rawAthleteId).success) {
      throw new InvalidRequestError('athleteId must be 1-128 characters of A-Za-z0-9_-');
    }
    await assertCanAccessAthleteData(identity, rawAthleteId, deps.sharingStore);
    return rawAthleteId;
  }

  app.get<{ Params: { athleteId: string } }>(
    '/v1/athletes/:athleteId/sessions',
    async (request) => {
      const athleteId = await authorizeAthleteParam(request.identity, request.params.athleteId);
      const results = await deps.resultQuery.listByAthlete(athleteId);
      const sessions = results
        .map(toSummary)
        .sort(
          (a, b) =>
            (b.sessionStartedAtMs ?? b.processedAtMs) - (a.sessionStartedAtMs ?? a.processedAtMs),
        );
      return { athleteId, sessions };
    },
  );

  app.get<{ Params: { athleteId: string; sessionId: string } }>(
    '/v1/athletes/:athleteId/sessions/:sessionId',
    async (request) => {
      const athleteId = await authorizeAthleteParam(request.identity, request.params.athleteId);
      if (!SessionIdSchema.safeParse(request.params.sessionId).success) {
        throw new InvalidRequestError('sessionId must be a UUID');
      }
      const result = await deps.resultQuery.getBySessionId(request.params.sessionId);
      // Owner check, not just existence: the access rule above authorized
      // `athleteId`, so a result belonging to anyone else must look absent
      // (IDOR defense in depth — Req. 16, 20).
      if (!result || result.ownerAthleteId !== athleteId) {
        throw new SessionNotFoundError();
      }
      return { result };
    },
  );

  app.get<{ Params: { athleteId: string } }>('/v1/athletes/:athleteId/trends', async (request) => {
    const athleteId = await authorizeAthleteParam(request.identity, request.params.athleteId);
    const results = await deps.resultQuery.listByAthlete(athleteId);
    return { athleteId, trends: buildTrends(results) };
  });
}
