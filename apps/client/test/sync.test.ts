import type { Session } from '@smart-sneaker/data-contracts';
import { generateSyntheticRun } from '@smart-sneaker/insights-engine';
import { InMemoryLocalSessionStore } from '../src/storage/session-store';
import { ConnectivityMonitor, SessionSyncManager, SyncEvent } from '../src/sync/session-sync';
import { HttpSessionUploader, SessionUploader, UploadOutcome } from '../src/sync/uploader';

const CLEAN_RUN = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

function sessionWithId(sessionId: string): Session {
  return { ...generateSyntheticRun(CLEAN_RUN).session, sessionId };
}

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

/** Mimics T6's contract: idempotent on session ID, one stored record per session. */
class FakeIngestServer implements SessionUploader {
  readonly stored = new Map<string, Session>();
  /** Outcomes to return before behaving normally, consumed in order. */
  scripted: UploadOutcome[] = [];
  uploadCalls = 0;

  async upload(session: Session): Promise<UploadOutcome> {
    this.uploadCalls += 1;
    const scripted = this.scripted.shift();
    if (scripted) {
      return scripted;
    }
    this.stored.set(session.sessionId, session); // re-upload of a known ID overwrites, never duplicates
    return { kind: 'accepted' };
  }
}

class FakeConnectivity implements ConnectivityMonitor {
  private listeners: Array<() => void> = [];

