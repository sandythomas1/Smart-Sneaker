import {
  createSportProfileRegistry,
  defaultSportProfileRegistry,
  loadSportProfile,
  RUNNING_PROFILE_ID,
  SportProfileConfigError,
  SportProfileNotFoundError,
} from '../src';
import { SportProfileSchema, validateContract } from '@smart-sneaker/data-contracts';

const basketballStubConfig = {
  profileId: 'basketball-stub',
  sport: 'basketball',
  sensors: [
    { kind: 'fsr_array', minSampleRateHz: 200, channels: 4 },
    { kind: 'imu', minSampleRateHz: 200 },
  ],
  segmentationStrategyId: 'jump-and-land-v1',
  featureSet: ['jump_count', 'landing_load', 'lateral_load'],
  model: { name: 'basketball-stub', version: '0.0.1' },
};

describe('loadSportProfile', () => {
  it('resolves "running-v1" to a fully-valid SportProfile', () => {
    const profile = loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry);
    expect(validateContract(SportProfileSchema, profile).ok).toBe(true);
    expect(profile.sport).toBe('running');
    expect(profile.segmentationStrategyId).toBe('peak-detection-v1');
    expect(profile.featureSet.length).toBeGreaterThan(0);
    expect(profile.model.version).toBeTruthy();
  });

  it('supports a second sport via config only — same loader code (Req. 12)', () => {
    const registry = createSportProfileRegistry([
      loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry),
      basketballStubConfig,
    ]);
    const basketball = loadSportProfile('basketball-stub', registry);
    expect(basketball.sport).toBe('basketball');
    expect(basketball.segmentationStrategyId).toBe('jump-and-land-v1');
    // running still resolves through the same registry
    expect(loadSportProfile(RUNNING_PROFILE_ID, registry).sport).toBe('running');
  });

  it('throws a clear error for an unknown profile — never a silent default', () => {
    expect(() => loadSportProfile('cycling-v1', defaultSportProfileRegistry)).toThrow(
      SportProfileNotFoundError,
    );
    expect(() => loadSportProfile('cycling-v1', defaultSportProfileRegistry)).toThrow(
      /unknown sport profile "cycling-v1".*running-v1/,
    );
  });
});

describe('createSportProfileRegistry', () => {
  it('rejects an invalid config entry with field-level detail', () => {
    const invalid = { ...basketballStubConfig, sensors: [] };
    expect(() => createSportProfileRegistry([invalid])).toThrow(SportProfileConfigError);
    expect(() => createSportProfileRegistry([invalid])).toThrow(/sensors/);
  });

  it('rejects duplicate profile ids', () => {
    expect(() => createSportProfileRegistry([basketballStubConfig, basketballStubConfig])).toThrow(
      /duplicate sport profile id "basketball-stub"/,
    );
  });

  it('rejects a config that is not an object at all', () => {
    expect(() => createSportProfileRegistry(['not-a-profile'])).toThrow(SportProfileConfigError);
  });

  it('produces an empty registry from no configs, and lookups against it fail clearly', () => {
    const registry = createSportProfileRegistry([]);
    expect(() => loadSportProfile('anything', registry)).toThrow(/known profiles: \(none\)/);
  });
});
