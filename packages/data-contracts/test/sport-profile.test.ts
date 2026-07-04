import { SportProfileSchema, validateContract } from '../src';
import { validSportProfile } from './fixtures';

describe('SportProfileSchema', () => {
  it('accepts a valid running profile with sensors, segmentation, features, and model (Req. 12)', () => {
    expect(validateContract(SportProfileSchema, validSportProfile()).ok).toBe(true);
  });

  it.each([
    ['empty sensors list', validSportProfile({ sensors: [] })],
    ['unknown sensor kind', validSportProfile({ sensors: [{ kind: 'lidar', minSampleRateHz: 100 }] })],
    ['zero sample rate', validSportProfile({ sensors: [{ kind: 'imu', minSampleRateHz: 0 }] })],
    ['missing segmentation strategy', (() => { const p = validSportProfile(); delete (p as Record<string, unknown>).segmentationStrategyId; return p; })()],
    ['empty featureSet', validSportProfile({ featureSet: [] })],
    ['missing model ref', (() => { const p = validSportProfile(); delete (p as Record<string, unknown>).model; return p; })()],
    ['model ref without version', validSportProfile({ model: { name: 'running-insights' } })],
  ])('rejects %s', (_name, payload) => {
    const result = validateContract(SportProfileSchema, payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0]?.path).toBeTruthy();
    }
  });
});
