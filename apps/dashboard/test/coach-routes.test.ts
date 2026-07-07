import { authHeader, buildTestHarness, TestHarness } from './helpers';

/** T8 acceptance criteria, coach half (Req. 20): a coach sees only athletes who shared with them. */

const TOKENS = {
  'coach-token': 'coach-1',
  'other-coach-token': 'coach-2',
  'athlete-token': 'athlete-1',
};

describe('coach roster route', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = buildTestHarness(TOKENS);
    await harness.users.setRole('coach-1', 'coach');
    await harness.users.setRole('coach-2', 'coach');
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('lists exactly the athletes who granted this coach — nobody else’s', async () => {
    await harness.sharing.grant('athlete-1', 'coach-1');
    await harness.sharing.grant('athlete-2', 'coach-1');
    await harness.sharing.grant('athlete-3', 'coach-2');

    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/coach/athletes',
      headers: authHeader('coach-token'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().athletes).toEqual([
      { athleteId: 'athlete-1' },
      { athleteId: 'athlete-2' },
    ]);
  });

  it('is empty when nobody has shared', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/coach/athletes',
      headers: authHeader('coach-token'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().athletes).toEqual([]);
  });

  it('rejects non-coach callers (403) and unauthenticated ones (401)', async () => {
    const asAthlete = await harness.app.inject({
      method: 'GET',
      url: '/v1/coach/athletes',
      headers: authHeader('athlete-token'),
    });
    expect(asAthlete.statusCode).toBe(403);

    const anonymous = await harness.app.inject({ method: 'GET', url: '/v1/coach/athletes' });
    expect(anonymous.statusCode).toBe(401);
  });
});
