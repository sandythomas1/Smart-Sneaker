import type { SessionReceivedEvent, SessionResult } from '@smart-sneaker/data-contracts';
import {
  AllowAllRateLimiter,
  buildServer,
  InMemorySessionBlobStore,
  InMemorySessionEventPublisher,
  InMemorySessionRecordStore,
  InMemorySharingStore,
  InMemoryUserDirectory,
} from '@smart-sneaker/ingest-api';
import {
  InMemoryAuthoritativeResultStore,
  InMemorySessionBlobReader,
  processSessionEvent,
} from '@smart-sneaker/session-worker';
import { buildDashboardServer, buildTrends, InMemorySessionResultQuery } from '@smart-sneaker/dashboard';
import {
  DemoArtifact,
  DemoArtifactSchema,
  DemoCoachAthlete,
  DemoPersona,
  DemoPipelineScenario,
  DemoPipelineStage,
  DemoSessionDetail,
  DemoSessionSummary,
} from '../../../apps/demo-web/src/data/demo-artifact';
import { ATHLETE_ASHA, ATHLETE_BEN, ATHLETE_CHIKE, buildSeedCorpus, COACH_DANA, SeedSession } from './seed';
import { SeedTokenVerifier } from './harness';

/**
 * Generate the demo frontend's data artifact (spec 002 Req. 6, 12) by running
 * the REAL in-memory pipeline over the seed corpus — the same wiring as
 * test/pipeline.test.ts: ingest (real HTTP boundary) → worker → dashboard
 * reads. Every insight the demo displays came out of this run; nothing is
 * hand-written.
 *
 * Demo-only scenario steering (all seeded sessions process normally in e2e):
 *   - PHONE_ONLY_SLUG is never uploaded         → "on phone only" state
 *   - PROCESSING_SLUG is withheld from the worker → "Processing…" state
 *   - CORRUPTED_SLUG's stored blob is corrupted  → persisted failed-validation
 *
 * Any unexpected stage outcome makes the run exit non-zero WITHOUT writing,
 * so a broken pipeline can never ship a healthy-looking demo. Output is
 * byte-deterministic: worker clocks derive from session timestamps and the
 * ingest-generated correlationId is normalized to the sessionId.
 *
 * The CLI wrapper (write-demo-data.ts) writes the artifact to disk.
 * Run with: npm run demo-data --workspace @smart-sneaker/e2e
 */

const PHONE_ONLY_SLUG = 'asha-phone-only-run';
const PROCESSING_SLUG = 'asha-cooldown-run';
const CORRUPTED_SLUG = 'asha-corrupted-blob';
/** Capture-view replay source: its dropout drives the "Reconnecting…" state. */
const CAPTURE_SLUG = 'ben-dropout-run';

function personaDisplayName(userId: string, role: 'athlete' | 'coach'): string {
  const bare = userId.replace(/^(athlete|coach)-/, '');
  const name = bare.charAt(0).toUpperCase() + bare.slice(1);
  return role === 'coach' ? `Coach ${name}` : name;
}

interface StageOutcome {
  problems: string[];
  scenarios: DemoPipelineScenario[];
}

export interface DemoDataRun {
  /** Present only when the pipeline behaved exactly as expected. */
  artifact?: DemoArtifact;
  problems: string[];
  /** One line per stage, for CLI/CI logs. */
  notes: string[];
}

