import type { Foot, InsightResult, Session } from '@smart-sneaker/data-contracts';
import type { GaitCycle, SegmentationResult } from '../segmentation/types';
import { MIN_CYCLES_FOR_RELIABLE_INSIGHT, RELIABILITY_THRESHOLD } from './types';

/**
 * The four running feature computers (Req. 10). Each derives its value from
 * segmented gait cycles and propagates the segmentation's confidence into the
 * insight, so a shaky segmentation can never produce an insight that claims
 * to be reliable (Req. 11).
 */

/** Window after foot strike inspected for strike-type classification. */
const STRIKE_WINDOW_MS = 40;

/**
 * Center-of-pressure thresholds for strike classification, on a 0 (heel) to
 * 1 (toe) scale. ASSUMES FSR channels are ordered heel→toe — a placeholder
 * convention until the firmware spec fixes sensor placement (spec Open
 * Questions); revisit alongside the wire-format validation in T9.
 */
const HEEL_MAX_COP = 0.35;
const FOREFOOT_MIN_COP = 0.65;

export function computePressureBalance(
  _session: Session,
  segmentation: SegmentationResult,
): InsightResult[] {
  const left = cyclesFor(segmentation, 'left');
  const right = cyclesFor(segmentation, 'right');
  if (left.length === 0 || right.length === 0) {
    return [
      unreliable('pressure_balance', 'balance needs cycles from both feet; one foot has none'),
    ];
  }

  const leftMeanPeak = mean(left.map((c) => c.peakPressure));
  const rightMeanPeak = mean(right.map((c) => c.peakPressure));
  const total = leftMeanPeak + rightMeanPeak;
  if (total <= 0) {
    return [unreliable('pressure_balance', 'no measurable stance pressure on either foot')];
  }

  const leftSharePercent = (leftMeanPeak / total) * 100;
  return [
    withReliability({
      kind: 'pressure_balance',
      value: round(leftSharePercent, 1),
      unit: '% left',
      confidence: confidenceFrom([...left, ...right]),
      cycleCount: Math.min(left.length, right.length),
    }),
  ];
}

export function computeGroundContactTime(
  _session: Session,
  segmentation: SegmentationResult,
): InsightResult[] {
  return (['left', 'right'] as const).map((foot) => {
    const cycles = cyclesFor(segmentation, foot);
    if (cycles.length === 0) {
      return unreliable('ground_contact_time', `no ${foot}-foot cycles detected`, foot);
    }
    return withReliability({
      kind: 'ground_contact_time',
      foot,
      value: round(mean(cycles.map((c) => c.toeOffMs - c.strikeMs)), 0),
      unit: 'ms',
      confidence: confidenceFrom(cycles),
      cycleCount: cycles.length,
    });
  });
}

export function computeCadence(
  _session: Session,
  segmentation: SegmentationResult,
): InsightResult[] {
  const cycles = segmentation.cycles;
  if (cycles.length < 2) {
    return [unreliable('cadence', 'cadence needs at least two detected foot strikes')];
  }

  const first = cycles[0];
  const last = cycles[cycles.length - 1];
  if (!first || !last || last.strikeMs <= first.strikeMs) {
    return [unreliable('cadence', 'detected strikes span no measurable time')];
  }

  // n strikes span n-1 inter-strike intervals.
  const stepsPerMinute = ((cycles.length - 1) / (last.strikeMs - first.strikeMs)) * 60_000;
  return [
    withReliability({
      kind: 'cadence',
      value: round(stepsPerMinute, 1),
      unit: 'steps/min',
      confidence: confidenceFrom(cycles),
      cycleCount: cycles.length,
    }),
  ];
}

