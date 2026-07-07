import Fastify, { FastifyInstance } from 'fastify';
import {
  createDatasetSnapshot,
  EmptyDatasetError,
  InvalidSnapshotRequestError,
  LabeledSessionQuery,
  SnapshotConflictError,
} from '@smart-sneaker/dataset-store';
import { InvalidTrainingRequestError, runTrainingRun, TrainingRunDeps } from './run-training';

export interface TrainingServerDeps extends TrainingRunDeps {
  labeledSessions: LabeledSessionQuery;
  logger?: boolean;
}

/**
 * Admin/trigger surface for the data & training pipeline (T13-T14). Both
 * endpoints serve operators and Cloud Scheduler, never athletes or coaches —
 * caller authentication is Cloud Run IAM: the service deploys with
 * --no-allow-unauthenticated and only the scheduler's/operator's service
 * account holds run.invoker, exactly like the session worker's push endpoint.
 *
 * "Scheduled" and "on-demand" training are the same idempotent POST — Cloud
 * Scheduler simply calls it on a cron; re-triggering an already-trained
 * snapshot is a safe no-op.
 */
export function buildTrainingServer(deps: TrainingServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof InvalidTrainingRequestError || error instanceof InvalidSnapshotRequestError) {
      return reply.status(400).send({ error: error.message });
    }
    if (error instanceof EmptyDatasetError) {
      return reply.status(422).send({ error: error.message });
    }
    if (error instanceof SnapshotConflictError) {
      return reply.status(409).send({ error: error.message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'Something went wrong on our side — please retry.' });
  });

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post('/v1/dataset-snapshots', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown; sportProfileId?: unknown };
    const snapshot = await createDatasetSnapshot(
      { name: body.name as string, sportProfileId: body.sportProfileId as string },
      { labeledSessions: deps.labeledSessions, snapshots: deps.snapshots, ...(deps.nowMs ? { nowMs: deps.nowMs } : {}) },
    );
    return reply.status(201).send({
      name: snapshot.name,
      version: snapshot.version,
      sessionCount: snapshot.entries.length,
    });
  });

  app.post('/v1/training-runs', async (request, reply) => {
    const result = await runTrainingRun(request.body ?? {}, deps);
    switch (result.outcome) {
      case 'trained':
        return reply.status(201).send({ outcome: result.outcome, model: result.record.model, metrics: result.record.metrics });
      case 'already-trained':
        return reply.status(200).send({ outcome: result.outcome, model: result.record.model, metrics: result.record.metrics });
      case 'dataset-not-found':
        return reply.status(404).send({ error: 'no such dataset snapshot' });
      case 'no-usable-sessions':
        return reply.status(422).send({ error: result.detail });
    }
  });

  return app;
}
