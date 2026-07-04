import { z } from 'zod';

/** Sensor classes the capture contract knows about (Req. 23). */
export const SensorKindSchema = z.enum(['fsr_array', 'imu']);
export type SensorKind = z.infer<typeof SensorKindSchema>;

/** What a sport profile requires from the capture hardware. */
export const SensorRequirementSchema = z.object({
  kind: SensorKindSchema,
  minSampleRateHz: z.number().positive().max(10_000),
  /** FSR channel count, when kind is fsr_array. */
  channels: z.number().int().positive().max(64).optional(),
});
export type SensorRequirement = z.infer<typeof SensorRequirementSchema>;

/** A versioned reference to a trained model artifact (Req. 21). */
export const ModelRefSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().min(1).max(50),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

/**
 * The sport-profile contract (Req. 12, constitution's sport-profile
 * abstraction): everything the pipeline needs to support a sport is declared
 * here — which sensors matter, how to segment the activity, which features to
 * compute, which model to load. Supporting a new sport means shipping a new
 * one of these plus a model; never a branch in shared code.
 */
export const SportProfileSchema = z.object({
  profileId: z.string().min(1).max(100),
  sport: z.string().min(1).max(50),
  sensors: z.array(SensorRequirementSchema).min(1).max(10),
  /** Resolved by the insights engine to a registered segmentation implementation. */
  segmentationStrategyId: z.string().min(1).max(100),
  /** Feature identifiers the engine computes from segmented cycles. */
  featureSet: z.array(z.string().min(1).max(100)).min(1).max(100),
  model: ModelRefSchema,
});
export type SportProfile = z.infer<typeof SportProfileSchema>;