export async function generateDemoArtifact(): Promise<DemoDataRun> {
  const problems: string[] = [];
  const scenarios: DemoPipelineScenario[] = [];
  const notes: string[] = [];
  const note = (line: string): void => {
    notes.push(line);
  };

  // ── stage 0: capture (seed corpus generation — throws on contract violation)
  const corpus = buildSeedCorpus();
  const totalSamples = corpus.sessions.reduce((sum, s) => sum + s.session.samples.length, 0);
  const sessionsBySlug = new Map(corpus.sessions.map((s) => [s.slug, s]));
  const sessionsById = new Map(corpus.sessions.map((s) => [s.session.sessionId, s]));
  for (const slug of [PHONE_ONLY_SLUG, PROCESSING_SLUG, CORRUPTED_SLUG, CAPTURE_SLUG]) {
    if (!sessionsBySlug.has(slug)) throw new Error(`demo scenario slug missing from corpus: ${slug}`);
  }
  note(`capture: ${corpus.sessions.length} seed sessions (${totalSamples} samples)`);

  // ── stage 1: ingest through the real HTTP boundary
  const users = new InMemoryUserDirectory();
  const sharing = new InMemorySharingStore();
  const records = new InMemorySessionRecordStore();
  const blobs = new InMemorySessionBlobStore();
  const events = new InMemorySessionEventPublisher();
  for (const user of corpus.users) await users.setRole(user.userId, user.role);
  for (const grant of corpus.grants) await sharing.grant(grant.athleteId, grant.coachId);

  const tokenByUser = Object.fromEntries(corpus.users.map((u) => [u.userId, u.token]));
  const verifier = new SeedTokenVerifier(
    Object.fromEntries(corpus.users.map((u) => [u.token, u.userId])),
  );
  const ingestApp = buildServer({
    tokenVerifier: verifier,
    userDirectory: users,
    sharingStore: sharing,
    sessionRecordStore: records,
    sessionBlobStore: blobs,
    sessionEventPublisher: events,
    rateLimiter: new AllowAllRateLimiter(),
  });

  const uploaded = corpus.sessions.filter((s) => s.slug !== PHONE_ONLY_SLUG);
  for (const seeded of uploaded) {
    const response = await ingestApp.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${tokenByUser[seeded.ownerUserId]}` },
      payload: seeded.session,
    });
    if (response.statusCode !== 201) {
      problems.push(`ingest: ${seeded.slug} expected 201, got ${response.statusCode}`);
    }
  }
  const invalidResponse = await ingestApp.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: { authorization: `Bearer ${tokenByUser[ATHLETE_ASHA]}` },
    payload: corpus.invalidSession as Record<string, unknown>,
  });
  scenarios.push({
    slug: 'invalid-session-rejected',
    description: 'A contract-invalid upload (out-of-order samples) must be rejected at ingest with 400.',
    status: invalidResponse.statusCode === 400 ? 'pass' : 'fail',
    detail: `ingest answered ${invalidResponse.statusCode}`,
  });
  const anonResponse = await ingestApp.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: uploaded[0]!.session,
  });
  scenarios.push({
    slug: 'unauthenticated-upload-rejected',
    description: 'An upload without a bearer token must be rejected with 401.',
    status: anonResponse.statusCode === 401 ? 'pass' : 'fail',
    detail: `ingest answered ${anonResponse.statusCode}`,
  });
  await ingestApp.close();
  note(`ingest: ${uploaded.length} sessions uploaded, invalid + unauthenticated probes answered`);

  // ── stage 2: worker over the published events (minus demo-steered scenarios)
  const corrupted = sessionsBySlug.get(CORRUPTED_SLUG)!;
  const corruptedRecord = records.records.get(corrupted.session.sessionId)!;
  blobs.blobs.set(corruptedRecord.blobPath, '{"schemaVersion":1,"samples":[truncated');

  const workerBlobs = new InMemorySessionBlobReader();
  for (const [path, json] of blobs.blobs) workerBlobs.blobs.set(path, json);
  const resultStore = new InMemoryAuthoritativeResultStore();

  const uniqueEvents = new Map<string, SessionReceivedEvent>();
  for (const event of events.published) uniqueEvents.set(event.sessionId, event);

  let processedCount = 0;
  for (const event of uniqueEvents.values()) {
    const seeded = sessionsById.get(event.sessionId)!;
    if (seeded.slug === PROCESSING_SLUG) continue; // demo shows this one mid-pipeline
    const outcome = await processSessionEvent(event, {
      blobReader: workerBlobs,
      resultStore,
      // Deterministic clock: the worker "runs" a minute after the session ends.
      nowMs: () => seeded.session.startedAtMs + seeded.runOptions.durationMs + 60_000,
    });

    const expectFailed = seeded.slug === CORRUPTED_SLUG;
    const expectedOutcome = expectFailed ? 'failed-validation' : 'processed';
    if (outcome.outcome !== expectedOutcome) {
      problems.push(`worker: ${seeded.slug} expected ${expectedOutcome}, got ${outcome.outcome}`);
    }
    if (outcome.outcome === 'processed') {
      processedCount += 1;
      if (outcome.flaggedForReview !== seeded.expectFlaggedForReview) {
        problems.push(
          `worker: ${seeded.slug} expected flaggedForReview=${seeded.expectFlaggedForReview}, got ${outcome.flaggedForReview}`,
        );
      }
    }
  }
  note(`worker: ${processedCount} sessions processed, 1 corrupted → failed-validation, 1 withheld`);

  // Per-session scenarios: what the software was expected to do, and did it.
  for (const seeded of corpus.sessions) {
    const result = resultStore.results.get(seeded.session.sessionId);
    const { status, detail } = describeSessionScenario(seeded, result as SessionResult | undefined);
    scenarios.push({ slug: seeded.slug, description: seeded.description, status, detail });
  }

  // ── stage 3: results read back through the real dashboard boundary
  const resultQuery = new InMemorySessionResultQuery();
  for (const result of resultStore.results.values()) resultQuery.add(result as SessionResult);
  const dashboardApp = buildDashboardServer({
    tokenVerifier: verifier,
    userDirectory: users,
    sharingStore: sharing,
    resultQuery,
  });
  const rosterResponse = await dashboardApp.inject({
    method: 'GET',
    url: '/v1/coach/athletes',
    headers: { authorization: `Bearer ${tokenByUser[COACH_DANA]}` },
  });
  const rosterIds =
    rosterResponse.statusCode === 200
      ? (rosterResponse.json().athletes as Array<{ athleteId: string }>).map((a) => a.athleteId)
      : [];
  const rosterOk =
    rosterIds.length === 2 && rosterIds.includes(ATHLETE_ASHA) && rosterIds.includes(ATHLETE_BEN);
  scenarios.push({
    slug: 'coach-sees-only-shared',
    description:
      'The coach roster contains exactly the athletes who granted sharing — a non-sharing athlete never appears.',
    status: rosterOk && !rosterIds.includes(ATHLETE_CHIKE) ? 'pass' : 'fail',
    detail: `roster: ${rosterIds.join(', ') || '(unavailable)'}`,
  });
  const nonSharedRead = await dashboardApp.inject({
    method: 'GET',
    url: `/v1/athletes/${ATHLETE_CHIKE}/sessions`,
    headers: { authorization: `Bearer ${tokenByUser[COACH_DANA]}` },
  });
  const crossAthleteRead = await dashboardApp.inject({
    method: 'GET',
    url: `/v1/athletes/${ATHLETE_BEN}/sessions`,
    headers: { authorization: `Bearer ${tokenByUser[ATHLETE_ASHA]}` },
  });
  scenarios.push({
    slug: 'non-shared-access-denied',
    description:
      'Reads of a non-sharing athlete by the coach, or of another athlete by an athlete, are denied with 403.',
    status: nonSharedRead.statusCode === 403 && crossAthleteRead.statusCode === 403 ? 'pass' : 'fail',
    detail: `coach→non-shared: ${nonSharedRead.statusCode}, athlete→athlete: ${crossAthleteRead.statusCode}`,
  });
  await dashboardApp.close();
  const failedScenarios = scenarios.filter((s) => s.status === 'fail');
  for (const scenario of failedScenarios) {
    problems.push(`scenario ${scenario.slug}: ${scenario.detail ?? 'failed'}`);
  }
  note(`results: dashboard access checks ran, ${scenarios.length} scenarios recorded`);

  if (problems.length > 0) {
    return { problems, notes };
  }

  // ── assemble + validate the artifact
  const artifact = assembleArtifact(corpus, resultStore, scenarios, {
    totalSamples,
    processedCount,
  });
  return { artifact: DemoArtifactSchema.parse(artifact), problems, notes };
}

function describeSessionScenario(
  seeded: SeedSession,
  result: SessionResult | undefined,
): { status: 'pass' | 'fail'; detail: string } {
  if (seeded.slug === PHONE_ONLY_SLUG) {
    return {
      status: result === undefined ? 'pass' : 'fail',
      detail: 'kept on phone — no upload, no cloud result (by design)',
    };
  }
  if (seeded.slug === PROCESSING_SLUG) {
    return {
      status: result === undefined ? 'pass' : 'fail',
      detail: 'uploaded, event published, worker not yet run (by design)',
    };
  }
  if (seeded.slug === CORRUPTED_SLUG) {
    return {
      status: result?.status === 'failed-validation' ? 'pass' : 'fail',
      detail: `worker persisted ${result?.status ?? 'nothing'} for the corrupted blob`,
    };
  }
  if (result?.status !== 'processed') {
    return { status: 'fail', detail: `expected a processed result, found ${result?.status ?? 'none'}` };
  }
  if (result.flaggedForReview !== seeded.expectFlaggedForReview) {
    return {
      status: 'fail',
      detail: `flaggedForReview=${result.flaggedForReview}, expected ${seeded.expectFlaggedForReview}`,
    };
  }
  return {
    status: 'pass',
    detail: seeded.expectFlaggedForReview
      ? 'processed and flagged for review, as the divergence demands'
      : 'processed cleanly by the shared insights engine',
  };
}

function assembleArtifact(
  corpus: ReturnType<typeof buildSeedCorpus>,
  resultStore: InMemoryAuthoritativeResultStore,
  scenarios: DemoPipelineScenario[],
  counts: { totalSamples: number; processedCount: number },
): DemoArtifact {
  const personas: DemoPersona[] = corpus.users.map((user) => ({
    id: user.userId,
    displayName: personaDisplayName(user.userId, user.role),
    role: user.role,
  }));

  const summaries: DemoSessionSummary[] = corpus.sessions
    .map((seeded) => {
      const result = resultStore.results.get(seeded.session.sessionId) as SessionResult | undefined;
      const insights =
        result?.insights?.insights ?? seeded.session.onPhoneInsights?.insights ?? [];
      const status =
        seeded.slug === PHONE_ONLY_SLUG
          ? ('on-phone-only' as const)
          : seeded.slug === PROCESSING_SLUG
            ? ('processing' as const)
            : ('synced' as const);
      return {
        sessionId: seeded.session.sessionId,
        slug: seeded.slug,
        ownerAthleteId: seeded.ownerUserId,
        sportProfileId: seeded.session.sportProfileId,
        startedAtMs: seeded.session.startedAtMs,
        durationMs: seeded.runOptions.durationMs,
        status,
        dataQualityWarning: insights.some((i) => !i.reliable || i.note !== undefined),
        flaggedForReview: result?.flaggedForReview ?? false,
        failed: result?.status === 'failed-validation',
      };
    })
    .sort((a, b) => b.startedAtMs - a.startedAtMs || a.sessionId.localeCompare(b.sessionId));

  const details: Record<string, DemoSessionDetail> = {};
  for (const seeded of corpus.sessions) {
    const result = resultStore.results.get(seeded.session.sessionId) as SessionResult | undefined;
    if (result) {
      // correlationId is minted per upload; pin it to the sessionId so the
      // artifact is byte-identical across runs. Insight values are untouched.
      details[seeded.session.sessionId] = {
        sessionId: seeded.session.sessionId,
        result: { ...result, correlationId: seeded.session.sessionId },
      };
    } else if (seeded.slug === PHONE_ONLY_SLUG && seeded.session.onPhoneInsights) {
      details[seeded.session.sessionId] = {
        sessionId: seeded.session.sessionId,
        onPhoneInsights: seeded.session.onPhoneInsights,
      };
    }
  }

  const trends: Record<string, ReturnType<typeof buildTrends>> = {};
  for (const user of corpus.users) {
    if (user.role !== 'athlete') continue;
    const athleteResults = [...resultStore.results.values()].filter(
      (r) => r.ownerAthleteId === user.userId,
    ) as SessionResult[];
    trends[user.userId] = buildTrends(athleteResults);
  }

  const coachRosters: Record<string, DemoCoachAthlete[]> = {};
  for (const user of corpus.users) {
    if (user.role !== 'coach') continue;
    coachRosters[user.userId] = corpus.grants
      .filter((grant) => grant.coachId === user.userId)
      .map((grant) => {
        const athleteSummaries = summaries.filter((s) => s.ownerAthleteId === grant.athleteId);
        const roster: DemoCoachAthlete = {
          athleteId: grant.athleteId,
          displayName: personaDisplayName(grant.athleteId, 'athlete'),
          sessionCount: athleteSummaries.length,
        };
        if (athleteSummaries[0]) roster.lastSession = athleteSummaries[0];
        return roster;
      })
      .sort((a, b) => a.athleteId.localeCompare(b.athleteId));
  }

  const capture = sessionsBySlugOf(corpus, CAPTURE_SLUG);
  const stages: DemoPipelineStage[] = [
    {
      id: 'capture',
      label: 'Capture',
      status: 'pass',
      detail: `${corpus.sessions.length} synthetic sessions (${counts.totalSamples} samples) generated and contract-validated`,
    },
    {
      id: 'segmentation-insights',
      label: 'Segmentation & Insights',
      status: 'pass',
      detail: `shared insights engine segmented and computed insights for ${counts.processedCount} sessions`,
    },
    {
      id: 'ingest',
      label: 'Ingest',
      status: 'pass',
      detail: 'every upload crossed the real HTTP boundary; invalid and unauthenticated probes rejected',
    },
    {
      id: 'worker',
      label: 'Worker',
      status: 'pass',
      detail: `${counts.processedCount} processed, 1 corrupted blob persisted as failed-validation, 1 still in flight`,
    },
    {
      id: 'results',
      label: 'Results',
      status: 'pass',
      detail: 'dashboard reads verified: roster, sharing gates, and cross-athlete denials all held',
    },
  ];

  return {
    schemaVersion: 1,
    personas,
    sessions: summaries,
    details,
    trends,
    coachRosters,
    capture: {
      sourceSlug: capture.slug,
      durationMs: capture.runOptions.durationMs,
      strideIntervalMs: capture.runOptions.strideIntervalMs,
      contactMs: capture.runOptions.contactMs,
      sampleIntervalMs: capture.runOptions.sampleIntervalMs,
      rightFootOffsetMs: capture.runOptions.rightFootOffsetMs,
      dropouts: capture.runOptions.dropouts ?? [],
    },
    pipeline: { stages, scenarios },
  };
}

function sessionsBySlugOf(corpus: ReturnType<typeof buildSeedCorpus>, slug: string): SeedSession {
  const seeded = corpus.sessions.find((s) => s.slug === slug);
  if (!seeded) throw new Error(`seed session not found: ${slug}`);
  return seeded;
}

