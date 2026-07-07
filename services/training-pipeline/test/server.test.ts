import { InMemoryLabeledSessionQuery } from '@smart-sneaker/dataset-store';
import { buildTrainingServer } from '../src/server';
import { buildTrainingHarness, labeledSession } from './helpers';

/**
 * T14 trigger surface: "scheduled" and "on-demand" are the same idempotent
 * POST — Cloud Scheduler calls it on a cron, an operator calls it ad hoc.
 * Caller auth is Cloud Run IAM (--no-allow-unauthenticated), as with the
 * session worker's push endpoint.
 */

function buildApp() {
  const harness = buildTrainingHarness();
  const labeledSessions = new InMemoryLabeledSessionQuery();
  const app = buildTrainingServer({ ...harness, labeledSessions });
  return { app, harness, labeledSessions };
}

describe('POST /v1/dataset-snapshots', () => {
  it('freezes the current labeled corpus as the next snapshot version', async () => {
    const { app, labeledSessions, harness } = buildApp();
    labeledSessions.add(harness.addSession(labeledSession(['favor-left-leg'], 'left')));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/dataset-snapshots',
      payload: { name: 'running-labeled', sportProfileId: 'running-v1' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ name: 'running-labeled', version: 1, sessionCount: 1 });
    expect(await harness.snapshots.get('running-labeled', 1)).not.toBeNull();
  });

  it('maps an empty corpus to 422 and a bad name to 400', async () => {
    const { app } = buildApp();
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/dataset-snapshots',
      payload: { name: 'running-labeled', sportProfileId: 'running-v1' },
    });
    expect(empty.statusCode).toBe(422);

    const badName = await app.inject({
      method: 'POST',
      url: '/v1/dataset-snapshots',
      payload: { name: 'Not Valid!', sportProfileId: 'running-v1' },
    });
    expect(badName.statusCode).toBe(400);
  });
});

describe('POST /v1/training-runs', () => {
  it('runs on demand, and a repeated (e.g. scheduled) trigger is a safe no-op', async () => {
    const { app, harness } = buildApp();
    await harness.freeze('running-labeled', 1, [
      harness.addSession(labeledSession(['normal'])),
      harness.addSession(labeledSession(['favor-left-leg'], 'left')),
    ]);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/training-runs',
      payload: { datasetName: 'running-labeled' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      outcome: 'trained',
      model: { name: 'running-v1-baseline-running-labeled', version: '0.1.0-ds-v1' },
    });
    expect(first.json().metrics.labelAgreementRate).toBe(1);

    const rerun = await app.inject({
      method: 'POST',
      url: '/v1/training-runs',
      payload: { datasetName: 'running-labeled' },
    });
    expect(rerun.statusCode).toBe(200);
    expect(rerun.json().outcome).toBe('already-trained');
    expect(harness.registry.records.size).toBe(1);
  });

  it('maps unknown datasets to 404 and malformed triggers to 400', async () => {
    const { app } = buildApp();
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/training-runs',
      payload: { datasetName: 'no-such-set' },
    });
    expect(missing.statusCode).toBe(404);

    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/training-runs',
      payload: { datasetName: 123 },
    });
    expect(malformed.statusCode).toBe(400);
  });
});
