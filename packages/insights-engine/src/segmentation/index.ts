import type { Session, SportProfile } from '@smart-sneaker/data-contracts';
import { segmentByPeakDetection } from './peak-detection';
import type { SegmentationResult, SegmentationStrategy } from './types';

export * from './types';
export { segmentByPeakDetection } from './peak-detection';

/** Requested strategy id isn't registered — a profile-config/engine mismatch, not a data problem. */
export class SegmentationStrategyNotFoundError extends Error {
  constructor(strategyId: string, knownIds: readonly string[]) {
    super(
      `unknown segmentation strategy "${strategyId}"; registered strategies: ${knownIds.join(', ')}`,
    );
    this.name = 'SegmentationStrategyNotFoundError';
  }
}

/**
 * Registered strategies. A new sport that needs different segmentation
 * registers a new strategy here and references its id from the sport profile —
 * callers only ever go through segmentSession (Req. 12).
 */
const STRATEGIES: Readonly<Record<string, SegmentationStrategy>> = {
  'peak-detection-v1': segmentByPeakDetection,
};

/** Segment a session using the strategy its sport profile declares. */
export function segmentSession(session: Session, profile: SportProfile): SegmentationResult {
  const strategy = STRATEGIES[profile.segmentationStrategyId];
  if (!strategy) {
    throw new SegmentationStrategyNotFoundError(profile.segmentationStrategyId, Object.keys(STRATEGIES));
  }
  return strategy(session);
}
