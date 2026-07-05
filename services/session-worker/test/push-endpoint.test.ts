import { buildWorkerServer } from '../src/server';
import { eventFor, harnessWithSession, syntheticSession } from './helpers';

function pushEnvelope(payload: unknown) {
  return { message: { data: Buffer.from(JSON.stringify(payload)).toString('base64'), messageId: 'm-1' } };
}

describe('POST /pubsub/sessions (Pub/Sub push wrapper)', () => {
  it('acknowledges a valid delivery with 204 and persists the result', async () => {
    const session = syntheticSession();
    const { deps, results } = harnessWithSession(session);
    const app = buildWorkerServer(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/pubsub/sessions',
      payload: pushEnvelope(eventFor(session)),
    });

    expect(response.statusCode).toBe(204);
    expect(results.results.get(session.sessionId)!.status).toBe('processed');
  });

  it('acknowledges (drops) a malformed envelope instead of triggering endless redelivery', async () => {
    const { deps, results } = harnessWithSession(syntheticSession());
    const app = buildWorkerServer(deps);

    const response = await app.inject({ method: 'POST', url: '/pubsub/sessions', payload: { nope: true } });

    expect(response.statusCode).toBe(204);
    expect(results.results.size).toBe(0);
  });

  it('acknowledges (drops) a message whose payload is not decodable JSON', async () => {
    const { deps, results } = harnessWithSession(syntheticSession());
    const app = buildWorkerServer(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/pubsub/sessions',
      payload: { message: { data: Buffer.from('not json at all').toString('base64') } },
    });

    expect(response.statusCode).toBe(204);
    expect(results.results.size).toBe(0);
  });

  it('acknowledges (drops) an event that fails contract validation', async () => {
    const { deps, results } = harnessWithSession(syntheticSession());
    const app = buildWorkerServer(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/pubsub/sessions',
      payload: pushEnvelope({ sessionId: 'not-a-uuid' }),
    });

    expect(response.statusCode).toBe(204);
    expect(results.results.size).toBe(0);
  });

  it('returns 503 for a transient failure (missing blob) so Pub/Sub redelivers', async () => {
    const session = syntheticSession();
    const { deps, blobs, results } = harnessWithSession(session);
    blobs.blobs.clear();
    const app = buildWorkerServer(deps);

    const response = await app.inject({
      method: 'POST',
      url: '/pubsub/sessions',
      payload: pushEnvelope(eventFor(session)),
    });

    expect(response.statusCode).toBe(503);
    expect(results.results.size).toBe(0);
  });

  it('exposes an unauthenticated liveness probe', async () => {
    const app = buildWorkerServer(harnessWithSession(syntheticSession()).deps);
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
  });
});
