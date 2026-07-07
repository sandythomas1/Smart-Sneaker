import type { Calibration, InsightResult, Session } from '@smart-sneaker/data-contracts';
import { RELIABILITY_THRESHOLD } from '../insights/types';

/**
 * Calibration hooks (Req. 13, T12). The correction itself is a pure sample
 * transform applied BEFORE segmentation, so every downstream insight sees
 * corrected pressures; the uncalibrated penalty is how the engine says
 * "processed, but not comparable across users/devices" without refusing to
 * process at all.
 */

/** Confidence multiplier for sessions computed without a calibration. */
export const UNCALIBRATED_CONFIDENCE_FACTOR = 0.8;

export const UNCALIBRATED_NOTE =
  'computed without sensor calibration — values may not be comparable across users or devices';

/**
 * Scale each sample's pressure channels by its foot's calibration gain.
 * Pure — returns a corrected copy. Callers are responsible for only passing a
 * calibration whose deviceId matches the session (the client checks this;
 * see apps/client compute-on-phone).
 */
export function applyCalibration(session: Session, calibration: Calibration): Session {
  return {
    ...session,
    samples: session.samples.map((sample) => {
      const scale = calibration.perFoot[sample.foot]?.pressureScale;
      if (scale === undefined || scale === 1) {
        return sample;
      }
      return { ...sample, pressure: sample.pressure.map((p) => p * scale) };
    }),
  };
}

/**
 * Mark one insight as coming from an uncalibrated capture: reduced
 * confidence, re-derived reliability, and an explicit caveat (Req. 11, 13).
 */
export function applyUncalibratedPenalty(insight: InsightResult): InsightResult {
  const confidence = Math.round(insight.confidence * UNCALIBRATED_CONFIDENCE_FACTOR * 1000) / 1000;
  const note = insight.note ? `${insight.note}; ${UNCALIBRATED_NOTE}`.slice(0, 500) : UNCALIBRATED_NOTE;
  return {
    ...insight,
    confidence,
    reliable: insight.reliable && confidence >= RELIABILITY_THRESHOLD,
    note,
  };
}
