import { z } from 'zod';
import { InsightSetSchema, SessionResultSchema } from '@smart-sneaker/data-contracts';

/**
 * Contract for the generated demo artifact (`public/demo-data.json`).
 *
 * The artifact is produced by `tools/e2e/src/write-demo-data.ts` running the
 * real in-memory pipeline over the seed corpus; this schema is the boundary
 * between that generator and the browser app. The app validates the file
 * before rendering anything — even our own artifact is treated as untrusted
 * input (constitution Security Bar) — and the generator validates before
 * writing, so a drifting shape fails at generation time, not in the UI.
 *
 * Deliberately absent: bearer tokens (stripped from the seed roster — nothing
 * credential-shaped ships to the browser) and raw sensor samples (the capture
 * view regenerates its replay from `capture` run options instead).
 */

export const DemoPersonaSchema = z.object({
  id: z.string().min(1).max(128),
  displayName: z.string().min(1).max(100),
  role: z.enum(['athlete', 'coach']),
});
export type DemoPersona = z.infer<typeof DemoPersonaSchema>;

/**
 * `synced`: the worker persisted an authoritative result (incl. failed
 * validation). `processing`: uploaded, no result yet. `on-phone-only`: never
 * uploaded — only the on-phone result exists.
 */
export const DemoSessionStatusSchema = z.enum(['synced', 'processing', 'on-phone-only']);
export type DemoSessionStatus = z.infer<typeof DemoSessionStatusSchema>;

export const DemoSessionSummarySchema = z.object({
  sessionId: z.uuid(),
  /** Stable seed-fixture name — ties every UI row back to its scenario. */
  slug: z.string().min(1).max(100),
  ownerAthleteId: z.string().min(1).max(128),
  sportProfileId: z.string().min(1).max(100),
  startedAtMs: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  status: DemoSessionStatusSchema,
  /** Any insight unreliable or carrying a caveat note (Req. 7c). */
  dataQualityWarning: z.boolean(),
  flaggedForReview: z.boolean(),
  /** Worker could not process the stored session (Req. 7d error state). */
  failed: z.boolean(),
});
export type DemoSessionSummary = z.infer<typeof DemoSessionSummarySchema>;

/**
 * Exactly one source is present: the worker's authoritative result for synced
 * sessions (status 'processed' or 'failed-validation'), or the on-phone
 * insight set for sessions that never uploaded. A 'processing' session has no
 * detail entry at all — that absence IS the state the UI renders.
 */
export const DemoSessionDetailSchema = z
  .object({
    sessionId: z.uuid(),
    result: SessionResultSchema.optional(),
    onPhoneInsights: InsightSetSchema.optional(),
  })
  .refine((detail) => (detail.result === undefined) !== (detail.onPhoneInsights === undefined), {
    message: 'exactly one of result / onPhoneInsights must be present',
  });
export type DemoSessionDetail = z.infer<typeof DemoSessionDetailSchema>;

/** Mirrors the dashboard's TrendSeries (apps/dashboard/src/trends.ts) — the
 * generator emits `buildTrends` output verbatim, points ordered by session
 * start time. */
export const DemoTrendPointSchema = z.object({
  sessionId: z.uuid(),
  atMs: z.number().int().nonnegative(),
  value: z.number(),
  confidence: z.number().min(0).max(1),
  reliable: z.boolean(),
});
export const DemoTrendSeriesSchema = z.object({
  kind: z.string().min(1).max(100),
  foot: z.enum(['left', 'right']).optional(),
  unit: z.string().min(1).max(30).optional(),
  points: z.array(DemoTrendPointSchema).max(500),
});
export type DemoTrendPoint = z.infer<typeof DemoTrendPointSchema>;
export type DemoTrendSeries = z.infer<typeof DemoTrendSeriesSchema>;

/** One roster row in a coach's view — derived at generation time from the
 * seed sharing grants, so a non-shared athlete never reaches the browser. */
export const DemoCoachAthleteSchema = z.object({
  athleteId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(100),
  sessionCount: z.number().int().nonnegative(),
  lastSession: DemoSessionSummarySchema.optional(),
});
export type DemoCoachAthlete = z.infer<typeof DemoCoachAthleteSchema>;

export const DEMO_PIPELINE_STAGE_IDS = [
  'capture',
  'segmentation-insights',
  'ingest',
  'worker',
  'results',
] as const;

export const DemoPipelineStageSchema = z.object({
  id: z.enum(DEMO_PIPELINE_STAGE_IDS),
  label: z.string().min(1).max(60),
  status: z.enum(['pass', 'fail', 'running']),
  detail: z.string().min(1).max(500),
});
export type DemoPipelineStage = z.infer<typeof DemoPipelineStageSchema>;

export const DemoPipelineScenarioSchema = z.object({
  slug: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  status: z.enum(['pass', 'fail']),
  detail: z.string().max(500).optional(),
});
export type DemoPipelineScenario = z.infer<typeof DemoPipelineScenarioSchema>;

/** The synthetic-run options of a named seed session — the capture view
 * replays exactly these, so the "live" recording is seeded data (Req. 4). */
export const DemoCaptureConfigSchema = z.object({
  sourceSlug: z.string().min(1).max(100),
  durationMs: z.number().int().positive(),
  strideIntervalMs: z.number().int().positive(),
  contactMs: z.number().int().positive(),
  sampleIntervalMs: z.number().int().positive(),
  rightFootOffsetMs: z.number().int().nonnegative(),
  dropouts: z.array(
    z.object({
      foot: z.enum(['left', 'right']),
      startMs: z.number().int().nonnegative(),
      endMs: z.number().int().nonnegative(),
    }),
  ),
});
export type DemoCaptureConfig = z.infer<typeof DemoCaptureConfigSchema>;

export const DemoArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  personas: z.array(DemoPersonaSchema).min(2),
  /** All sessions across athletes, newest first (by startedAtMs). */
  sessions: z.array(DemoSessionSummarySchema).max(200),
  /** Keyed by sessionId; 'processing' sessions intentionally have no entry. */
  details: z.record(z.string(), DemoSessionDetailSchema),
  /** Keyed by athleteId. */
  trends: z.record(z.string(), z.array(DemoTrendSeriesSchema)),
  /** Keyed by coachId. */
  coachRosters: z.record(z.string(), z.array(DemoCoachAthleteSchema)),
  capture: DemoCaptureConfigSchema,
  pipeline: z.object({
    stages: z.array(DemoPipelineStageSchema).length(DEMO_PIPELINE_STAGE_IDS.length),
    scenarios: z.array(DemoPipelineScenarioSchema).min(1).max(100),
  }),
});
export type DemoArtifact = z.infer<typeof DemoArtifactSchema>;
