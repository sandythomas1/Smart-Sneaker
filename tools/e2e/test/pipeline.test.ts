import type { DatasetEntry, SessionReceivedEvent, SessionResult } from '@smart-sneaker/data-contracts';
import {
  AllowAllRateLimiter,
  buildServer,
  InMemorySessionBlobStore,
  InMemorySessionEventPublisher,
  InMemorySessionRecordStore,
  InMemorySharingStore,
  InMemoryUserDirectory,
  TokenVerifier,
} from '@smart-sneaker/ingest-api';
import {
  InMemoryAuthoritativeResultStore,
  InMemorySessionBlobReader as WorkerBlobReader,
  processSessionEvent,
} from '@smart-sneaker/session-worker';
import { buildDashboardServer, InMemorySessionResultQuery } from '@smart-sneaker/dashboard';
import {
  createDatasetSnapshot,
  InMemoryLabeledSessionQuery,
  InMemorySnapshotStore,
} from '@smart-sneaker/dataset-store';
import {
  InMemoryModelArtifactStore,
  InMemoryModelRegistry,
  InMemorySessionBlobReader as TrainingBlobReader,
  runTrainingRun,
} from '@smart-sneaker/training-pipeline';
import {
  ATHLETE_ASHA,
  ATHLETE_BEN,
  ATHLETE_CHIKE,
  buildSeedCorpus,
  COACH_DANA,
  SeedCorpus,
} from '../src/seed';

/** Maps the seed roster's literal bearer tokens to uids — a stand-in for Firebase verification. */
class SeedTokenVerifier implements TokenVerifier {
  constructor(private readonly tokens: Record<string, string>) {}

  async verifyIdToken(idToken: string): Promise<{ uid: string }> {
    const uid = this.tokens[idToken];
    if (!uid) throw new Error('token rejected by verifier');
    return { uid };
  }
}

/**
 * Full-pipeline software e2e on the seed corpus, using only in-memory
 * adapters — no cloud, no network. Stages mirror production data flow:
 *
 *   1. ingest  — seed sessions uploaded through the real HTTP boundary
 *   2. worker  — every published event processed to an authoritative result
 *   3. dashboard — athletes/coaches read results through the real HTTP boundary
 *   4. dataset — labeled corpus frozen into an immutable snapshot
 *   5. training — baseline model trained + registered from that snapshot
 *
 * Stages share state deliberately (the blobs ingest wrote are the blobs the
 * worker and trainer read), so tests within each describe block run in order.
 */
