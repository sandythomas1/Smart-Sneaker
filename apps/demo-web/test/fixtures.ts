import type { InsightResult, InsightSet, SessionResult } from '@smart-sneaker/data-contracts';
import type {
  DemoArtifact,
  DemoSessionDetail,
  DemoSessionSummary,
} from '../src/data/demo-artifact';

/**
 * Hand-rolled minimal artifact for unit tests. Small on purpose: tests assert
 * derivation/gating behavior, not seed-corpus content — the generator
 * integration test covers the real artifact.
 */

export const FIX_ASHA = 'athlete-fixture-asha';
export const FIX_MIRA = 'athlete-fixture-mira';
export const FIX_BEN = 'athlete-fixture-ben';
export const FIX_COACH = 'coach-fixture-dana';

export function fixtureUuid(n: number): string {
  return `00000000-0000-4000-9000-${n.toString(10).padStart(12, '0')}`;
}

export function fixtureInsight(overrides: Partial<InsightResult> = {}): InsightResult {
  return {
    kind: 'cadence',
    value: 172,
    unit: 'steps/min',
    confidence: 0.95,
    reliable: true,
    ...overrides,
  };
}

export function fixtureInsightSet(
  sessionId: string,
  insights: InsightResult[],
  computedBy: InsightSet['computedBy'] = 'cloud-worker',
): InsightSet {
  return {
    sessionId,
    sportProfileId: 'running-v1',
    computedBy,
    engineVersion: 'fixture-1',
    computedAtMs: 1_000,
    insights,
  };
}

export function fixtureResult(
  sessionId: string,
  ownerAthleteId: string,
  insights: InsightResult[],
  overrides: Partial<SessionResult> = {},
): SessionResult {
  return {
    sessionId,
    ownerAthleteId,
    correlationId: sessionId,
    status: 'processed',
    insights: fixtureInsightSet(sessionId, insights),
    flaggedForReview: false,
    processedAtMs: 2_000,
    sessionStartedAtMs: 1_000,
    ...overrides,
  };
}

export function fixtureSummary(
  n: number,
  ownerAthleteId: string,
  overrides: Partial<DemoSessionSummary> = {},
): DemoSessionSummary {
  return {
    sessionId: fixtureUuid(n),
    slug: `fixture-session-${n}`,
    ownerAthleteId,
    sportProfileId: 'running-v1',
    startedAtMs: 10_000 - n * 100,
    durationMs: 30_000,
    status: 'synced',
    dataQualityWarning: false,
    flaggedForReview: false,
    failed: false,
    ...overrides,
  };
}

/**
 * Artifact layout:
 *   1 — Asha, clean synced session (cadence + balance insights)
 *   2 — Asha, processing (no detail)
 *   3 — Asha, on phone only (on-phone insight set)
 *   4 — Asha, failed-validation (error state)
 *   5 — Asha, unreliable insight + data-quality warning
 *   6 — Ben, synced (visible to nobody but Ben — no coach grant)
 * Coach roster: Asha only. Mira: zero sessions.
 */
