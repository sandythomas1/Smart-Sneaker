import type { FastifyInstance } from 'fastify';
import { AccessDeniedError, SharingStore } from '@smart-sneaker/ingest-api';

export interface CoachRouteDeps {
  sharingStore: SharingStore;
}

/**
 * Coach roster (Req. 20): exactly the athletes who have explicitly shared with
 * the authenticated coach — resolved from the sharing grants, never from a
 * client-supplied list. Athlete data itself is then read through the athlete
 * routes, which re-check the grant per request.
 */
export function registerCoachRoutes(app: FastifyInstance, deps: CoachRouteDeps): void {
  app.get('/v1/coach/athletes', async (request) => {
    if (request.identity.role !== 'coach') {
      throw new AccessDeniedError('only coaches have a coaching roster');
    }
    const athleteIds = await deps.sharingStore.listAthleteIdsSharedWith(request.identity.userId);
    return { athletes: athleteIds.map((athleteId) => ({ athleteId })) };
  });
}
