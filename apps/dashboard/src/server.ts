import Fastify, { FastifyInstance } from 'fastify';
import {
  resolveIdentity,
  SharingStore,
  TokenVerifier,
  UserDirectory,
} from '@smart-sneaker/ingest-api';
import type { SessionResultQuery } from './ports';
import { registerAthleteRoutes } from './routes/athlete';
import { registerCoachRoutes } from './routes/coach';
import { DASHBOARD_PAGE_HTML } from './web/page';

// The `request.identity` fastify augmentation is declared by
// @smart-sneaker/ingest-api's server module and applies here too — the
// dashboard reuses the whole auth layer rather than growing a second one.

export interface DashboardDeps {
  tokenVerifier: TokenVerifier;
  userDirectory: UserDirectory;
  sharingStore: SharingStore;
  resultQuery: SessionResultQuery;
  logger?: boolean;
}

/** Routes serving static, data-free content — everything else requires a verified identity. */
const UNAUTHENTICATED_ROUTES = new Set(['/healthz', '/']);

/**
 * Assemble the dashboard against injected ports — production wiring binds
 * Firebase/Firestore adapters (see main.ts), tests bind fakes. The HTML shell
 * at `/` is public (it contains no data, like a login page); every data route
 * resolves and enforces identity server-side (Req. 19-20, Security NFR).
 */
export function buildDashboardServer(deps: DashboardDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.decorateRequest('identity');

  app.addHook('preHandler', async (request) => {
    if (UNAUTHENTICATED_ROUTES.has(request.routeOptions.url ?? '')) return;
    request.identity = await resolveIdentity(
      request.headers.authorization,
      deps.tokenVerifier,
      deps.userDirectory,
    );
  });

  app.setErrorHandler((error, request, reply) => {
    // Domain errors carry their own status; everything else is sanitized so
    // internals never leak to callers (Security NFR / user-facing error bar).
    const { statusCode: rawStatus, message } = error as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof rawStatus === 'number' && rawStatus >= 400 ? rawStatus : 500;
    if (statusCode >= 500) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Something went wrong on our side — please retry.' });
    }
    return reply
      .status(statusCode)
      .send({ error: typeof message === 'string' ? message : 'Request failed.' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/', async (_request, reply) => {
    return reply.header('content-type', 'text/html; charset=utf-8').send(DASHBOARD_PAGE_HTML);
  });

  app.get('/v1/me', async (request) => ({
    userId: request.identity.userId,
    role: request.identity.role,
  }));

  registerAthleteRoutes(app, {
    sharingStore: deps.sharingStore,
    resultQuery: deps.resultQuery,
  });
  registerCoachRoutes(app, { sharingStore: deps.sharingStore });

  return app;
}
