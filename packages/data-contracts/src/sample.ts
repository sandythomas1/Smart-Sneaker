import { z } from 'zod';

/** Which foot a sample came from. Single-vs-dual-shoe is an open spec question;
 * the contract supports both feet so a dual-shoe rig needs no schema change. */
export const FootSchema = z.enum(['left', 'right']);
export type Foot = z.infer<typeof FootSchema>;

/** One 3-axis reading. Units are firmware-contract-defined (Req. 23-24); the
 * software contract only requires finite numbers. */
export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});
export type Vector3 = z.infer<typeof Vector3Schema>;

export const ImuReadingSchema = z.object({
  accel: Vector3Schema,
  gyro: Vector3Schema,
});
export type ImuReading = z.infer<typeof ImuReadingSchema>;

/**
 * One timestamped sensor sample off the shoe: FSR pressure channels + IMU.
 * `timestampMs` is milliseconds since session start (not wall clock) so
 * left/right and pressure/motion streams align without clock-sync concerns (Req. 2, 23).
 */
export const SensorSampleSchema = z.object({
  timestampMs: z.number().int().nonnegative(),
  foot: FootSchema,
  /** Raw FSR channel readings, one per sensor. Non-negative; channel count is
   * fixed by the firmware contract and validated for consistency at session level. */
  pressure: z.array(z.number().nonnegative()).min(1).max(64),
  imu: ImuReadingSchema,
});
export type SensorSample = z.infer<typeof SensorSampleSchema>;
