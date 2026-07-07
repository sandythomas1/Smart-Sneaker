import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SessionSchema, validateContract } from '@smart-sneaker/data-contracts';
import { RateLimiter } from '../rate-limit';
import {
  SessionBlobStore,
  SessionEventPublisher,
  SessionRecordStore,
  StoredSessionRecord,
} from '../sessions/ports';

export interface SessionRouteDeps {
  recordStore: SessionRecordStore;
  blobStore: SessionBlobStore;
  eventPublisher: SessionEventPublisher;
  rateLimiter: RateLimiter;
  nowMs?: () => number;
}

/**
 * Where a session's raw JSON lives in the blob store. Namespaced by owner so
 * two accounts uploading the same session ID can never touch each other's
 * blobs; both inputs are validated (auth-token uid, schema-checked uuid)
 * before this is built.
 */
function rawSessionBlobPath(ownerAthleteId: string, sessionId: string): string {
  return `raw-sessions/${ownerAthleteId}/${sessionId}.json`;
}

/**
 * POST /v1/sessions — the authenticated upload boundary (Req. 14-16, 18).
 *
 * Order of operations: validate → rate-limit → write blob → create record
 * (atomic; the idempotency commit point) → publish event. The event is also
 * re-published on duplicate uploads by the same owner, so a client retry
 * after a publish failure can never strand a stored session without an
 * event — the worker (T7) deduplicates redeliveries.
 */
export function registerSessionRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  const nowMs = deps.nowMs ?? Date.now;

  app.post('/v1/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = request.identity;

    if (!deps.rateLimiter.tryAcquire(identity.userId)) {
      return reply.status(429).send({
        error: 'Too many uploads right now — please wait a moment and try again.',
      });
    }

    // Req. 15: reject malformed payloads synchronously with field-level detail; never queue them.
    const validation = validateContract(SessionSchema, request.body);
    if (!validation.ok) {
      return reply.status(400).send({
        error: 'The uploaded session is not valid.',
        issues: validation.issues,
      });
    }
    const session = validation.data;

    // Req. 16: ownership comes from the verified token, never the payload.
    // (The Session contract has no athlete field at all; even a smuggled one
    // is stripped by schema parsing.)
    const record: StoredSessionRecord = {
      sessionId: session.sessionId,
      ownerAthleteId: identity.userId,
      sportProfileId: session.sportProfileId,
      startedAtMs: session.startedAtMs,
      sampleCount: session.samples.length,
      blobPath: rawSessionBlobPath(identity.userId, session.sessionId),
      receivedAtMs: nowMs(),
      correlationId: randomUUID(),
      hasLabels: session.labels !== undefined,
      // No undefined-valued keys: Firestore rejects them on create().
      ...(session.labels !== undefined ? { labels: session.labels } : {}),
    };

    // Blob first: a record only ever points at a blob that exists (Req. 22).
    await deps.blobStore.put(record.blobPath, JSON.stringify(session));

    const result = await deps.recordStore.createIfAbsent(record);
    if (!result.created) {
      const existing = result.existing;
      if (existing.ownerAthleteId !== identity.userId) {
        // Same UUID, different owner — astronomically unlikely by accident.
        // Reject without confirming whose it is.
        return reply.status(409).send({ error: 'This session ID is already in use.' });
      }
      await deps.eventPublisher.publishSessionReceived({
        sessionId: existing.sessionId,
        ownerAthleteId: existing.ownerAthleteId,
        blobPath: existing.blobPath,
        correlationId: existing.correlationId,
      });
      return reply.status(200).send({
        sessionId: existing.sessionId,
        status: 'already-accepted',
        correlationId: existing.correlationId,
      });
    }

    await deps.eventPublisher.publishSessionReceived({
      sessionId: record.sessionId,
      ownerAthleteId: record.ownerAthleteId,
      blobPath: record.blobPath,
      correlationId: record.correlationId,
    });

    return reply.status(201).send({
      sessionId: record.sessionId,
      status: 'accepted',
      correlationId: record.correlationId,
    });
  });
}
