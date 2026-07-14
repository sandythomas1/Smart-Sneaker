import type { Session, SessionLabels } from '@smart-sneaker/data-contracts';
import { SessionSchema, validateContract } from '@smart-sneaker/data-contracts';
import {
  computeSessionInsights,
  defaultSportProfileRegistry,
  generateSyntheticRun,
  loadSportProfile,
  RUNNING_PROFILE_ID,
  SyntheticRunOptions,
} from '@smart-sneaker/insights-engine';

/**
 * Deterministic seed corpus for local development and the full-pipeline e2e
 * test: a small roster of users, sharing grants, and contract-valid sessions
 * covering every pipeline path — clean runs, on-phone consistency (matching
 * and divergent), BLE dropouts, asymmetric loading, and labeled training data.
 *
 * Everything is generated from the insights engine's synthetic-run generator
 * with fixed IDs and timestamps, so two invocations produce byte-identical
 * fixtures and every session self-validates against SessionSchema at build time.
 */

export interface SeedUser {
  userId: string;
  role: 'athlete' | 'coach';
  /** Literal bearer token a fake TokenVerifier maps back to userId. */
  token: string;
}

export interface SeedGrant {
  athleteId: string;
  coachId: string;
}

export interface SeedSession {
  /** Stable, human-readable fixture name (also the seed file name). */
  slug: string;
  ownerUserId: string;
  description: string;
  /** Whether the worker should flag this session for human review. */
  expectFlaggedForReview: boolean;
  session: Session;
  /** The exact synthetic-run options that produced `session` — the demo's
   * capture view replays these, so what it "records" IS seeded data. */
  runOptions: SyntheticRunOptions;
}

export interface SeedCorpus {
  users: SeedUser[];
  grants: SeedGrant[];
  sessions: SeedSession[];
  /** A deliberately contract-invalid payload (out-of-order samples) the ingest API must reject with 400. */
  invalidSession: unknown;
}

export const ATHLETE_ASHA = 'athlete-asha';
export const ATHLETE_BEN = 'athlete-ben';
export const ATHLETE_CHIKE = 'athlete-chike';
/** Athlete with zero sessions — the empty-state fixture (spec 002 Req. 7d). */
export const ATHLETE_MIRA = 'athlete-mira';
export const COACH_DANA = 'coach-dana';

