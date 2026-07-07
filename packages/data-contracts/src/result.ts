import { z } from 'zod';
import { UserIdSchema } from './event';
import { InsightSetSchema } from './insight';
import { FootSchema } from './sample';

/**
 * The authoritative processing outcome for one session (Req. 17). Written by
 * the session worker, read by the dashboard — it crosses a service boundary,
 * so the contract lives here and readers validate documents against it before
 * trusting them (constitution Security Bar).
 */

/** One per-insight client/cloud comparison, keyed by (kind, foot) (Consistency NFR). */
export const InsightComparisonSchema = z.object({
  kind: z.string().min(1).max(100),
  foot: FootSchema.optional(),
  status: z.enum(['within-tolerance', 'out-of-tolerance', 'not-compared']),
  workerValue: z.union([z.number(), z.string().min(1).max(100)]),
  onPhoneValue: z.union([z.number(), z.string().min(1).max(100)]).optional(),
  /** |worker − phone| / |worker|, for numeric insights that were compared. */
  relativeDifference: z.number().nonnegative().optional(),
  /** Why a pair was not compared (unreliable on either side, missing counterpart, type mismatch). */
  reason: z.string().max(500).optional(),
});
export type InsightComparison = z.infer<typeof InsightComparisonSchema>;

export const ConsistencyReportSchema = z.object({
  workerEngineVersion: z.string().min(1).max(50),
  onPhoneEngineVersion: z.string().min(1).max(50),
  engineVersionMatch: z.boolean(),
  comparisons: z.array(InsightComparisonSchema).max(100),
  /** False if any compared insight exceeded its tolerance. */
  withinTolerance: z.boolean(),
});
export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

/**
 * What the worker persists per processed session — the dashboard displays this
 * instead of the client's provisional result once available (Req. 17, 19). A
 * failed validation is persisted too, so redelivery stays idempotent and the
 * failure is visible rather than silently retried forever.
 */
export const SessionResultSchema = z.object({
  sessionId: z.uuid(),
  ownerAthleteId: UserIdSchema,
  /** Traces the session across upload → event → worker (Observability NFR). */
  correlationId: z.uuid(),
  status: z.enum(['processed', 'failed-validation']),
  /** Present when status is 'processed'. */
  insights: InsightSetSchema.optional(),
  /** Present when the upload carried an on-phone result to compare against. */
  consistency: ConsistencyReportSchema.optional(),
  /** Present when status is 'failed-validation'. */
  failureReason: z.string().max(1000).optional(),
  /** True when the session needs human review (consistency out of tolerance). */
  flaggedForReview: z.boolean(),
  processedAtMs: z.number().int().nonnegative(),
  /** The session's own start time (client wall clock) — what trend views order
   * by, so a backfilled upload doesn't appear as the newest data point.
   * Absent when the stored session never parsed (status 'failed-validation'). */
  sessionStartedAtMs: z.number().int().nonnegative().optional(),
});
export type SessionResult = z.infer<typeof SessionResultSchema>;
