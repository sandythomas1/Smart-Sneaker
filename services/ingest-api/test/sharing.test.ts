import { AuthenticatedUser } from '../src/auth/identity';
import { InMemorySharingStore, InMemoryUserDirectory } from '../src/auth/in-memory-stores';
import {
  AccessDeniedError,
  assertCanAccessAthleteData,
  canAccessAthleteData,
  grantSharing,
  InvalidRequestError,
  revokeSharing,
} from '../src/auth/sharing';
import { buildTestHarness } from './helpers';

const athlete: AuthenticatedUser = { userId: 'athlete-1', role: 'athlete' };
const otherAthlete: AuthenticatedUser = { userId: 'athlete-2', role: 'athlete' };
const coach: AuthenticatedUser = { userId: 'coach-1', role: 'coach' };

function setup() {
  const users = new InMemoryUserDirectory();
  const sharing = new InMemorySharingStore();
  return { users, sharing };
}

describe('sharing model (T5: grant, revoke, server-side access rule)', () => {
  it('an athlete always has access to their own data', async () => {
    const { sharing } = setup();
    expect(await canAccessAthleteData(athlete, athlete.userId, sharing)).toBe(true);
  });

  it('a coach can be granted access and then read the athlete’s data (Req. 20)', async () => {
    const { users, sharing } = setup();
    await users.setRole(coach.userId, 'coach');
    await grantSharing(athlete, coach.userId, users, sharing);
    expect(await canAccessAthleteData(coach, athlete.userId, sharing)).toBe(true);
  });

  it('revoking a grant removes the coach’s access', async () => {
    const { users, sharing } = setup();
    await users.setRole(coach.userId, 'coach');
    await grantSharing(athlete, coach.userId, users, sharing);
    await revokeSharing(athlete, coach.userId, sharing);
    expect(await canAccessAthleteData(coach, athlete.userId, sharing)).toBe(false);
  });

  it('a non-shared coach is rejected server-side', async () => {
    const { sharing } = setup();
    expect(await canAccessAthleteData(coach, athlete.userId, sharing)).toBe(false);
    await expect(assertCanAccessAthleteData(coach, athlete.userId, sharing)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it('an arbitrary other athlete is rejected even if a grant exists for a coach with the same id shape', async () => {
    const { users, sharing } = setup();
    await users.setRole(coach.userId, 'coach');
    await grantSharing(athlete, coach.userId, users, sharing);
    expect(await canAccessAthleteData(otherAthlete, athlete.userId, sharing)).toBe(false);
  });

  it('a grant is scoped to one athlete — sharing with a coach exposes nothing about other athletes', async () => {
    const { users, sharing } = setup();
    await users.setRole(coach.userId, 'coach');
    await grantSharing(athlete, coach.userId, users, sharing);
    expect(await canAccessAthleteData(coach, otherAthlete.userId, sharing)).toBe(false);
  });

  it('rejects granting to a user who is not a provisioned coach', async () => {
    const { users, sharing } = setup();
    await expect(grantSharing(athlete, 'random-user', users, sharing)).rejects.toThrow(
      InvalidRequestError,
    );
  });

  it('rejects granting to yourself', async () => {
    const { users, sharing } = setup();
    await users.setRole(athlete.userId, 'coach');
    await expect(grantSharing(athlete, athlete.userId, users, sharing)).rejects.toThrow(
      InvalidRequestError,
    );
  });

  it.each([['path traversal', 'a/../b'], ['empty', ''], ['overlong', 'x'.repeat(200)]])(
    'rejects a malformed coachId (%s) in grant and revoke',
    async (_name, coachId) => {
      const { users, sharing } = setup();
      await expect(grantSharing(athlete, coachId, users, sharing)).rejects.toThrow(InvalidRequestError);
      await expect(revokeSharing(athlete, coachId, sharing)).rejects.toThrow(InvalidRequestError);
    },
  );
});

describe('sharing routes (T5: HTTP surface)', () => {
  const tokens = { 'athlete-token': 'athlete-1', 'coach-token': 'coach-1' };

  it('PUT then DELETE /v1/sharing/coaches/:coachId manages the caller’s own grant', async () => {
    const { app, users, sharing } = buildTestHarness(tokens);
    await users.setRole('coach-1', 'coach');

    const grant = await app.inject({
      method: 'PUT',
      url: '/v1/sharing/coaches/coach-1',
      headers: { authorization: 'Bearer athlete-token' },
    });
    expect(grant.statusCode).toBe(204);
    expect(await sharing.isSharedWith('athlete-1', 'coach-1')).toBe(true);

    const revoke = await app.inject({
      method: 'DELETE',
      url: '/v1/sharing/coaches/coach-1',
      headers: { authorization: 'Bearer athlete-token' },
    });
    expect(revoke.statusCode).toBe(204);
    expect(await sharing.isSharedWith('athlete-1', 'coach-1')).toBe(false);
  });

  it('rejects an unauthenticated grant attempt with 401 (T5 AC: protected resources)', async () => {
    const { app, sharing } = buildTestHarness(tokens);
    const response = await app.inject({ method: 'PUT', url: '/v1/sharing/coaches/coach-1' });
    expect(response.statusCode).toBe(401);
    expect(await sharing.isSharedWith('athlete-1', 'coach-1')).toBe(false);
  });

  it('returns 400 for a grant to a non-coach, with a non-technical message', async () => {
    const { app } = buildTestHarness(tokens);
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/sharing/coaches/not-a-coach',
      headers: { authorization: 'Bearer athlete-token' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/registered coach/);
  });
});