/** 2026-06-01T08:00:00Z — an arbitrary but fixed "training week" anchor. */
const SEED_EPOCH_MS = Date.UTC(2026, 5, 1, 8, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Valid v4-shaped UUIDs that are stable across runs — fixtures must be diffable. */
function seedUuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(10).padStart(12, '0')}`;
}

/** Baseline capture: 100 Hz dual-foot running at ~171 steps/min. */
const BASE_RUN: SyntheticRunOptions = {
  durationMs: 30_000,
  strideIntervalMs: 700,
  contactMs: 250,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

interface BuildOptions {
  idIndex: number;
  startedAtMs: number;
  run?: Partial<SyntheticRunOptions>;
  labels?: SessionLabels;
  /** 'matching' embeds the engine's own on-phone result; 'divergent' tampers
   * cadence by +30% so the worker's ±10% consistency check must flag it. */
  onPhone?: 'matching' | 'divergent';
}

function buildSession(options: BuildOptions): { session: Session; runOptions: SyntheticRunOptions } {
  const runOptions: SyntheticRunOptions = { ...BASE_RUN, ...options.run };
  const { session: generated } = generateSyntheticRun(runOptions);

  let session: Session = {
    ...generated,
    sessionId: seedUuid(options.idIndex),
    startedAtMs: options.startedAtMs,
    deviceId: `shoe-module-${String(options.idIndex).padStart(3, '0')}`,
    ...(options.labels ? { labels: options.labels } : {}),
  };

  if (options.onPhone) {
    const profile = loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry);
    const onPhoneInsights = computeSessionInsights(session, profile, {
      computedBy: 'on-phone',
      nowMs: options.startedAtMs + runOptions.durationMs,
    });
    if (options.onPhone === 'divergent') {
      onPhoneInsights.insights = onPhoneInsights.insights.map((insight) =>
        insight.kind === 'cadence' && typeof insight.value === 'number'
          ? { ...insight, value: insight.value * 1.3 }
          : insight,
      );
    }
    session = { ...session, onPhoneInsights };
  }

  // Fixtures are only useful if they are contract-valid by construction.
  const validation = validateContract(SessionSchema, session);
  if (!validation.ok) {
    const detail = validation.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`seed session ${options.idIndex} failed contract validation — ${detail}`);
  }
  return { session: validation.data, runOptions };
}

/** A tiny raw payload with samples out of timestamp order — must be rejected at ingest, never queued. */
function buildInvalidSession(): unknown {
  return {
    schemaVersion: 1,
    sessionId: seedUuid(999),
    sportProfileId: RUNNING_PROFILE_ID,
    startedAtMs: SEED_EPOCH_MS,
    samples: [
      {
        timestampMs: 10,
        foot: 'left',
        pressure: [1, 2, 3, 4],
        imu: { accel: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } },
      },
      {
        timestampMs: 0,
        foot: 'right',
        pressure: [1, 2, 3, 4],
        imu: { accel: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } },
      },
    ],
  };
}

/**
 * Six weeks of Asha training for the trends view (spec 002 Req. 3): cadence
 * quickens (stride interval shrinks) and loading drifts toward the left foot
 * session by session, so the longitudinal story is visible, not noise.
 */
const TREND_RUNS: ReadonlyArray<{ strideIntervalMs: number; leftPeak: number }> = [
  { strideIntervalMs: 726, leftPeak: 8.0 },
  { strideIntervalMs: 720, leftPeak: 8.15 },
  { strideIntervalMs: 714, leftPeak: 8.3 },
  { strideIntervalMs: 708, leftPeak: 8.45 },
  { strideIntervalMs: 702, leftPeak: 8.6 },
  { strideIntervalMs: 698, leftPeak: 8.75 },
  { strideIntervalMs: 692, leftPeak: 8.9 },
  { strideIntervalMs: 688, leftPeak: 9.05 },
  { strideIntervalMs: 682, leftPeak: 9.2 },
];

/**
 * Dropout windows for the low-confidence fixture (spec 002 Req. 7b): a 120ms
 * mid-stance capture gap on two of every three left-foot stances drags the
 * left-foot cycles' mean confidence (⅔ × 0.4 + ⅓ × 0.9 ≈ 0.57) under the
 * engine's 0.6 reliability bar, while one gap per four right-foot stances
 * leaves right-side insights reliable but visibly below high confidence.
 */
function buildNoisyDropouts(
  options: SyntheticRunOptions,
): NonNullable<SyntheticRunOptions['dropouts']> {
  const dropouts: NonNullable<SyntheticRunOptions['dropouts']> = [];
  for (const foot of ['left', 'right'] as const) {
    const offset = foot === 'left' ? 0 : options.rightFootOffsetMs;
    const hit = (i: number): boolean => (foot === 'left' ? i % 3 !== 0 : i % 4 === 0);
    for (
      let i = 0, strikeMs = offset;
      strikeMs + options.contactMs <= options.durationMs;
      i += 1, strikeMs += options.strideIntervalMs
    ) {
      if (hit(i)) dropouts.push({ foot, startMs: strikeMs + 60, endMs: strikeMs + 180 });
    }
  }
  return dropouts;
}

export function buildSeedCorpus(): SeedCorpus {
  const users: SeedUser[] = [
    { userId: ATHLETE_ASHA, role: 'athlete', token: 'seed-token-asha' },
    { userId: ATHLETE_BEN, role: 'athlete', token: 'seed-token-ben' },
    { userId: ATHLETE_CHIKE, role: 'athlete', token: 'seed-token-chike' },
    { userId: ATHLETE_MIRA, role: 'athlete', token: 'seed-token-mira' },
    { userId: COACH_DANA, role: 'coach', token: 'seed-token-dana' },
  ];

  const grants: SeedGrant[] = [
    { athleteId: ATHLETE_ASHA, coachId: COACH_DANA },
    { athleteId: ATHLETE_BEN, coachId: COACH_DANA },
  ];

  const sessions: SeedSession[] = [
    {
      slug: 'asha-steady-run',
      ownerUserId: ATHLETE_ASHA,
      description:
        'Clean 60s run with a matching on-phone result — processes cleanly, consistency within tolerance.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 1,
        startedAtMs: SEED_EPOCH_MS,
        run: { durationMs: 60_000 },
        onPhone: 'matching',
      }),
    },
    {
      slug: 'asha-labeled-normal',
      ownerUserId: ATHLETE_ASHA,
      description: 'Labeled "normal" protocol session — part of the labeled training corpus.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 2,
        startedAtMs: SEED_EPOCH_MS + 1 * DAY_MS,
        labels: { conditions: ['normal'], notes: 'Even loading, steady pace protocol run.' },
      }),
    },
    {
      slug: 'asha-labeled-favor-left',
      ownerUserId: ATHLETE_ASHA,
      description:
        'Labeled asymmetric session deliberately loading the left foot — trains the asymmetry threshold.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 3,
        startedAtMs: SEED_EPOCH_MS + 2 * DAY_MS,
        run: { peakPressureByFoot: { left: 10, right: 6 } },
        labels: { conditions: ['favor-left-leg'], notes: 'Deliberate left-leg loading protocol.' },
      }),
    },
    {
      slug: 'ben-dropout-run',
      ownerUserId: ATHLETE_BEN,
      description: 'Run with a 2s right-foot BLE dropout mid-capture — still processes.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 4,
        startedAtMs: SEED_EPOCH_MS,
        run: {
          durationMs: 45_000,
          dropouts: [{ foot: 'right', startMs: 20_000, endMs: 22_000 }],
        },
      }),
    },
    {
      slug: 'ben-labeled-favor-right',
      ownerUserId: ATHLETE_BEN,
      description:
        'Labeled asymmetric session deliberately loading the right foot — the corpus covers both directions.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 5,
        startedAtMs: SEED_EPOCH_MS + 1 * DAY_MS,
        run: { peakPressureByFoot: { left: 6, right: 10 } },
        labels: { conditions: ['favor-right-leg'], notes: 'Deliberate right-leg loading protocol.' },
      }),
    },
    {
      slug: 'ben-divergent-onphone',
      ownerUserId: ATHLETE_BEN,
      description:
        'On-phone cadence tampered +30% — the worker must flag the consistency mismatch for review.',
      expectFlaggedForReview: true,
      ...buildSession({
        idIndex: 6,
        startedAtMs: SEED_EPOCH_MS + 2 * DAY_MS,
        onPhone: 'divergent',
      }),
    },
    {
      slug: 'chike-private-run',
      ownerUserId: ATHLETE_CHIKE,
      description: 'Run owned by an athlete who shares with no coach — the access-control probe.',
      expectFlaggedForReview: false,
      ...buildSession({ idIndex: 7, startedAtMs: SEED_EPOCH_MS }),
    },
    ...TREND_RUNS.map((run, i) => ({
      slug: `asha-trend-${i + 1}`,
      ownerUserId: ATHLETE_ASHA,
      description:
        'Part of a six-week training series with drifting cadence and left-side loading — the trends-view corpus.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 10 + i,
        startedAtMs: SEED_EPOCH_MS + (4 + i * 4) * DAY_MS,
        run: {
          strideIntervalMs: run.strideIntervalMs,
          peakPressureByFoot: { left: run.leftPeak, right: 8 },
        },
      }),
    })),
    {
      slug: 'asha-noisy-run',
      ownerUserId: ATHLETE_ASHA,
      description:
        'Run riddled with mid-stance capture gaps: left-foot insights fall below the reliability bar, the rest stay reliable but below high confidence — the low-confidence/unreliable fixture.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 19,
        startedAtMs: SEED_EPOCH_MS + 40 * DAY_MS,
        run: {
          durationMs: 60_000,
          dropouts: buildNoisyDropouts({ ...BASE_RUN, durationMs: 60_000 }),
        },
      }),
    },
    {
      slug: 'asha-phone-only-run',
      ownerUserId: ATHLETE_ASHA,
      description:
        'Run carrying an on-phone result; the demo presents it as not-yet-uploaded ("on phone only") while the e2e uploads it normally.',
      expectFlaggedForReview: false,
      ...buildSession({
        idIndex: 20,
        startedAtMs: SEED_EPOCH_MS + 41 * DAY_MS,
        onPhone: 'matching',
      }),
    },
    {
      slug: 'asha-cooldown-run',
      ownerUserId: ATHLETE_ASHA,
      description:
        'Ordinary run the demo generator withholds from the worker stage to show the "Processing…" state; the e2e processes it normally.',
      expectFlaggedForReview: false,
      ...buildSession({ idIndex: 21, startedAtMs: SEED_EPOCH_MS + 43 * DAY_MS }),
    },
    {
      slug: 'asha-corrupted-blob',
      ownerUserId: ATHLETE_ASHA,
      description:
        'Ordinary run whose stored blob the demo generator corrupts after upload, exercising the worker\'s persisted failed-validation path; the e2e processes it normally.',
      expectFlaggedForReview: false,
      ...buildSession({ idIndex: 22, startedAtMs: SEED_EPOCH_MS + 42 * DAY_MS }),
    },
  ];

  return { users, grants, sessions, invalidSession: buildInvalidSession() };
}
