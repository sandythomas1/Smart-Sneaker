import type { SensorSample } from '@smart-sneaker/data-contracts';
import { generateSyntheticRun, UNCALIBRATED_NOTE } from '@smart-sneaker/insights-engine';
import {
  CalibrationFailedError,
  computeCalibrationFromStandStill,
} from '../src/calibration/routine';
import { InMemoryCalibrationStore } from '../src/calibration/store';
import { computeOnPhoneInsights } from '../src/insights/compute-on-phone';

const DEVICE_ID = 'mock-shoe-1';

const CLEAN_RUN = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

/** A stand-still capture: constant per-foot totals across four channels. */
function standStillSamples(
  leftTotal: number,
  rightTotal: number,
  { durationMs = 4_000, intervalMs = 10 } = {},
): SensorSample[] {
  const samples: SensorSample[] = [];
  for (let t = 0; t <= durationMs; t += intervalMs) {
    for (const [foot, total] of [['left', leftTotal], ['right', rightTotal]] as const) {
      samples.push({
        timestampMs: t,
        foot,
        pressure: [total / 4, total / 4, total / 4, total / 4],
        imu: { accel: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } },
      });
    }
  }
  return samples;
}

describe('computeCalibrationFromStandStill (Req. 13)', () => {
  it('produces per-foot gains that even out a sensor imbalance', () => {
    // Equal real load; left sensor reads 10, right reads 8.
    const calibration = computeCalibrationFromStandStill(standStillSamples(10, 8), DEVICE_ID, 1);

    expect(calibration.deviceId).toBe(DEVICE_ID);
    expect(calibration.perFoot.left?.pressureScale).toBeCloseTo(0.9, 3);
    expect(calibration.perFoot.right?.pressureScale).toBeCloseTo(1.125, 3);
  });

  it.each([
    [
      'a foot is missing',
      standStillSamples(10, 8).filter((s) => s.foot === 'left'),
      /both feet/i,
    ],
    ['the capture is too short', standStillSamples(10, 8, { durationMs: 1_000 }), /too short/i],
    [
      'the athlete was moving',
      // Both feet swing heavy/light over time — shifting weight, not standing still.
      standStillSamples(10, 8).map((s) => ({
        ...s,
        pressure: s.pressure.map((p) => p * ((s.timestampMs / 10) % 2 === 0 ? 2 : 0.2)),
      })),
      /movement/i,
    ],
    ['the feet differ beyond a plausible gain', standStillSamples(100, 1), /sensor problem/i],
  ])('fails actionably when %s', (_case, samples, messagePattern) => {
    expect(() => computeCalibrationFromStandStill(samples, DEVICE_ID, 1)).toThrow(
      CalibrationFailedError,
    );
    expect(() => computeCalibrationFromStandStill(samples, DEVICE_ID, 1)).toThrow(messagePattern);
  });
});

describe('calibration applied to on-phone insights (T12 acceptance)', () => {
  /** A run with equal real loading but a right sensor reading 20% low. */
  function gainSkewedSession() {
    return {
      ...generateSyntheticRun({ ...CLEAN_RUN, peakPressureByFoot: { right: 8 } }).session,
      deviceId: DEVICE_ID,
    };
  }

  it('a session recorded after calibration has the correction applied in its insights', async () => {
    const store = new InMemoryCalibrationStore();
    await store.save(computeCalibrationFromStandStill(standStillSamples(10, 8), DEVICE_ID, 1));
    const session = gainSkewedSession();

    const calibration = await store.getForDevice(session.deviceId!);
    const state = computeOnPhoneInsights(session, { nowMs: 1, calibration });

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    const balance = state.insights.insights.find((i) => i.kind === 'pressure_balance')!;
    expect(balance.value as number).toBeGreaterThan(48);
    expect(balance.value as number).toBeLessThan(52);
    expect(balance.note ?? '').not.toContain(UNCALIBRATED_NOTE);
  });

  it('a session without calibration is still processed but flagged uncalibrated with lower confidence', () => {
    const session = gainSkewedSession();
    const uncalibrated = computeOnPhoneInsights(session, { nowMs: 1 });

    expect(uncalibrated.status).toBe('ready'); // processed, not refused
    if (uncalibrated.status !== 'ready') return;
    const balance = uncalibrated.insights.insights.find((i) => i.kind === 'pressure_balance')!;
    expect(balance.value as number).toBeGreaterThan(54); // skew uncorrected
    expect(balance.note).toContain(UNCALIBRATED_NOTE);

    // Lower confidence than the same session computed with calibration.
    const calibrated = computeOnPhoneInsights(session, {
      nowMs: 1,
      calibration: computeCalibrationFromStandStill(standStillSamples(10, 8), DEVICE_ID, 1),
    });
    if (calibrated.status !== 'ready') return;
    expect(balance.confidence).toBeLessThan(
      calibrated.insights.insights.find((i) => i.kind === 'pressure_balance')!.confidence,
    );
  });

  it('never applies a different device’s calibration', () => {
    const session = gainSkewedSession();
    const otherShoe = computeCalibrationFromStandStill(standStillSamples(10, 8), 'other-shoe', 1);

    const state = computeOnPhoneInsights(session, { nowMs: 1, calibration: otherShoe });

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    const balance = state.insights.insights.find((i) => i.kind === 'pressure_balance')!;
    expect(balance.value as number).toBeGreaterThan(54); // untouched by the mismatched calibration
    expect(balance.note).toContain(UNCALIBRATED_NOTE);
  });
});
