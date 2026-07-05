import type { Foot, SensorSample, Session } from '@smart-sneaker/data-contracts';

/**
 * Synthetic running-session generator with known ground truth. Pressure is a
 * trapezoid per stance: fast 20ms ramp up to peak, plateau, fast 20ms ramp
 * down — so detected strike/toe-off should land within ~1-2 samples of truth.
 */

export interface SyntheticRunOptions {
  /** Total capture duration, ms. */
  durationMs: number;
  /** Same-foot stride interval, ms (700 ≈ 171 total steps/min with two feet). */
  strideIntervalMs: number;
  /** Ground contact duration per stance, ms. */
  contactMs: number;
  /** Sampling interval, ms (10 = 100 Hz). */
  sampleIntervalMs: number;
  /** Right foot's phase offset from left, ms. */
  rightFootOffsetMs: number;
  /** Windows to delete samples from, simulating BLE dropouts. */
  dropouts?: Array<{ foot: Foot; startMs: number; endMs: number }>;
  /** Per-foot stance peak pressure override, for asymmetric-loading fixtures. Default: PEAK_PRESSURE both feet. */
  peakPressureByFoot?: Partial<Record<Foot, number>>;
  /** Per-foot relative channel weighting (heel→toe order), for strike-type
   * fixtures — e.g. [4, 2, 1, 1] is heel-biased. Default: uniform. */
  channelWeightsByFoot?: Partial<Record<Foot, number[]>>;
}

export interface SyntheticRun {
  session: Session;
  /** Ground-truth strike (contact-start) times per foot. */
  strikes: Array<{ foot: Foot; strikeMs: number }>;
}

const BASELINE_PRESSURE = 0.2;
const PEAK_PRESSURE = 10;
const RAMP_MS = 20;
const CHANNELS = 4;

export function generateSyntheticRun(options: SyntheticRunOptions): SyntheticRun {
  const strikes: Array<{ foot: Foot; strikeMs: number }> = [];
  const samples: SensorSample[] = [];

  for (const foot of ['left', 'right'] as const) {
    const offset = foot === 'left' ? 0 : options.rightFootOffsetMs;
    for (
      let strikeMs = offset;
      strikeMs + options.contactMs <= options.durationMs;
      strikeMs += options.strideIntervalMs
    ) {
      strikes.push({ foot, strikeMs });
    }
  }

  for (let t = 0; t <= options.durationMs; t += options.sampleIntervalMs) {
    for (const foot of ['left', 'right'] as const) {
      if (isDroppedOut(options.dropouts, foot, t)) continue;
      const peak = options.peakPressureByFoot?.[foot] ?? PEAK_PRESSURE;
      const total = pressureAt(strikes, foot, t, options.contactMs, peak);
      samples.push({
        timestampMs: t,
        foot,
        pressure: distributeAcrossChannels(total, options.channelWeightsByFoot?.[foot]),
        imu: {
          accel: { x: 0, y: 0, z: 9.81 },
          gyro: { x: 0, y: 0, z: 0 },
        },
      });
    }
  }

  const session: Session = {
    schemaVersion: 1,
    sessionId: '3d3adf13-5a52-4a1c-9e7d-6f7b1a2c4e90',
    sportProfileId: 'running-v1',
    startedAtMs: 1_750_000_000_000,
    samples,
  };

  strikes.sort((a, b) => a.strikeMs - b.strikeMs);
  return { session, strikes };
}

function isDroppedOut(
  dropouts: SyntheticRunOptions['dropouts'],
  foot: Foot,
  t: number,
): boolean {
  return (dropouts ?? []).some((d) => d.foot === foot && t >= d.startMs && t <= d.endMs);
}

/** Trapezoid stance pressure; baseline between stances. */
function pressureAt(
  strikes: Array<{ foot: Foot; strikeMs: number }>,
  foot: Foot,
  t: number,
  contactMs: number,
  peakPressure: number,
): number {
  for (const strike of strikes) {
    if (strike.foot !== foot) continue;
    const elapsed = t - strike.strikeMs;
    if (elapsed < 0 || elapsed > contactMs) continue;
    if (elapsed < RAMP_MS) {
      return BASELINE_PRESSURE + (peakPressure - BASELINE_PRESSURE) * (elapsed / RAMP_MS);
    }
    if (elapsed > contactMs - RAMP_MS) {
      return BASELINE_PRESSURE + (peakPressure - BASELINE_PRESSURE) * ((contactMs - elapsed) / RAMP_MS);
    }
    return peakPressure;
  }
  return BASELINE_PRESSURE;
}

/** Split a total across CHANNELS channels by relative weights (uniform when omitted). */
function distributeAcrossChannels(total: number, weights?: number[]): number[] {
  const w = weights && weights.length === CHANNELS ? weights : new Array<number>(CHANNELS).fill(1);
  const weightSum = w.reduce((sum, v) => sum + v, 0);
  return w.map((v) => (total * v) / weightSum);
}
