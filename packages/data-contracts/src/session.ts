import { z } from 'zod';
import { SensorSampleSchema } from './sample';
import { InsightSetSchema } from './insight';

export const SESSION_SCHEMA_VERSION = 1;

/**
 * Sanity ceiling on samples per session: ~2.7 hours of dual-foot capture at
 * the proposed 100 Hz contract. Guards the processing pipeline against absurd
 * payloads at the contract level; the ingest API adds byte-level bounds on top (Req. 15).
 */
export const MAX_SESSION_SAMPLES = 2_000_000;

/** Known-condition metadata for labeled training/validation sessions (Req. 8). */
export const SessionLabelsSchema = z.object({
  /** e.g. "normal", "favor-left-leg", "pace-5min-km" — free-form protocol tags. */
  conditions: z.array(z.string().min(1).max(100)).min(1).max(20),
  notes: z.string().max(2000).optional(),
});
export type SessionLabels = z.infer<typeof SessionLabelsSchema>;

/**
 * A complete recorded session — the replayable unit of capture (Req. 4 of the
 * program draft; spec Req. 5, 22).
 *
 * Deliberately contains NO athlete identifier: ownership is derived
 * server-side from the authenticated caller (Req. 16). A client cannot
 * attribute a session to someone else because the contract has no field for it.
 *
 * `timestampMs` values are relative to `startedAtMs` (wall clock, set by the
 * recording client) and must be non-decreasing — "ordered, timestamped
 * samples" is enforced here, not assumed.
 */
export const SessionSchema = z
  .object({
    schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
    sessionId: z.uuid(),
    sportProfileId: z.string().min(1).max(100),
    startedAtMs: z.number().int().nonnegative(),
    /** Capture-device identifier (shoe module serial), not a user identity. */
    deviceId: z.string().min(1).max(100).optional(),
    samples: z.array(SensorSampleSchema).min(1).max(MAX_SESSION_SAMPLES),
    labels: SessionLabelsSchema.optional(),
    /** The client's provisional result, if computed before upload — the cloud
     * worker compares its authoritative result against this (Req. 17). */
    onPhoneInsights: InsightSetSchema.optional(),
  })
  .superRefine((session, ctx) => {
    for (let i = 1; i < session.samples.length; i++) {
      const prev = session.samples[i - 1];
      const curr = session.samples[i];
      if (prev && curr && curr.timestampMs < prev.timestampMs) {
        ctx.addIssue({
          code: 'custom',
          path: ['samples', i, 'timestampMs'],
          message: `samples must be ordered by timestampMs: sample ${i} (${curr.timestampMs}ms) precedes sample ${i - 1} (${prev.timestampMs}ms)`,
        });
        return; // one clear error beats thousands on a badly shuffled payload
      }
    }
    if (session.onPhoneInsights && session.onPhoneInsights.sessionId !== session.sessionId) {
      ctx.addIssue({
        code: 'custom',
        path: ['onPhoneInsights', 'sessionId'],
        message: 'onPhoneInsights.sessionId must match the session it is embedded in',
      });
    }
  });
export type Session = z.infer<typeof SessionSchema>;
