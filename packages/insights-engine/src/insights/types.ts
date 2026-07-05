import type { InsightResult, Session } from '@smart-sneaker/data-contracts';
import type { SegmentationResult } from '../segmentation/types';

/**
 * Computes one feature (one or more InsightResults) from a segmented session.
 * Feature computers are registered under the feature ids that sport profiles
 * list in their `featureSet` (Req. 12) — the engine dispatches on those ids
 * and never branches on the sport itself.
 */
export type FeatureComputer = (
  session: Session,
  segmentation: SegmentationResult,
) => InsightResult[];

/** Below this confidence an insight is reported as unreliable (Req. 11). */
export const RELIABILITY_THRESHOLD = 0.6;

/** Fewer contributing cycles than this can't support a trustworthy metric. */
export const MIN_CYCLES_FOR_RELIABLE_INSIGHT = 4;
