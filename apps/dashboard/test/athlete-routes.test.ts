import { randomUUID } from 'node:crypto';
import { authHeader, buildTestHarness, processedResult, TestHarness } from './helpers';

/**
 * T8 acceptance criteria, athlete half (Req. 19) + the server-side access
 * rule (Req. 20): an athlete sees their authoritative results and trends; a
 * direct request for a non-shared athlete's data is rejected server-side.
 */

const TOKENS = {
  'athlete-token': 'athlete-1',
  'other-athlete-token': 'athlete-2',
  'coach-token': 'coach-1',
};

describe('athlete dashboard routes', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = buildTestHarness(TOKENS);
    await harness.users.setRole('coach-1', 'coach');
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('rejects unauthenticated requests to every data route', async () => {
    for (const url of [
      '/v1/me',
      '/v1/athletes/athlete-1/sessions',
      `/v1/athletes/athlete-1/sessions/${randomUUID()}`,
      '/v1/athletes/athlete-1/trends',
    ]) {
      const response = await harness.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    }
  });

  it("shows an athlete their own session's authoritative (worker-computed) insights", async () => {
    const result = processedResult({ ownerAthleteId: 'athlete-1', sessionStartedAtMs: 1_750_000_000_000 });
    harness.results.add(result);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/athletes/athlete-1/sessions/${result.sessionId}`,
      headers: authHeader('athlete-token'),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result.insights.computedBy).toBe('cloud-worker');
    const kinds = body.result.insights.insights.map((i: { kind: string }) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['pressure_balance', 'ground_contact_time', 'cadence', 'foot_strike']),
    );
  });

  it('lists an athlete’s sessions newest-first by session start time', async () => {
    const older = processedResult({ ownerAthleteId: 'athlete-1', sessionStartedAtMs: 1_000 });
    const newer = processedResult({ ownerAthleteId: 'athlete-1', sessionStartedAtMs: 2_000 });
    const someoneElses = processedResult({ ownerAthleteId: 'athlete-2', sessionStartedAtMs: 3_000 });
    harness.results.add(older);
    harness.results.add(newer);
    harness.results.add(someoneElses);

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/athletes/athlete-1/sessions',
      headers: authHeader('athlete-token'),
    });

    expect(response.statusCode).toBe(200);
    const sessions = response.json().sessions;
    expect(sessions.map((s: { sessionId: string }) => s.sessionId)).toEqual([
      newer.sessionId,
      older.sessionId,
    ]);
  });

  it('returns a multi-session trend ordered by when sessions happened (Req. 19)', async () => {
    // Uploaded/processed in one order, run in another — trend must follow run time.
    harness.results.add(processedResult({ ownerAthleteId: 'athlete-1', sessionStartedAtMs: 2_000 }));
    harness.results.add(processedResult({ ownerAthleteId: 'athlete-1', sessionStartedAtMs: 1_000 }));

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/athletes/athlete-1/trends',
      headers: authHeader('athlete-token'),
    });

    expect(response.statusCode).toBe(200);
    const trends = response.json().trends;
    const cadence = trends.find((t: { kind: string }) => t.kind === 'cadence');
    expect(cadence.points).toHaveLength(2);
    expect(cadence.points.map((p: { atMs: number }) => p.atMs)).toEqual([1_000, 2_000]);
    // Per-foot series stay separate — asymmetry must stay visible in trends.
    const contactFeet = trends
      .filter((t: { kind: string }) => t.kind === 'ground_contact_time')
      .map((t: { foot?: string }) => t.foot)
      .sort();
    expect(contactFeet).toEqual(['left', 'right']);
  });

  it("rejects another athlete's attempt to read data server-side (403, not filtering)", async () => {
    const result = processedResult({ ownerAthleteId: 'athlete-1' });
    harness.results.add(result);

    for (const url of [
      '/v1/athletes/athlete-1/sessions',
      `/v1/athletes/athlete-1/sessions/${result.sessionId}`,
      '/v1/athletes/athlete-1/trends',
    ]) {
      const response = await harness.app.inject({
        method: 'GET',
        url,
        headers: authHeader('other-athlete-token'),
      });
      expect(response.statusCode).toBe(403);
    }
  });

  it('admits a coach only while the athlete’s sharing grant exists (Req. 20)', async () => {
    const result = processedResult({ ownerAthleteId: 'athlete-1' });
    harness.results.add(result);
    const url = `/v1/athletes/athlete-1/sessions/${result.sessionId}`;

    const before = await harness.app.inject({ method: 'GET', url, headers: authHeader('coach-token') });
    expect(before.statusCode).toBe(403);

    await harness.sharing.grant('athlete-1', 'coach-1');
    const during = await harness.app.inject({ method: 'GET', url, headers: authHeader('coach-token') });
    expect(during.statusCode).toBe(200);
    expect(during.json().result.sessionId).toBe(result.sessionId);

    await harness.sharing.revoke('athlete-1', 'coach-1');
    const after = await harness.app.inject({ method: 'GET', url, headers: authHeader('coach-token') });
    expect(after.statusCode).toBe(403);
  });

  it("returns 404 for someone else's session requested under the caller's own athleteId (IDOR probe)", async () => {
    const victims = processedResult({ ownerAthleteId: 'athlete-2' });
    harness.results.add(victims);

    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/athletes/athlete-1/sessions/${victims.sessionId}`,
      headers: authHeader('athlete-token'),
    });

    // Indistinguishable from a nonexistent session — no confirmation the ID exists.
    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for a session with no result yet', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/athletes/athlete-1/sessions/${randomUUID()}`,
      headers: authHeader('athlete-token'),
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects malformed path parameters with 400', async () => {
    const badAthlete = await harness.app.inject({
      method: 'GET',
      url: '/v1/athletes/not%20a%20valid%20id!/sessions',
      headers: authHeader('athlete-token'),
    });
    expect(badAthlete.statusCode).toBe(400);

    const badSession = await harness.app.inject({
      method: 'GET',
      url: '/v1/athletes/athlete-1/sessions/not-a-uuid',
      headers: authHeader('athlete-token'),
    });
    expect(badSession.statusCode).toBe(400);
  });
});
