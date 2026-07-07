import { z } from 'zod';

export const CALIBRATION_SCHEMA_VERSION = 1;

/**
 * Per-foot multiplicative gain correction: raw pressure readings are
 * multiplied by `pressureScale` so equal real load reads equally across
 * sensors/feet/devices (Req. 13). Bounded — a scale this far out means the
 * hardware is broken, not miscalibrated.
 */
export const FootCalibrationSchema = z.object({
  pressureScale: z.number().positive().max(100),
});
export type FootCalibration = z.infer<typeof FootCalibrationSchema>;

/**
 * A per-user/per-device calibration produced by the client's stand-still
 * routine (T12) and applied by the shared insights engine before
 * segmentation. Keyed to the capture device: a calibration never silently
 * corrects a different shoe's sensors.
 */
export const CalibrationSchema = z
  .object({
    schemaVersion: z.literal(CALIBRATION_SCHEMA_VERSION),
    /** The shoe module this calibration was measured against (Session.deviceId). */
    deviceId: z.string().min(1).max(100),
    calibratedAtMs: z.number().int().nonnegative(),
    perFoot: z.object({
      left: FootCalibrationSchema.optional(),
      right: FootCalibrationSchema.optional(),
    }),
  })
  .refine((c) => c.perFoot.left !== undefined || c.perFoot.right !== undefined, {
    message: 'at least one foot must carry a correction',
    path: ['perFoot'],
  });
export type Calibration = z.infer<typeof CalibrationSchema>;