describe('seeded end-to-end pipeline', () => {
  let corpus: SeedCorpus;
  let tokenByUser: Record<string, string>;

  // Shared infrastructure state, wired exactly like main.ts but in-memory.
  let users: InMemoryUserDirectory;
  let sharing: InMemorySharingStore;
  let records: InMemorySessionRecordStore;
  let blobs: InMemorySessionBlobStore;
  let events: InMemorySessionEventPublisher;
  let ingestApp: ReturnType<typeof buildServer>;

  let resultStore: InMemoryAuthoritativeResultStore;
  let snapshots: InMemorySnapshotStore;
  let modelRegistry: InMemoryModelRegistry;
  let modelArtifacts: InMemoryModelArtifactStore;

  const authHeader = (userId: string) => ({ authorization: `Bearer ${tokenByUser[userId]}` });

  beforeAll(async () => {
    corpus = buildSeedCorpus();
    tokenByUser = Object.fromEntries(corpus.users.map((u) => [u.userId, u.token]));

    users = new InMemoryUserDirectory();
    sharing = new InMemorySharingStore();
    records = new InMemorySessionRecordStore();
    blobs = new InMemorySessionBlobStore();
    events = new InMemorySessionEventPublisher();
    resultStore = new InMemoryAuthoritativeResultStore();
    snapshots = new InMemorySnapshotStore();
    modelRegistry = new InMemoryModelRegistry();
    modelArtifacts = new InMemoryModelArtifactStore();

    for (const user of corpus.users) {
      await users.setRole(user.userId, user.role);
    }
    for (const grant of corpus.grants) {
      await sharing.grant(grant.athleteId, grant.coachId);
    }

    ingestApp = buildServer({
      tokenVerifier: new SeedTokenVerifier(
        Object.fromEntries(corpus.users.map((u) => [u.token, u.userId])),
      ),
      userDirectory: users,
      sharingStore: sharing,
      sessionRecordStore: records,
      sessionBlobStore: blobs,
      sessionEventPublisher: events,
      rateLimiter: new AllowAllRateLimiter(),
    });
  });

  afterAll(async () => {
    await ingestApp.close();
  });

  describe('stage 1 — ingest: seed sessions cross the real upload boundary', () => {
    it('accepts every seed session with 201 and derives ownership from the token', async () => {
      for (const seeded of corpus.sessions) {
        const response = await ingestApp.inject({
          method: 'POST',
          url: '/v1/sessions',
          headers: authHeader(seeded.ownerUserId),
          payload: seeded.session,
        });
        expect([seeded.slug, response.statusCode]).toEqual([seeded.slug, 201]);
        expect(response.json()).toMatchObject({
          sessionId: seeded.session.sessionId,
          status: 'accepted',
        });

        const record = records.records.get(seeded.session.sessionId);
        expect(record?.ownerAthleteId).toBe(seeded.ownerUserId);
        expect(record?.hasLabels).toBe(seeded.session.labels !== undefined);
        expect(blobs.blobs.has(record!.blobPath)).toBe(true);
      }
      expect(events.published).toHaveLength(corpus.sessions.length);
    });

    it('treats a client retry of an already-stored session as already-accepted (idempotent)', async () => {
      const first = corpus.sessions[0]!;
      const response = await ingestApp.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: authHeader(first.ownerUserId),
        payload: first.session,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'already-accepted' });
      // The retry re-publishes the event; the worker deduplicates downstream.
      expect(events.published).toHaveLength(corpus.sessions.length + 1);
    });

    it('rejects the out-of-order seed fixture with 400 and never queues it', async () => {
      const publishedBefore = events.published.length;
      const response = await ingestApp.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: authHeader(ATHLETE_ASHA),
        payload: corpus.invalidSession as Record<string, unknown>,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('ordered by timestampMs') }),
        ]),
      );
      expect(events.published).toHaveLength(publishedBefore);
    });

    it('rejects unauthenticated uploads with 401', async () => {
      const response = await ingestApp.inject({
        method: 'POST',
        url: '/v1/sessions',
        payload: corpus.sessions[0]!.session,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('stage 2 — worker: every published event becomes an authoritative result', () => {
    const workerBlobs = new WorkerBlobReader();

    it('processes each unique event exactly once, flagging only the divergent session', async () => {
      // The worker reads the same object store ingest wrote to.
      for (const [path, json] of blobs.blobs) workerBlobs.blobs.set(path, json);

      const uniqueEvents = new Map<string, SessionReceivedEvent>();
      for (const event of events.published) uniqueEvents.set(event.sessionId, event);

      for (const event of uniqueEvents.values()) {
        const outcome = await processSessionEvent(event, {
          blobReader: workerBlobs,
          resultStore,
        });
        expect(outcome.outcome).toBe('processed');
      }

      for (const seeded of corpus.sessions) {
        const result = resultStore.results.get(seeded.session.sessionId);
        expect(result?.status).toBe('processed');
        expect([seeded.slug, result?.flaggedForReview]).toEqual([
          seeded.slug,
          seeded.expectFlaggedForReview,
        ]);
        expect(result?.insights?.computedBy).toBe('cloud-worker');
        expect(result?.insights?.insights.length).toBeGreaterThan(0);
      }
    });

    it('reports the matching on-phone result as within tolerance, the tampered one as out of tolerance', async () => {
      const steady = resultStore.results.get(
        corpus.sessions.find((s) => s.slug === 'asha-steady-run')!.session.sessionId,
      )!;
      expect(steady.consistency?.withinTolerance).toBe(true);

      const divergent = resultStore.results.get(
        corpus.sessions.find((s) => s.slug === 'ben-divergent-onphone')!.session.sessionId,
      )!;
      expect(divergent.consistency?.withinTolerance).toBe(false);
      expect(
        divergent.consistency?.comparisons.filter((c) => c.status === 'out-of-tolerance'),
      ).toEqual([expect.objectContaining({ kind: 'cadence' })]);
    });

    it('treats a redelivered event as a duplicate no-op', async () => {
      const outcome = await processSessionEvent(events.published[0]!, {
        blobReader: workerBlobs,
        resultStore,
      });
      expect(outcome).toEqual({ outcome: 'duplicate' });
    });
  });

  describe('stage 3 — dashboard: athletes and coaches read results through the real HTTP boundary', () => {
    let dashboardApp: ReturnType<typeof buildDashboardServer>;

    beforeAll(() => {
      // The dashboard's read model is fed by what the worker persisted.
      const resultQuery = new InMemorySessionResultQuery();
      for (const result of resultStore.results.values()) resultQuery.add(result as SessionResult);

      dashboardApp = buildDashboardServer({
        tokenVerifier: new SeedTokenVerifier(
          Object.fromEntries(corpus.users.map((u) => [u.token, u.userId])),
        ),
        userDirectory: users,
        sharingStore: sharing,
        resultQuery,
      });
    });

    afterAll(async () => {
      await dashboardApp.close();
    });

    it('lists an athlete’s own sessions newest-first', async () => {
      const response = await dashboardApp.inject({
        method: 'GET',
        url: `/v1/athletes/${ATHLETE_ASHA}/sessions`,
        headers: authHeader(ATHLETE_ASHA),
      });
      expect(response.statusCode).toBe(200);
      const { sessions } = response.json();
      expect(sessions).toHaveLength(3);
      const startTimes = sessions.map((s: { sessionStartedAtMs: number }) => s.sessionStartedAtMs);
      expect(startTimes).toEqual([...startTimes].sort((a, b) => b - a));
    });

    it('serves the full authoritative result, including the review flag on the divergent session', async () => {
      const divergent = corpus.sessions.find((s) => s.slug === 'ben-divergent-onphone')!;
      const response = await dashboardApp.inject({
        method: 'GET',
        url: `/v1/athletes/${ATHLETE_BEN}/sessions/${divergent.session.sessionId}`,
        headers: authHeader(ATHLETE_BEN),
      });
      expect(response.statusCode).toBe(200);
      const { result } = response.json();
      expect(result.flaggedForReview).toBe(true);
      expect(result.consistency.withinTolerance).toBe(false);
    });

    it('returns trends across an athlete’s sessions', async () => {
      const response = await dashboardApp.inject({
        method: 'GET',
        url: `/v1/athletes/${ATHLETE_ASHA}/trends`,
        headers: authHeader(ATHLETE_ASHA),
      });
      expect(response.statusCode).toBe(200);
      const { trends } = response.json();
      expect(trends.length).toBeGreaterThan(0);
    });

    it('shows the coach exactly the athletes who granted access', async () => {
      const response = await dashboardApp.inject({
        method: 'GET',
        url: '/v1/coach/athletes',
        headers: authHeader(COACH_DANA),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().athletes).toEqual([
        { athleteId: ATHLETE_ASHA },
        { athleteId: ATHLETE_BEN },
      ]);
    });

    it('lets the coach read a sharing athlete’s data but denies non-shared and cross-athlete reads', async () => {
      const shared = await dashboardApp.inject({
        method: 'GET',
        url: `/v1/athletes/${ATHLETE_ASHA}/sessions`,
        headers: authHeader(COACH_DANA),
      });
      expect(shared.statusCode).toBe(200);

      const notShared = await dashboardApp.inject({
        method: 'GET',
        url: `/v1/athletes/${ATHLETE_CHIKE}/sessions`,
        headers: authHeader(COACH_DANA),
      });
      expect(notShared.statusCode).toBe(403);

      const crossAthlete = await dashboardApp.inject({
        method: 'GET',
        url: `/v1/athletes/${ATHLETE_BEN}/sessions`,
        headers: authHeader(ATHLETE_ASHA),
      });
      expect(crossAthlete.statusCode).toBe(403);

      const athleteOnCoachRoute = await dashboardApp.inject({
        method: 'GET',
        url: '/v1/coach/athletes',
        headers: authHeader(ATHLETE_CHIKE),
      });
      expect(athleteOnCoachRoute.statusCode).toBe(403);
    });
  });

  describe('stage 4 — dataset store: the labeled seed corpus freezes into an immutable snapshot', () => {
    it('snapshots exactly the labeled sessions', async () => {
      // Production binds this query over the ingest API's session records;
      // here it is fed from the very records stage 1 created.
      const labeledSessions = new InMemoryLabeledSessionQuery();
      for (const record of records.records.values()) {
        if (!record.hasLabels || !record.labels) continue;
        const entry: DatasetEntry = {
          sessionId: record.sessionId,
          ownerAthleteId: record.ownerAthleteId,
          blobPath: record.blobPath,
          sportProfileId: record.sportProfileId,
          startedAtMs: record.startedAtMs,
          sampleCount: record.sampleCount,
          labels: record.labels,
        };
        labeledSessions.add(entry);
      }

      const snapshot = await createDatasetSnapshot(
        { name: 'running-labeled', sportProfileId: 'running-v1' },
        { labeledSessions, snapshots },
      );

      expect(snapshot.version).toBe(1);
      const labeledSlugs = corpus.sessions.filter((s) => s.session.labels !== undefined);
      expect(snapshot.entries).toHaveLength(labeledSlugs.length);
      expect(new Set(snapshot.entries.map((e) => e.sessionId))).toEqual(
        new Set(labeledSlugs.map((s) => s.session.sessionId)),
      );
    });
  });

  describe('stage 5 — training: a baseline model trains from the frozen snapshot', () => {
    const trainingBlobs = new TrainingBlobReader();

    it('trains, stores the artifact, and registers a model version with provenance', async () => {
      for (const [path, json] of blobs.blobs) trainingBlobs.blobs.set(path, json);

      const outcome = await runTrainingRun(
        { datasetName: 'running-labeled' },
        {
          snapshots,
          blobReader: trainingBlobs,
          artifacts: modelArtifacts,
          registry: modelRegistry,
        },
      );

      expect(outcome.outcome).toBe('trained');
      if (outcome.outcome !== 'trained') return;
      expect(outcome.record).toMatchObject({
        sportProfileId: 'running-v1',
        datasetName: 'running-labeled',
        datasetVersion: 1,
      });
      expect(outcome.record.metrics['skippedEntries']).toBe(0);
      expect(modelArtifacts.artifacts.has(outcome.record.artifactPath)).toBe(true);

      const artifact = JSON.parse(modelArtifacts.artifacts.get(outcome.record.artifactPath)!);
      expect(artifact.parameters.asymmetryThresholdPercent).toBeGreaterThanOrEqual(1);
      expect(artifact.parameters.asymmetryThresholdPercent).toBeLessThanOrEqual(20);
    });

    it('is idempotent: re-triggering the same run reports already-trained', async () => {
      const outcome = await runTrainingRun(
        { datasetName: 'running-labeled' },
        {
          snapshots,
          blobReader: trainingBlobs,
          artifacts: modelArtifacts,
          registry: modelRegistry,
        },
      );
      expect(outcome.outcome).toBe('already-trained');
    });
  });
});
