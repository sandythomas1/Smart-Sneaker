import Fastify, { FastifyInstance } from 'fastify';
import { AuthenticatedUser, resolveIdentity, TokenVerifier, UserDirectory } from './auth/identity';
import { SharingStore } from './auth/sharing';
import { RateLimiter } from './rate-limit';
import { registerSessionRoutes } from './routes/sessions';
import { registerSharingRoutes } from './routes/sharing';
import { SessionBlobStore, SessionEventPublisher, SessionRecordStore } from './sessions/ports';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth hook on every request. Routes can rely on it existing. */
    identity: AuthenticatedUser;
  }
}

export interface IngestApiDeps {
  tokenVerifier: TokenVerifier;
  userDirectory: UserDirectory;
  sharingStore: SharingStore;
  sessionRecordStore: SessionRecordStore;
  sessionBlobStore: SessionBlobStore;
  sessionEventPublisher: SessionEventPublisher;
  rateLimiter: RateLimiter;
  /** Hard byte cap on request bodies (Req. 15's size bound). */
  maxBodyBytes?: number;
  logger?: boolean;
}

/** Upper bound on an uploaded session body. Roughly MAX_SESSION_SAMPLES at typical JSON sample size. */
export const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024;

/**
 * Assemble the ingest API against injected ports — production wiring binds
 * Firebase/GCP adapters (see main.ts), tests bind fakes. Every route is
 * behind authentication; there are deliberately no anonymous endpoints
 * except the health check.
 */
export function buildServer(deps: IngestApiDeps): FastifyInstance {
  const app = Fastify({
    bodyLimit: deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    logger: deps.logger ?? false,
  });

  app.decorateRequest('identity');

  // Authenticate everything except the unauthenticated liveness probe.
  app.addHook('preHandler', async (request) => {
    if (request.routeOptions.url === '/healthz') return;
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
    if (statusCode === 413) {
      return reply.status(413).send({
        error: 'The uploaded session is too large. Record shorter sessions or update the app.',
      });
    }
    return reply
      .status(statusCode)
      .send({ error: typeof message === 'string' ? message : 'Request failed.' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  registerSharingRoutes(app, {
    userDirectory: deps.userDirectory,
    sharingStore: deps.sharingStore,
  });
  registerSessionRoutes(app, {
    recordStore: deps.sessionRecordStore,
    blobStore: deps.sessionBlobStore,
    eventPublisher: deps.sessionEventPublisher,
    rateLimiter: deps.rateLimiter,
  });

  return app;
}
