import type { Foot, Session } from '@smart-sneaker/data-contracts';

/**
 * One detected ground-contact event (foot strike → toe-off). The unit every
 * running insight is computed from (Req. 9): contact time is toeOffMs −
 * strikeMs, cadence comes from strike density, balance from per-cycle
 * pressure, strike type from pressure distribution at strikeMs.
 */
export interface GaitCycle {
  foot: Foot;
  /** Initial contact (foot strike), ms since session start. */
  strikeMs: number;
  /** End of ground contact (toe-off), ms since session start. */
  toeOffMs: number;
  /** Peak total pressure observed during stance, raw sensor units. */
  peakPressure: number;
  /** 0-1. Reduced when the stance overlaps a data gap or looks physiologically implausible (Req. 11). */
  confidence: number;
  /** Why confidence was reduced, when it was. */
  qualityNotes?: string[];
}

export interface SegmentationResult {
  /** Detected cycles, ordered by strikeMs. Empty when the signal was unusable — never fabricated. */
  cycles: GaitCycle[];
  /** 0-1 aggregate segmentation quality for the session; 0 when no cycles were found. */
  quality: number;
  /** Human-readable data-quality problems (gaps, insufficient data, flat signal). */
  warnings: string[];
}

/** A segmentation implementation, registered under a strategy id that sport profiles reference. */
export type SegmentationStrategy = (session: Session) => SegmentationResult;
