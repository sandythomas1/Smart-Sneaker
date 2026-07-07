import { FixedWindowRateLimiter } from '../src/rate-limit';
import { buildTestHarness, validSessionPayload } from './helpers';

const tokens = { 'athlete-token': 'athlete-1', 'intruder-token': 'intruder-9' };
const auth = { authorization: 'Bearer athlete-token' };

describe('POST /v1/sessions (T6: authenticated upload boundary)', () => {
  it('stores a valid upload, derives ownership from the token, and emits an event keyed by session ID (Req. 14, 16)', async () => {
    const { app, records, blobs, events } = buildTestHarness(tokens);
    const session = validSessionPayload();

    const response = await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: session });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ sessionId: session.sessionId, status: 'accepted' });
    expect(body.correlationId).toBeTruthy();

    const record = records.records.get(session.sessionId);
    expect(record).toMatchObject({
      sessionId: session.sessionId,
      ownerAthleteId: 'athlete-1',
      sportProfileId: 'running-v1',
      sampleCount: 2,
    });
    expect(blobs.blobs.get(record!.blobPath)).toBe(JSON.stringify(session));
    expect(events.published).toEqual([
      {
        sessionId: session.sessionId,
        ownerAthleteId: 'athlete-1',
        blobPath: record!.blobPath,
        correlationId: record!.correlationId,
      },
    ]);
  });

  it('copies labels into the stored record so the dataset store can query them (T13)', async () => {
    const { app, records } = buildTestHarness(tokens);
    const labeled = validSessionPayload({
      labels: { conditions: ['favor-left-leg'], notes: 'protocol run' },
    });
    const plain = validSessionPayload({ sessionId: '0f9b2c64-1d3e-4a5b-9c8d-2e1f0a3b4c5e' });

    await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: labeled });
    await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: plain });

    expect(records.records.get(labeled.sessionId)).toMatchObject({
      hasLabels: true,
      labels: { conditions: ['favor-left-leg'], notes: 'protocol run' },
    });
    const plainRecord = records.records.get(plain.sessionId)!;
    expect(plainRecord.hasLabels).toBe(false);
    expect('labels' in plainRecord).toBe(false); // no undefined-valued keys for Firestore
  });

  it('rejects an unauthenticated upload with 401 and stores nothing', async () => {
    const { app, records, events } = buildTestHarness(tokens);
    const response = await app.inject({ method: 'POST', url: '/v1/sessions', payload: validSessionPayload() });
    expect(response.statusCode).toBe(401);
    expect(records.records.size).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it('rejects a schema-invalid payload synchronously with field-level issues and never queues it (Req. 15)', async () => {
    const { app, records, blobs, events } = buildTestHarness(tokens);
    const invalid = { ...validSessionPayload(), samples: [] };

    const response = await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: invalid });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBeTruthy();
    expect(body.issues.some((i: { path: string }) => i.path.startsWith('samples'))).toBe(true);
    expect(records.records.size).toBe(0);
    expect(blobs.blobs.size).toBe(0);
    expect(events.published).toHaveLength(0);
  });

  it('rejects a payload above the size bound with an actionable 413 and never queues it (Req. 15)', async () => {
    const { app, events } = buildTestHarness(tokens, { maxBodyBytes: 1024 });
    const oversized = validSessionPayload();
    oversized.samples = new Array(200).fill(oversized.samples[0]);

    const response = await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: oversized });

    expect(response.statusCode).toBe(413);
    expect(response.json().error).toMatch(/too large/i);
    expect(events.published).toHaveLength(0);
  });

  it('ignores a smuggled athlete ID — ownership always comes from the auth token (Req. 16)', async () => {
    const { app, records, blobs } = buildTestHarness(tokens);
    const smuggled = { ...validSessionPayload(), athleteId: 'victim-user' };

    const response = await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: smuggled });

    expect(response.statusCode).toBe(201);
    const record = records.records.get(smuggled.sessionId)!;
    expect(record.ownerAthleteId).toBe('athlete-1');
    // The schema strips the unknown field, so it never even reaches storage.
    expect(blobs.blobs.get(record.blobPath)).not.toContain('victim-user');
  });

  it('re-submitting the same session is idempotent: no duplicate record, same correlation ID, event re-emitted for the worker to dedupe (Req. 18)', async () => {
    const { app, records, events } = buildTestHarness(tokens);
    const session = validSessionPayload();

    const first = await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: session });
    const second = await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: session });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      status: 'already-accepted',
      correlationId: first.json().correlationId,
    });
    expect(records.records.size).toBe(1);
    expect(events.published).toHaveLength(2); // at-least-once by design; worker is idempotent
  });

  it('rejects a session ID already owned by another account with 409, leaking nothing and touching nothing (Req. 16, 18)', async () => {
    const { app, records, blobs, events } = buildTestHarness(tokens);
    const session = validSessionPayload();

    await app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: session });
    const victimRecord = records.records.get(session.sessionId)!;
    const victimBlob = blobs.blobs.get(victimRecord.blobPath);
    const publishedBefore = events.published.length;

    const intruder = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: 'Bearer intruder-token' },
      payload: { ...session, startedAtMs: 999 },
    });

    expect(intruder.statusCode).toBe(409);
    expect(intruder.body).not.toContain('athlete-1');
    expect(records.records.get(session.sessionId)).toEqual(victimRecord);
    expect(blobs.blobs.get(victimRecord.blobPath)).toBe(victimBlob); // owner-namespaced path: untouched
    expect(events.published).toHaveLength(publishedBefore);
  });

  it('bounds uploads per account with 429 once the limit is hit (Abuse Prevention NFR)', async () => {
    let nowMs = 0;
    const { app } = buildTestHarness(tokens, {
      rateLimiter: new FixedWindowRateLimiter(2, 60_000, () => nowMs),
    });

    const upload = () =>
      app.inject({ method: 'POST', url: '/v1/sessions', headers: auth, payload: validSessionPayload() });

    expect((await upload()).statusCode).toBe(201);
    expect((await upload()).statusCode).toBe(200); // duplicate, but within limit
    const limited = await upload();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatch(/try again/i);

    nowMs = 61_000; // next window
    expect((await upload()).statusCode).toBe(200);
  });
});
