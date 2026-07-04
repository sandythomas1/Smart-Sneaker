import type { Session } from '@smart-sneaker/data-contracts';
import {
  defaultSportProfileRegistry,
  loadSportProfile,
  RUNNING_PROFILE_ID,
  SegmentationStrategyNotFoundError,
  segmentByPeakDetection,
  segmentSession,
} from '../src';
import { generateSyntheticRun } from './fixtures/synthetic';

/** Detected strike must land within 2.5 samples of ground truth at 100 Hz. */
const STRIKE_TOLERANCE_MS = 25;

const cleanRunOptions = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 250,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

describe('segmentByPeakDetection — clean signal', () => {
  const { session, strikes } = generateSyntheticRun(cleanRunOptions);
  const result = segmentByPeakDetection(session);

  it('detects every ground-truth strike within tolerance', () => {
    expect(result.cycles.length).toBe(strikes.length);
    for (const truth of strikes) {
      const match = result.cycles.find(
        (c) => c.foot === truth.foot && Math.abs(c.strikeMs - truth.strikeMs) <= STRIKE_TOLERANCE_MS,
      );
      expect(match).toBeDefined();
    }
  });

  it('reports plausible contact durations near the fixture contact time', () => {
    for (const cycle of result.cycles) {
      const contact = cycle.toeOffMs - cycle.strikeMs;
      expect(contact).toBeGreaterThan(cleanRunOptions.contactMs - 50);
      expect(contact).toBeLessThan(cleanRunOptions.contactMs + 50);
    }
  });

  it('assigns full baseline confidence and high aggregate quality to a clean session', () => {
    expect(result.cycles.every((c) => c.confidence === 0.9 && !c.qualityNotes)).toBe(true);
    expect(result.quality).toBeCloseTo(0.9);
  });
});

describe('segmentByPeakDetection — dropouts (Req. 9, 11)', () => {
  it('marks a cycle overlapping a mid-stance gap as low-confidence instead of trusting it', () => {
    // Left strike at 2800ms, stance 2800-3050; dropout removes its middle.
    const { session } = generateSyntheticRun({
      ...cleanRunOptions,
      dropouts: [{ foot: 'left', startMs: 2850, endMs: 3000 }],
    });
    const result = segmentByPeakDetection(session);

    const affected = result.cycles.filter(
      (c) => c.foot === 'left' && c.strikeMs > 2700 && c.strikeMs < 3100,
    );
    expect(affected.length).toBe(1);
    expect(affected[0]!.confidence).toBeLessThan(0.9);
    expect(affected[0]!.qualityNotes?.join(' ')).toMatch(/gap/);
    expect(result.warnings.join(' ')).toMatch(/capture gap/);

    // Right foot never dropped out — its cycles stay clean.
    expect(result.cycles.filter((c) => c.foot === 'right').every((c) => c.confidence === 0.9)).toBe(true);
  });

  it('does not fabricate a cycle inside a gap that swallowed an entire stance', () => {
    // Dropout covers the whole left stance at 2800-3050 (plus margins).
    const { session, strikes } = generateSyntheticRun({
      ...cleanRunOptions,
      dropouts: [{ foot: 'left', startMs: 2780, endMs: 3070 }],
    });
    const result = segmentByPeakDetection(session);

    const leftTruth = strikes.filter((s) => s.foot === 'left');
    const leftDetected = result.cycles.filter((c) => c.foot === 'left');
    expect(leftDetected.length).toBe(leftTruth.length - 1);
    expect(leftDetected.some((c) => c.strikeMs > 2700 && c.strikeMs < 3100)).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/capture gap/);
  });
});

describe('segmentByPeakDetection — degenerate inputs', () => {
  const minimalSession = (samples: Session['samples']): Session => ({
    schemaVersion: 1,
    sessionId: '3d3adf13-5a52-4a1c-9e7d-6f7b1a2c4e90',
    sportProfileId: 'running-v1',
    startedAtMs: 0,
    samples,
  });

  it('handles a too-short session with a warning, not an exception', () => {
    const { session } = generateSyntheticRun({ ...cleanRunOptions, durationMs: 100 });
    const result = segmentByPeakDetection(session);
    expect(result.cycles).toEqual([]);
    expect(result.quality).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/too few samples/);
  });

  it('handles a single-sample session without throwing', () => {
    const result = segmentByPeakDetection(
      minimalSession([
        {
          timestampMs: 0,
          foot: 'left',
          pressure: [1, 1, 1, 1],
          imu: { accel: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } },
        },
      ]),
    );
    expect(result.cycles).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('reports a flat signal (shoe on a table) as undetectable, not as cycles', () => {
    const samples: Session['samples'] = [];
    for (let t = 0; t <= 5000; t += 10) {
      samples.push({
        timestampMs: t,
        foot: 'left',
        pressure: [0.5, 0.5, 0.5, 0.5],
        imu: { accel: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } },
      });
    }
    const result = segmentByPeakDetection(minimalSession(samples));
    expect(result.cycles).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/flat/);
  });

  it('segments a single-foot session (single-shoe rig) without complaining about the absent foot', () => {
    const { session } = generateSyntheticRun(cleanRunOptions);
    const leftOnly = { ...session, samples: session.samples.filter((s) => s.foot === 'left') };
    const result = segmentByPeakDetection(leftOnly);
    expect(result.cycles.length).toBeGreaterThan(0);
    expect(result.cycles.every((c) => c.foot === 'left')).toBe(true);
    expect(result.warnings.join(' ')).not.toMatch(/right/);
  });
});

describe('segmentSession — sport-profile dispatch (Req. 12)', () => {
  it('routes through the strategy declared by the running profile', () => {
    const { session, strikes } = generateSyntheticRun(cleanRunOptions);
    const profile = loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry);
    const result = segmentSession(session, profile);
    expect(result.cycles.length).toBe(strikes.length);
  });

  it('fails loudly for a profile referencing an unregistered strategy', () => {
    const { session } = generateSyntheticRun(cleanRunOptions);
    const profile = {
      ...loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry),
      segmentationStrategyId: 'jump-and-land-v1',
    };
    expect(() => segmentSession(session, profile)).toThrow(SegmentationStrategyNotFoundError);
    expect(() => segmentSession(session, profile)).toThrow(/peak-detection-v1/);
  });
});