export function buildFixtureArtifact(): DemoArtifact {
  const cleanInsights = [
    fixtureInsight(),
    fixtureInsight({ kind: 'pressure_balance', value: 54, unit: '%', confidence: 0.92 }),
    fixtureInsight({ kind: 'foot_strike', value: 'midfoot', confidence: 0.71 }),
    fixtureInsight({ kind: 'ground_contact_time', foot: 'left', value: 245, unit: 'ms', confidence: 0.88 }),
    fixtureInsight({ kind: 'ground_contact_time', foot: 'right', value: 262, unit: 'ms', confidence: 0.88 }),
  ];
  const noisyInsights = [
    fixtureInsight({ confidence: 0.67 }),
    fixtureInsight({
      kind: 'ground_contact_time',
      foot: 'left',
      value: 240,
      unit: 'ms',
      confidence: 0.57,
      reliable: false,
      note: 'derived from low-confidence segmentation — treat as indicative only',
    }),
  ];

  const summaries: DemoSessionSummary[] = [
    fixtureSummary(1, FIX_ASHA),
    fixtureSummary(2, FIX_ASHA, { status: 'processing' }),
    fixtureSummary(3, FIX_ASHA, { status: 'on-phone-only' }),
    fixtureSummary(4, FIX_ASHA, { failed: true, flaggedForReview: true }),
    fixtureSummary(5, FIX_ASHA, { dataQualityWarning: true }),
    fixtureSummary(6, FIX_BEN),
  ];

  const details: Record<string, DemoSessionDetail> = {
    [fixtureUuid(1)]: {
      sessionId: fixtureUuid(1),
      result: fixtureResult(fixtureUuid(1), FIX_ASHA, cleanInsights),
    },
    [fixtureUuid(3)]: {
      sessionId: fixtureUuid(3),
      onPhoneInsights: fixtureInsightSet(fixtureUuid(3), [fixtureInsight()], 'on-phone'),
    },
    [fixtureUuid(4)]: {
      sessionId: fixtureUuid(4),
      result: {
        sessionId: fixtureUuid(4),
        ownerAthleteId: FIX_ASHA,
        correlationId: fixtureUuid(4),
        status: 'failed-validation',
        failureReason: 'stored session blob is not valid JSON',
        flaggedForReview: true,
        processedAtMs: 2_000,
      },
    },
    [fixtureUuid(5)]: {
      sessionId: fixtureUuid(5),
      result: fixtureResult(fixtureUuid(5), FIX_ASHA, noisyInsights),
    },
    [fixtureUuid(6)]: {
      sessionId: fixtureUuid(6),
      result: fixtureResult(fixtureUuid(6), FIX_BEN, [fixtureInsight()]),
    },
  };

  return {
    schemaVersion: 1,
    personas: [
      { id: FIX_ASHA, displayName: 'Asha', role: 'athlete' },
      { id: FIX_MIRA, displayName: 'Mira', role: 'athlete' },
      { id: FIX_BEN, displayName: 'Ben', role: 'athlete' },
      { id: FIX_COACH, displayName: 'Coach Dana', role: 'coach' },
    ],
    sessions: summaries,
    details,
    trends: {
      [FIX_ASHA]: [
        {
          kind: 'cadence',
          unit: 'steps/min',
          points: [
            { sessionId: fixtureUuid(1), atMs: 1_000, value: 165, confidence: 0.9, reliable: true },
            { sessionId: fixtureUuid(5), atMs: 2_000, value: 172, confidence: 0.67, reliable: true },
          ],
        },
      ],
    },
    coachRosters: {
      [FIX_COACH]: [
        {
          athleteId: FIX_ASHA,
          displayName: 'Asha',
          sessionCount: 5,
          lastSession: summaries[0]!,
        },
      ],
    },
    capture: {
      sourceSlug: 'fixture-capture',
      durationMs: 45_000,
      strideIntervalMs: 700,
      contactMs: 250,
      sampleIntervalMs: 10,
      rightFootOffsetMs: 350,
      dropouts: [{ foot: 'right', startMs: 20_000, endMs: 22_000 }],
    },
    pipeline: {
      stages: [
        { id: 'capture', label: 'Capture', status: 'pass', detail: 'fixture' },
        { id: 'segmentation-insights', label: 'Segmentation & Insights', status: 'pass', detail: 'fixture' },
        { id: 'ingest', label: 'Ingest', status: 'pass', detail: 'fixture' },
        { id: 'worker', label: 'Worker', status: 'running', detail: 'fixture' },
        { id: 'results', label: 'Results', status: 'fail', detail: 'fixture failure' },
      ],
      scenarios: [
        { slug: 'fixture-pass', description: 'A passing scenario.', status: 'pass' },
        { slug: 'fixture-fail', description: 'A failing scenario.', status: 'fail', detail: 'boom' },
      ],
    },
  };
}