export function computeFootStrike(
  session: Session,
  segmentation: SegmentationResult,
): InsightResult[] {
  const classified: Array<{ label: string; confidence: number }> = [];
  for (const cycle of segmentation.cycles) {
    const cop = strikeCenterOfPressure(session, cycle);
    if (cop === null) continue;
    const label = cop <= HEEL_MAX_COP ? 'heel' : cop >= FOREFOOT_MIN_COP ? 'forefoot' : 'midfoot';
    classified.push({ label, confidence: cycle.confidence });
  }

  if (classified.length === 0) {
    return [unreliable('foot_strike', 'no cycles had usable pressure distribution at foot strike')];
  }

  const counts = new Map<string, number>();
  for (const c of classified) {
    counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  }
  const [majorityLabel, majorityCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;

  // Confidence blends segmentation quality with how unanimous the vote was:
  // a 50/50 heel-vs-midfoot split is genuinely ambiguous even on clean data.
  const agreement = majorityCount / classified.length;
  const confidence = mean(classified.map((c) => c.confidence)) * agreement;

  const result = withReliability({
    kind: 'foot_strike',
    value: majorityLabel,
    confidence: round(confidence, 3),
    cycleCount: classified.length,
  });
  if (agreement < 1 && result.reliable) {
    result.note = `majority label; ${Math.round(agreement * 100)}% of ${classified.length} classified strikes agree`;
  }
  return [result];
}

/**
 * Mean center of pressure (0 heel → 1 toe) over the strike window, or null if
 * no samples with pressure landed in the window (e.g. it fell inside a gap).
 */
function strikeCenterOfPressure(session: Session, cycle: GaitCycle): number | null {
  let weightedSum = 0;
  let pressureSum = 0;
  for (const sample of session.samples) {
    if (sample.foot !== cycle.foot) continue;
    if (sample.timestampMs < cycle.strikeMs) continue;
    if (sample.timestampMs > Math.min(cycle.strikeMs + STRIKE_WINDOW_MS, cycle.toeOffMs)) continue;
    const channels = sample.pressure.length;
    if (channels < 2) return null; // a single channel carries no spatial information
    for (let i = 0; i < channels; i++) {
      const p = sample.pressure[i] ?? 0;
      weightedSum += (i / (channels - 1)) * p;
      pressureSum += p;
    }
  }
  if (pressureSum <= 0) return null;
  return weightedSum / pressureSum;
}

function cyclesFor(segmentation: SegmentationResult, foot: Foot): GaitCycle[] {
  return segmentation.cycles.filter((c) => c.foot === foot);
}

/** Insight confidence = mean confidence of the cycles it was derived from (Req. 11). */
function confidenceFrom(cycles: GaitCycle[]): number {
  return round(mean(cycles.map((c) => c.confidence)), 3);
}

/** Applies the shared reliability rule: enough cycles AND enough confidence. */
function withReliability(input: {
  kind: string;
  value: number | string;
  confidence: number;
  foot?: Foot;
  unit?: string;
  /** How many gait cycles this value was derived from. */
  cycleCount: number;
}): InsightResult {
  const cycleCount = input.cycleCount;
  const reliable =
    input.confidence >= RELIABILITY_THRESHOLD && cycleCount >= MIN_CYCLES_FOR_RELIABLE_INSIGHT;
  const result: InsightResult = {
    kind: input.kind,
    value: input.value,
    confidence: input.confidence,
    reliable,
  };
  if (input.foot) result.foot = input.foot;
  if (input.unit) result.unit = input.unit;
  if (!reliable) {
    result.note =
      input.confidence < RELIABILITY_THRESHOLD
        ? 'derived from low-confidence segmentation — treat as indicative only'
        : `only ${cycleCount} usable cycle(s) — too few to trust`;
  }
  return result;
}

/** An insight that could not be computed at all — reported, never omitted (Req. 11). */
function unreliable(kind: string, reason: string, foot?: Foot): InsightResult {
  const result: InsightResult = {
    kind,
    value: 0,
    confidence: 0,
    reliable: false,
    note: reason,
  };
  if (foot) result.foot = foot;
  return result;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
