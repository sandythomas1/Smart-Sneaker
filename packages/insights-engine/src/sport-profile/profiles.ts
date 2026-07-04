import { createSportProfileRegistry, SportProfileRegistry } from './loader';

/**
 * Sport profile configs shipped with the engine. Adding a sport = adding an
 * entry (plus its model + segmentation strategy registration); no loader or
 * pipeline code changes (Req. 12, constitution's sport-profile abstraction).
 */
export const RUNNING_PROFILE_ID = 'running-v1';

const RUNNING_PROFILE_CONFIG = {
  profileId: RUNNING_PROFILE_ID,
  sport: 'running',
  sensors: [
    // Proposed defaults from spec.md's Capture Fidelity NFR (≥100 Hz);
    // channel count is a placeholder until the firmware spec fixes it.
    { kind: 'fsr_array', minSampleRateHz: 100, channels: 4 },
    { kind: 'imu', minSampleRateHz: 100 },
  ],
  segmentationStrategyId: 'peak-detection-v1',
  featureSet: [
    'left_right_pressure_balance',
    'ground_contact_time',
    'cadence',
    'foot_strike_classification',
  ],
  model: { name: 'running-insights-baseline', version: '0.0.1' },
};

/** The registry the engine uses unless a caller injects its own (tests do). */
export const defaultSportProfileRegistry: SportProfileRegistry = createSportProfileRegistry([
  RUNNING_PROFILE_CONFIG,
]);
