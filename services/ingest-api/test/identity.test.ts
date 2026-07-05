import { AuthenticationError, resolveIdentity } from '../src/auth/identity';
import { InMemoryUserDirectory } from '../src/auth/in-memory-stores';
import { FakeTokenVerifier } from './helpers';

describe('resolveIdentity (T5: server-side identity from auth token)', () => {
  const verifier = new FakeTokenVerifier({ 'athlete-token': 'athlete-1', 'coach-token': 'coach-1' });

  it('resolves a stable athlete identity from a valid bearer token', async () => {
    const users = new InMemoryUserDirectory();
    await users.setRole('athlete-1', 'athlete');
    const identity = await resolveIdentity('Bearer athlete-token', verifier, users);
    expect(identity).toEqual({ userId: 'athlete-1', role: 'athlete' });
  });

  it('resolves the coach role when the directory says so', async () => {
    const users = new InMemoryUserDirectory();
    await users.setRole('coach-1', 'coach');
    const identity = await resolveIdentity('Bearer coach-token', verifier, users);
    expect(identity).toEqual({ userId: 'coach-1', role: 'coach' });
  });

  it('defaults an unprovisioned user to athlete — coach is never self-assigned (least privilege)', async () => {
    const identity = await resolveIdentity('Bearer athlete-token', verifier, new InMemoryUserDirectory());
    expect(identity.role).toBe('athlete');
  });

  it.each([
    ['missing header', undefined],
    ['empty header', ''],
    ['wrong scheme', 'Basic athlete-token'],
    ['bare token without scheme', 'athlete-token'],
    ['extra parts', 'Bearer athlete-token extra'],
  ])('rejects %s with AuthenticationError', async (_name, header) => {
    await expect(resolveIdentity(header, verifier, new InMemoryUserDirectory())).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('rejects a token the verifier refuses, without echoing verifier internals', async () => {
    const promise = resolveIdentity('Bearer forged', verifier, new InMemoryUserDirectory());
    await expect(promise).rejects.toThrow(AuthenticationError);
    await expect(promise).rejects.toThrow('invalid or expired credentials');
    await expect(promise).rejects.not.toThrow(/rejected by verifier/);
  });

  it('rejects a verified token whose uid is not path-safe (defense in depth)', async () => {
    const hostileVerifier = new FakeTokenVerifier({ t: 'users/../../secrets' });
    await expect(resolveIdentity('Bearer t', hostileVerifier, new InMemoryUserDirectory())).rejects.toThrow(
      AuthenticationError,
    );
  });
});