  onOnline(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  goOnline(): void {
    for (const listener of this.listeners) listener();
  }
}

function buildManager(server: SessionUploader, store: InMemoryLocalSessionStore) {
  const events: SyncEvent[] = [];
  const sleeps: number[] = [];
  const manager = new SessionSyncManager({
    store,
    uploader: server,
    backoffMs: 100,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    onEvent: (event) => events.push(event),
  });
  return { manager, events, sleeps };
}

describe('SessionSyncManager (Req. 5-7)', () => {
  it('uploads automatically when connectivity returns, releasing the local copy only after confirmation', async () => {
    const server = new FakeIngestServer();
    const store = new InMemoryLocalSessionStore();
    await store.save(sessionWithId(SESSION_A));
    const { manager, events } = buildManager(server, store);

    const connectivity = new FakeConnectivity();
    manager.start(connectivity);
    expect(server.stored.size).toBe(0); // nothing manual happened yet

    connectivity.goOnline();
    await manager.syncPending(); // joins the in-flight drain triggered by the event

    expect(server.stored.has(SESSION_A)).toBe(true);
    expect(await store.get(SESSION_A)).toBeNull();
    expect(events).toContainEqual({ sessionId: SESSION_A, status: 'synced' });
    manager.stop();
  });

  it('keeps the local copy and retries with backoff on transient failure', async () => {
    const server = new FakeIngestServer();
    server.scripted = [
      { kind: 'transient', detail: 'network unreachable' },
      { kind: 'transient', detail: 'server responded 503' },
    ];
    const store = new InMemoryLocalSessionStore();
    await store.save(sessionWithId(SESSION_A));
    const { manager, sleeps } = buildManager(server, store);

    const report = await manager.syncPending();

    // Third in-drain attempt succeeded after two backoffs (100ms, 200ms).
    expect(report.synced).toEqual([SESSION_A]);
    expect(sleeps).toEqual([100, 200]);
    expect(server.stored.has(SESSION_A)).toBe(true);
  });

  it('defers a session that stays transient, retaining it for the next drain', async () => {
    const server = new FakeIngestServer();
    server.scripted = Array(3).fill({ kind: 'transient', detail: 'offline' });
    const store = new InMemoryLocalSessionStore();
    await store.save(sessionWithId(SESSION_A));
    const { manager, events } = buildManager(server, store);

    const report = await manager.syncPending();
    expect(report.deferred).toEqual([SESSION_A]);
    expect(await store.get(SESSION_A)).not.toBeNull();
    expect(events).toContainEqual({ sessionId: SESSION_A, status: 'deferred' });

    // Connectivity returns: the same session drains successfully.
    const second = await manager.syncPending();
    expect(second.synced).toEqual([SESSION_A]);
    expect(await store.get(SESSION_A)).toBeNull();
  });

  it('surfaces a permanent rejection actionably and stops auto-retrying it, without deleting data', async () => {
    const server = new FakeIngestServer();
    const rejection = 'The uploaded session is not valid.';
    server.scripted = [{ kind: 'rejected', userMessage: rejection }];
    const store = new InMemoryLocalSessionStore();
    await store.save(sessionWithId(SESSION_A));
    await store.save(sessionWithId(SESSION_B));
    const { manager, events } = buildManager(server, store);

    const report = await manager.syncPending();

    expect(report.failed).toEqual([{ sessionId: SESSION_A, userMessage: rejection }]);
    expect(report.synced).toEqual([SESSION_B]); // one bad session never blocks the rest
    expect(events).toContainEqual({ sessionId: SESSION_A, status: 'failed', userMessage: rejection });
    expect(await store.get(SESSION_A)).not.toBeNull(); // data preserved for support/recovery

    // Next drain skips the known-bad session entirely…
    const callsBefore = server.uploadCalls;
    await manager.syncPending();
    expect(server.uploadCalls).toBe(callsBefore);

    // …until the athlete/app explicitly retries it.
    manager.retryFailedSession(SESSION_A);
    const retried = await manager.syncPending();
    expect(retried.synced).toEqual([SESSION_A]);
  });

  it('never duplicates a server record when an already-synced session is uploaded again', async () => {
    const server = new FakeIngestServer();
    const store = new InMemoryLocalSessionStore();
    const session = sessionWithId(SESSION_A);
    await store.save(session);
    const { manager } = buildManager(server, store);
    await manager.syncPending();

    // Simulate a client that lost the "synced" bookkeeping (restored backup)
    // and re-queues the same session: T6's idempotency makes this a no-op.
    await store.save(session);
    const report = await manager.syncPending();

    expect(report.synced).toEqual([SESSION_A]);
    expect(server.stored.size).toBe(1);
  });
});

describe('HttpSessionUploader outcome classification', () => {
  const session = sessionWithId(SESSION_A);
  const tokens = { getIdToken: async () => 'token-1' };

  function uploaderWith(response: () => Promise<Response>) {
    const fetchFn = jest.fn(response) as unknown as typeof fetch;
    return {
      uploader: new HttpSessionUploader({ baseUrl: 'https://ingest.example', tokens, fetchFn }),
      fetchFn: fetchFn as jest.Mock,
    };
  }

  it('sends an authenticated JSON POST and accepts 201/200', async () => {
    const { uploader, fetchFn } = uploaderWith(async () => new Response('{}', { status: 201 }));
    expect(await uploader.upload(session)).toEqual({ kind: 'accepted' });

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ingest.example/v1/sessions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-1');
    expect(JSON.parse(init.body as string).sessionId).toBe(SESSION_A);
  });

  it.each([[500], [503], [429], [408], [401], [403]])(
    'classifies HTTP %i as transient (worth retrying)',
    async (status) => {
      const { uploader } = uploaderWith(async () => new Response('{}', { status }));
      expect(await uploader.upload(session)).toMatchObject({ kind: 'transient' });
    },
  );

  it('classifies a network error as transient', async () => {
    const { uploader } = uploaderWith(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await uploader.upload(session)).toMatchObject({ kind: 'transient' });
  });

  it("passes through the server's user-facing message on a 400 rejection", async () => {
    const { uploader } = uploaderWith(
      async () => new Response(JSON.stringify({ error: 'The uploaded session is not valid.' }), { status: 400 }),
    );
    expect(await uploader.upload(session)).toEqual({
      kind: 'rejected',
      userMessage: 'The uploaded session is not valid.',
    });
  });

  it('falls back to a friendly generic message when the rejection body is unusable', async () => {
    const { uploader } = uploaderWith(async () => new Response('<html>', { status: 422 }));
    const outcome = await uploader.upload(session);
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') return;
    expect(outcome.userMessage).not.toMatch(/\d{3}|error code|exception/i);
  });
});
