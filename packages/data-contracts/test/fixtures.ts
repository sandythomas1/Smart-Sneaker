/** Minimal valid payloads used across contract tests. Tests mutate copies. */

export const validSample = (overrides: Record<string, unknown> = {}) => ({
  timestampMs: 0,
  foot: 'left',
  pressure: [0.1, 0.4, 0.2],
  imu: {
    accel: { x: 0.01, y: -0.02, z: 9.81 },
    gyro: { x: 0.1, y: 0.2, z: -0.1 },
  },
  ...overrides,
});

export const validSession = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  sessionId: '7f6c1c1e-9a2b-4f6e-8d3a-2b1c9e8f7a65',
  sportProfileId: 'running-v1',
  startedAtMs: 1_750_000_000_000,
  samples: [
    validSample({ timestampMs: 0 }),
    validSample({ timestampMs: 10, foot: 'right' }),
    validSample({ timestampMs: 20 }),
  ],
  ...overrides,
});

export const validSportProfile = (overrides: Record<string, unknown> = {}) => ({
  profileId: 'running-v1',
  sport: 'running',
  sensors: [
    { kind: 'fsr_array', minSampleRateHz: 100, channels: 4 },
    { kind: 'imu', minSampleRateHz: 100 },
  ],
  segmentationStrategyId: 'peak-detection-v1',
  featureSet: ['stance_peak_pressure', 'stride_interval', 'strike_angle'],
  model: { name: 'running-insights', version: '0.1.0' },
  ...overrides,
});

export const validInsightResult = (overrides: Record<string, unknown> = {}) => ({
  kind: 'cadence',
  value: 172,
  unit: 'spm',
  confidence: 0.92,
  reliable: true,
  ...overrides,
});

export const validInsightSet = (overrides: Record<string, unknown> = {}) => ({
  sessionId: '7f6c1c1e-9a2b-4f6e-8d3a-2b1c9e8f7a65',
  sportProfileId: 'running-v1',
  computedBy: 'on-phone',
  engineVersion: '0.1.0',
  computedAtMs: 1_750_000_100_000,
  insights: [validInsightResult()],
  ...overrides,
});
