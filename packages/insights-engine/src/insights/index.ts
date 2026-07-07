import type { InsightSet, Session, SportProfile } from '@smart-sneaker/data-contracts';
import { segmentSession } from '../segmentation';
import type { SegmentationResult } from '../segmentation/types';
import { applyUncalibratedPenalty } from '../calibration/apply';
import {
  computeCadence,
  computeFootStrike,
  computeGroundContactTime,
  computePressureBalance,
} from './running-features';
import type { FeatureComputer } from './types';

export * from './types';
export * from './running-features';

/**
 * Version stamped into every InsightSet. Bump on any change to segmentation or
 * feature computation — it's what makes the client's on-phone result and the
 * worker's authoritative result comparable (Req. 17, Consistency NFR).
 */
export const ENGINE_VERSION = '0.1.0';

/** A profile's featureSet references a feature id the engine doesn't provide — a config bug, not a data problem. */
export class FeatureComputerNotFoundError extends Error {
  constructor(featureId: string, knownIds: readonly string[]) {
    super(`unknown feature "${featureId}"; registered features: ${knownIds.join(', ')}`);
    this.name = 'FeatureComputerNotFoundError';
  }
}

/**
 * Registered feature computers, keyed by the ids sport profiles use in their
 * `featureSet`. A new sport's features are added here and referenced from its
 * profile config — callers only ever go through computeSessionInsights (Req. 12).
 */
const FEATURE_COMPUTERS: Readonly<Record<string, FeatureComputer>> = {
  left_right_pressure_balance: computePressureBalance,
  ground_contact_time: computeGroundContactTime,
  cadence: computeCadence,
  foot_strike_classification: computeFootStrike,
};

export interface ComputeInsightsOptions {
  /** Who ran the engine — the client's provisional pass or the worker's authoritative one. */
  computedBy: InsightSet['computedBy'];
  /** Injectable clock for deterministic tests. */
  nowMs?: number;
  /**
   * Whether the session's sensors were calibrated for this user/device
   * (Req. 13, T12). 'uncalibrated' still computes every insight but lowers
   * confidence and attaches a caveat. Omitted = no adjustment, for callers
   * with no calibration knowledge (the cloud worker, pre-T12 paths).
   */
  calibrationStatus?: 'calibrated' | 'uncalibrated';
}

/**
 * The single shared entry point: segment the session with the profile's
 * declared strategy, then compute every feature the profile lists. Client app
 * and cloud worker both call exactly this, which is what keeps their results
 * comparable (plan.md's consistency risk).
 */
export function computeSessionInsights(
  session: Session,
  profile: SportProfile,
  options: ComputeInsightsOptions,
): InsightSet {
  const segmentation = segmentSession(session, profile);
  return computeInsightsFromSegmentation(session, profile, segmentation, options);
}

/** Same as computeSessionInsights, for callers that already segmented (e.g. to inspect quality). */
export function computeInsightsFromSegmentation(
  session: Session,
  profile: SportProfile,
  segmentation: SegmentationResult,
  options: ComputeInsightsOptions,
): InsightSet {
  let insights = profile.featureSet.flatMap((featureId) => {
    const computer = FEATURE_COMPUTERS[featureId];
    if (!computer) {
      throw new FeatureComputerNotFoundError(featureId, Object.keys(FEATURE_COMPUTERS));
    }
    return computer(session, segmentation);
  });
  if (options.calibrationStatus === 'uncalibrated') {
    insights = insights.map(applyUncalibratedPenalty);
  }

  return {
    sessionId: session.sessionId,
    sportProfileId: profile.profileId,
    computedBy: options.computedBy,
    engineVersion: ENGINE_VERSION,
    computedAtMs: options.nowMs ?? Date.now(),
    insights,
  };
}
