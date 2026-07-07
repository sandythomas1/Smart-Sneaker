import type { Calibration, InsightSet, Session } from '@smart-sneaker/data-contracts';
import {
  applyCalibration,
  computeSessionInsights,
  defaultSportProfileRegistry,
  loadSportProfile,
  SportProfileRegistry,
} from '@smart-sneaker/insights-engine';

/**
 * On-phone inference (Req. 4): run the SAME shared insights engine the cloud
 * worker runs, entirely locally — the engine is pure computation with no I/O,
 * so this path has no network dependency by construction. The result is
 * provisional (`computedBy: 'on-phone'`); the worker's later result is
 * authoritative (Req. 17).
 */

export type OnPhoneInsightsState =
  | { status: 'ready'; insights: InsightSet }
  | { status: 'unavailable'; reason: string };

export interface ComputeOnPhoneOptions {
  /** Overridable in tests; defaults to the engine's shipped profiles. */
  profileRegistry?: SportProfileRegistry;
  nowMs?: number;
  /**
   * The stored calibration for this device, when one exists (T12). Applied
   * only if it matches the session's capture device; otherwise the session is
   * processed as uncalibrated — flagged, never refused (Req. 13).
   */
  calibration?: Calibration | null;
}

export function computeOnPhoneInsights(
  session: Session,
  options: ComputeOnPhoneOptions = {},
): OnPhoneInsightsState {
  try {
    const profile = loadSportProfile(
      session.sportProfileId,
      options.profileRegistry ?? defaultSportProfileRegistry,
    );
    const calibration = options.calibration ?? null;
    const calibrationApplies =
      calibration !== null &&
      session.deviceId !== undefined &&
      calibration.deviceId === session.deviceId;
    const insights = computeSessionInsights(
      calibrationApplies ? applyCalibration(session, calibration) : session,
      profile,
      {
        computedBy: 'on-phone',
        calibrationStatus: calibrationApplies ? 'calibrated' : 'uncalibrated',
        ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
      },
    );
    return { status: 'ready', insights };
  } catch {
    // Unknown profile / config bug: the athlete gets a degraded state, not a
    // crash after their run (Resilience NFR). The session itself is safe in
    // local storage and will still be processed in the cloud.
    return {
      status: 'unavailable',
      reason:
        'Insights could not be computed on this phone. Your session was saved and will be processed in the cloud.',
    };
  }
}
