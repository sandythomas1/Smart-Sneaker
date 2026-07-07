import type { Calibration } from '@smart-sneaker/data-contracts';
import {
  applyCalibration,
  applyUncalibratedPenalty,
  computeSessionInsights,
  defaultSportProfileRegistry,
  loadSportProfile,
  RELIABILITY_THRESHOLD,
  RUNNING_PROFILE_ID,
  UNCALIBRATED_CONFIDENCE_FACTOR,
  UNCALIBRATED_NOTE,
} from '../src';
import { generateSyntheticRun } from '../src/testing/synthetic';

const runningProfile = loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry);

const CLEAN_RUN = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

function calibration(leftScale: number, rightScale: number): Calibration {
  return {
    schemaVersion: 1,
    deviceId: 'shoe-1',
    calibratedAtMs: 1,
    perFoot: { left: { pressureScale: leftScale }, right: { pressureScale: rightScale } },
  };
}

describe('applyCalibration (Req. 13)', () => {
  it('scales each foot’s pressure channels by its gain and leaves the original session untouched', () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const original = session.samples[0]!.pressure[0];

    const corrected = applyCalibration(session, calibration(2, 1));

    const left = corrected.samples.find((s) => s.foot === 'left')!;
    const right = corrected.samples.find((s) => s.foot === 'right')!;
    const originalLeft = session.samples.find((s) => s.foot === 'left')!;
    const originalRight = session.samples.find((s) => s.foot === 'right')!;
    expect(left.pressure).toEqual(originalLeft.pressure.map((p) => p * 2));
    expect(right.pressure).toEqual(originalRight.pressure); // scale 1 → untouched
    expect(session.samples[0]!.pressure[0]).toBe(original); // pure
  });

  it('corrects a sensor-gain imbalance so balance reads even again', () => {
    // Both feet loaded identically, but the right sensor reads 20% low.
    const { session } = generateSyntheticRun({ ...CLEAN_RUN, peakPressureByFoot: { right: 8 } });
    const uncorrected = computeSessionInsights(session, runningProfile, { computedBy: 'on-phone', nowMs: 1 });
    const corrected = computeSessionInsights(
      applyCalibration(session, calibration(0.9, 1.125)),
      runningProfile,
      { computedBy: 'on-phone', nowMs: 1 },
    );

    const balanceOf = (set: typeof corrected) =>
      set.insights.find((i) => i.kind === 'pressure_balance')!.value as number;
    expect(balanceOf(uncorrected)).toBeGreaterThan(54);
    expect(balanceOf(corrected)).toBeGreaterThan(48);
    expect(balanceOf(corrected)).toBeLessThan(52);
  });
});

describe('uncalibrated flagging (Req. 11, 13)', () => {
  it('lowers confidence and attaches the caveat when computing uncalibrated', () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const baseline = computeSessionInsights(session, runningProfile, { computedBy: 'on-phone', nowMs: 1 });
    const flagged = computeSessionInsights(session, runningProfile, {
      computedBy: 'on-phone',
      nowMs: 1,
      calibrationStatus: 'uncalibrated',
    });

    for (const [index, insight] of flagged.insights.entries()) {
      const unflagged = baseline.insights[index]!;
      expect(insight.confidence).toBeCloseTo(unflagged.confidence * UNCALIBRATED_CONFIDENCE_FACTOR, 3);
      expect(insight.note).toContain(UNCALIBRATED_NOTE);
    }
    // A clean session stays reliable — flagged, not discarded.
    expect(flagged.insights.some((i) => i.reliable)).toBe(true);
  });

  it("leaves 'calibrated' and legacy (no-status) calls unchanged", () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const baseline = computeSessionInsights(session, runningProfile, { computedBy: 'on-phone', nowMs: 1 });
    const calibrated = computeSessionInsights(session, runningProfile, {
      computedBy: 'on-phone',
      nowMs: 1,
      calibrationStatus: 'calibrated',
    });
    expect(calibrated.insights).toEqual(baseline.insights);
  });

  it('flips reliability when the penalty pushes a borderline insight under the threshold', () => {
    const borderline = applyUncalibratedPenalty({
      kind: 'cadence',
      value: 170,
      confidence: 0.7, // 0.7 * 0.8 = 0.56 < 0.6
      reliable: true,
    });
    expect(borderline.confidence).toBeLessThan(RELIABILITY_THRESHOLD);
    expect(borderline.reliable).toBe(false);
    expect(borderline.note).toBe(UNCALIBRATED_NOTE);
  });
});
