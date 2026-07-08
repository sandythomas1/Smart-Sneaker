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

function buildSession(options: BuildOptions): Session {
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
  return validation.data;
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

export function buildSeedCorpus(): SeedCorpus {
  const users: SeedUser[] = [
    { userId: ATHLETE_ASHA, role: 'athlete', token: 'seed-token-asha' },
    { userId: ATHLETE_BEN, role: 'athlete', token: 'seed-token-ben' },
    { userId: ATHLETE_CHIKE, role: 'athlete', token: 'seed-token-chike' },
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
      session: buildSession({
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
      session: buildSession({
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
      session: buildSession({
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
      session: buildSession({
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
      session: buildSession({
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
      session: buildSession({
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
      session: buildSession({ idIndex: 7, startedAtMs: SEED_EPOCH_MS }),
    },
  ];

  return { users, grants, sessions, invalidSession: buildInvalidSession() };
}
