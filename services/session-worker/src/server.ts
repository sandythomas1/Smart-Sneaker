import Fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateContract } from '@smart-sneaker/data-contracts';
import { processSessionEvent, ProcessSessionDeps, SessionBlobMissingError } from './process-session';

/**
 * Pub/Sub push delivery envelope (the parts we consume). The event itself is
 * base64-encoded JSON inside message.data.
 */
const PubSubPushSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().optional(),
  }),
  subscription: z.string().optional(),
});

export interface WorkerServerDeps extends ProcessSessionDeps {
  logger?: boolean;
}

/**
 * HTTP wrapper for Pub/Sub push delivery. Response codes drive redelivery:
 * 2xx acknowledges; 5xx makes Pub/Sub retry. Permanently bad input (an
 * undecodable envelope, an event failing schema validation) is ACKNOWLEDGED
 * after logging — retrying a poison message forever helps no one; the
 * subscription's dead-letter topic is the backstop.
 *
 * Caller authentication is Cloud Run IAM: the service deploys with
 * --no-allow-unauthenticated and only the push subscription's service
 * account holds run.invoker, so requests reaching this handler have already
 * passed Google's OIDC check at the platform layer.
 */
export function buildWorkerServer(deps: WorkerServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post('/pubsub/sessions', async (request, reply) => {
    const envelope = validateContract(PubSubPushSchema, request.body);
    if (!envelope.ok) {
      request.log.warn({ issues: envelope.issues }, 'dropping malformed push envelope');
      return reply.status(204).send();
    }

    let event: unknown;
    try {
      event = JSON.parse(Buffer.from(envelope.data.message.data, 'base64').toString('utf8'));
    } catch {
      request.log.warn('dropping push message with undecodable payload');
      return reply.status(204).send();
    }

    try {
      const result = await processSessionEvent(event, deps);
      if (result.outcome === 'rejected-event') {
        request.log.warn({ issues: result.issues }, 'dropping event that failed contract validation');
      } else {
        request.log.info({ outcome: result.outcome }, 'session event handled');
      }
      return reply.status(204).send();
    } catch (error) {
      // Transient (missing blob, store outage): 5xx → Pub/Sub redelivers.
      const level = error instanceof SessionBlobMissingError ? 'warn' : 'error';
      request.log[level](error);
      return reply.status(503).send({ error: 'processing failed; delivery will be retried' });
    }
  });

  return app;
}
