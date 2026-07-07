import {
  Calibration,
  CALIBRATION_SCHEMA_VERSION,
  CalibrationSchema,
  Foot,
  SensorSample,
  validateContract,
} from '@smart-sneaker/data-contracts';

/**
 * The stand-still calibration routine (Req. 13, T12): the athlete stands
 * still with weight even for a few seconds; equal real load should read
 * equally on both feet, so any imbalance in the captured means is sensor
 * gain — corrected by scaling each foot toward the two-foot mean.
 */

export interface StandStillOptions {
  /** Capture must span at least this long (default 3s). */
  minDurationMs?: number;
  /** Per-foot sample floor (default 100 ≈ 1s at the proposed 100 Hz). */
  minSamplesPerFoot?: number;
  /** Max coefficient of variation of a foot's total pressure — beyond this the athlete was moving (default 0.25). */
  maxCoefficientOfVariation?: number;
  /** Correction bound: a needed scale outside [1/max, max] means broken hardware, not miscalibration (default 4). */
  maxScale?: number;
}

/** Message is athlete-facing: it says what to do differently, not what code path failed. */
export class CalibrationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalibrationFailedError';
  }
}

const DEFAULTS: Required<StandStillOptions> = {
  minDurationMs: 3_000,
  minSamplesPerFoot: 100,
  maxCoefficientOfVariation: 0.25,
  maxScale: 4,
};

export function computeCalibrationFromStandStill(
  samples: readonly SensorSample[],
  deviceId: string,
  calibratedAtMs: number,
  options: StandStillOptions = {},
): Calibration {
  const opts = { ...DEFAULTS, ...options };

  const totalsByFoot: Record<Foot, number[]> = { left: [], right: [] };
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    totalsByFoot[sample.foot].push(sample.pressure.reduce((sum, p) => sum + p, 0));
    minTs = Math.min(minTs, sample.timestampMs);
    maxTs = Math.max(maxTs, sample.timestampMs);
  }

  for (const foot of ['left', 'right'] as const) {
    if (totalsByFoot[foot].length < opts.minSamplesPerFoot) {
      throw new CalibrationFailedError(
        'Calibration needs a steady signal from both feet. Check that both shoes are on and connected, then try again.',
      );
    }
  }
  if (maxTs - minTs < opts.minDurationMs) {
    throw new CalibrationFailedError(
      'That was too short. Stand still for a few seconds while we calibrate.',
    );
  }

  const meansByFoot = {} as Record<Foot, number>;
  for (const foot of ['left', 'right'] as const) {
    const totals = totalsByFoot[foot];
    const footMean = mean(totals);
    if (footMean <= 0 || coefficientOfVariation(totals, footMean) > opts.maxCoefficientOfVariation) {
      throw new CalibrationFailedError(
        'Too much movement during calibration. Stand still with your weight even on both feet and try again.',
      );
    }
    meansByFoot[foot] = footMean;
  }

  const target = (meansByFoot.left + meansByFoot.right) / 2;
  const perFoot = {
    left: { pressureScale: round(target / meansByFoot.left) },
    right: { pressureScale: round(target / meansByFoot.right) },
  };
  for (const foot of ['left', 'right'] as const) {
    const scale = perFoot[foot].pressureScale;
    if (scale > opts.maxScale || scale < 1 / opts.maxScale) {
      throw new CalibrationFailedError(
        'The two feet read very differently — that usually means a sensor problem, not calibration. Check the shoe hardware.',
      );
    }
  }

  const calibration = {
    schemaVersion: CALIBRATION_SCHEMA_VERSION as 1,
    deviceId,
    calibratedAtMs,
    perFoot,
  };
  // Self-check against the shared contract: a routine bug fails loudly here,
  // never as a silently-wrong correction applied to future sessions.
  const validation = validateContract(CalibrationSchema, calibration);
  if (!validation.ok) {
    throw new CalibrationFailedError('Calibration produced an invalid result. Please try again.');
  }
  return validation.data;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function coefficientOfVariation(values: number[], meanValue: number): number {
  const variance = values.reduce((sum, v) => sum + (v - meanValue) ** 2, 0) / values.length;
  return Math.sqrt(variance) / meanValue;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
