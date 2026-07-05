import type { FastifyInstance } from 'fastify';
import { UserDirectory } from '../auth/identity';
import { grantSharing, revokeSharing, SharingStore } from '../auth/sharing';

export interface SharingRouteDeps {
  userDirectory: UserDirectory;
  sharingStore: SharingStore;
}

/**
 * Sharing management (Req. 20). The athlete manages access to their own data;
 * the athlete in question is always the authenticated caller — there is no
 * route to modify another user's grants.
 */
export function registerSharingRoutes(app: FastifyInstance, deps: SharingRouteDeps): void {
  app.put<{ Params: { coachId: string } }>('/v1/sharing/coaches/:coachId', async (request, reply) => {
    await grantSharing(request.identity, request.params.coachId, deps.userDirectory, deps.sharingStore);
    return reply.status(204).send();
  });

  app.delete<{ Params: { coachId: string } }>('/v1/sharing/coaches/:coachId', async (request, reply) => {
    await revokeSharing(request.identity, request.params.coachId, deps.sharingStore);
    return reply.status(204).send();
  });
}
