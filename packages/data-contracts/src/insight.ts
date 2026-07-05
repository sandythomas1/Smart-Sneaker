import { z } from 'zod';
import { FootSchema } from './sample';

/**
 * Insight kinds for the running profile. `InsightResultSchema.kind` is a free
 * string, not this enum: which kinds exist for a sport is sport-profile
 * configuration (Req. 12), so a new sport adds kinds without a contract change.
 */
export const RUNNING_INSIGHT_KINDS = [
  'pressure_balance',
  'ground_contact_time',
  'cadence',
  'foot_strike',
] as const;

/**
 * One computed insight. Req. 10-11: every insight carries a value AND a
 * confidence/quality indicator; `reliable: false` is how the system says
 * "this metric could not be trusted for this session" instead of omitting it
 * or silently reporting a bad number.
 */
export const InsightResultSchema = z.object({
  kind: z.string().min(1).max(100),
  /** Set for per-foot insights (e.g. ground contact time per foot); absent for
   * whole-body insights (cadence, balance). (kind, foot) identifies an insight
   * within a set — the worker's consistency comparison keys on it (Req. 17). */
  foot: FootSchema.optional(),
  /** Numeric metrics (cadence, balance %) or categorical labels (foot-strike type). */
  value: z.union([z.number(), z.string().min(1).max(100)]),
  unit: z.string().min(1).max(30).optional(),
  /** 0 = no confidence, 1 = full confidence. */
  confidence: z.number().min(0).max(1),
  reliable: z.boolean(),
  /** Optional human-readable caveat, e.g. why an insight was marked unreliable. */
  note: z.string().max(500).optional(),
});
export type InsightResult = z.infer<typeof InsightResultSchema>;

/**
 * The full set of insights computed for one session by one engine run.
 * `computedBy` distinguishes the client's provisional on-phone result from the
 * cloud worker's authoritative one (Req. 17); `engineVersion` +
 * `sportProfileId` make results comparable and reproducible across the two.
 */
export const InsightSetSchema = z.object({
  sessionId: z.uuid(),
  sportProfileId: z.string().min(1).max(100),
  computedBy: z.enum(['on-phone', 'cloud-worker']),
  engineVersion: z.string().min(1).max(50),
  computedAtMs: z.number().int().nonnegative(),
  insights: z.array(InsightResultSchema).min(1).max(50),
});
export type InsightSet = z.infer<typeof InsightSetSchema>;
