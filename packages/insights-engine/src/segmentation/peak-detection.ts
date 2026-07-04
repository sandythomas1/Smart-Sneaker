import type { Foot, Session } from '@smart-sneaker/data-contracts';
import type { GaitCycle, SegmentationResult } from './types';

/**
 * Baseline segmentation for running: hysteresis thresholding on total foot
 * pressure. Ground contact starts when total pressure rises above a high
 * threshold and ends when it falls below a low one; thresholds are derived
 * per-foot from the signal itself, so absolute calibration isn't required
 * (spec Non-Goal: no absolute newtons).
 *
 * Known-baseline algorithm, expected to be revisited once real shoe data and
 * a ground-truth method exist (plan.md Risks; tasks.md T3 description).
 */

/** Physiological plausibility bounds for running ground contact. */
const MIN_CONTACT_MS = 50;
const MAX_CONTACT_MS = 600;
/** A timestamp jump this many times the median interval is a capture gap. */
const GAP_FACTOR = 3;
/** Fewer samples than this per foot can't produce a trustworthy segmentation. */
const MIN_SAMPLES_PER_FOOT = 20;
/** Confidence assigned to a clean, plausible cycle. Not 1.0: a threshold
 * heuristic without ground-truth validation shouldn't claim certainty. */
const BASE_CONFIDENCE = 0.9;
const GAP_OVERLAP_CONFIDENCE = 0.4;
const LONG_CONTACT_CONFIDENCE = 0.5;

interface FootSample {
  timestampMs: number;
  totalPressure: number;
}

interface TimeRange {
  startMs: number;
  endMs: number;
}

export function segmentByPeakDetection(session: Session): SegmentationResult {
  const warnings: string[] = [];
  const cycles: GaitCycle[] = [];

  for (const foot of ['left', 'right'] as const) {
    const footSamples: FootSample[] = session.samples
      .filter((s) => s.foot === foot)
      .map((s) => ({
        timestampMs: s.timestampMs,
        totalPressure: s.pressure.reduce((sum, p) => sum + p, 0),
      }));

    if (footSamples.length === 0) {
      // Single-shoe rigs are a live spec question; an absent foot is expected, not an error.
      continue;
    }
    if (footSamples.length < MIN_SAMPLES_PER_FOOT) {
      warnings.push(`${foot} foot: too few samples (${footSamples.length}) to segment reliably`);
      continue;
    }

    const gaps = findCaptureGaps(footSamples);
    for (const gap of gaps) {
      warnings.push(
        `${foot} foot: capture gap from ${gap.startMs}ms to ${gap.endMs}ms — cycles overlapping it are low-confidence, cycles inside it are unrecoverable`,
      );
    }

    const thresholds = deriveThresholds(footSamples);
    if (!thresholds) {
      warnings.push(`${foot} foot: pressure signal is flat — no foot strikes detectable`);
      continue;
    }

    const footCycles = detectContacts(foot, footSamples, thresholds.high, thresholds.low, gaps, warnings);
    cycles.push(...footCycles);
  }

  cycles.sort((a, b) => a.strikeMs - b.strikeMs);

  if (cycles.length === 0 && warnings.length === 0) {
    warnings.push('no gait cycles detected in session');
  }

  const quality =
    cycles.length === 0
      ? 0
      : cycles.reduce((sum, c) => sum + c.confidence, 0) / cycles.length;

  return { cycles, quality, warnings };
}

/** High/low hysteresis thresholds from the signal's own dynamic range, or null for a flat signal. */
function deriveThresholds(samples: FootSample[]): { high: number; low: number } | null {
  const sorted = samples.map((s) => s.totalPressure).sort((a, b) => a - b);
  const baseline = percentile(sorted, 10);
  const peak = percentile(sorted, 95);
  const range = peak - baseline;
  if (range <= Math.max(1e-6, baseline * 0.1)) {
    return null;
  }
  return {
    high: baseline + 0.4 * range,
    low: baseline + 0.2 * range,
  };
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.round((p / 100) * (sortedAscending.length - 1));
  return sortedAscending[Math.min(sortedAscending.length - 1, Math.max(0, index))] ?? 0;
}

/** Timestamp jumps far beyond the foot's median sampling interval. */
function findCaptureGaps(samples: FootSample[]): TimeRange[] {
  const intervals: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (prev && curr) intervals.push(curr.timestampMs - prev.timestampMs);
  }
  const median = percentile([...intervals].sort((a, b) => a - b), 50);
  if (median <= 0) return [];

  const gaps: TimeRange[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (prev && curr && curr.timestampMs - prev.timestampMs > GAP_FACTOR * median) {
      gaps.push({ startMs: prev.timestampMs, endMs: curr.timestampMs });
    }
  }
  return gaps;
}

function detectContacts(
  foot: Foot,
  samples: FootSample[],
  highThreshold: number,
  lowThreshold: number,
  gaps: TimeRange[],
  warnings: string[],
): GaitCycle[] {
  const cycles: GaitCycle[] = [];
  let current: { strikeMs: number; peakPressure: number } | null = null;
  let discardedBlips = 0;

  for (const sample of samples) {
    if (current === null) {
      if (sample.totalPressure >= highThreshold) {
        current = { strikeMs: sample.timestampMs, peakPressure: sample.totalPressure };
      }
      continue;
    }

    current.peakPressure = Math.max(current.peakPressure, sample.totalPressure);
    if (sample.totalPressure <= lowThreshold) {
      const cycle = buildCycle(foot, current.strikeMs, sample.timestampMs, current.peakPressure, gaps);
      if (cycle) {
        cycles.push(cycle);
      } else {
        discardedBlips++;
      }
      current = null;
    }
  }

  if (current !== null) {
    warnings.push(
      `${foot} foot: session ended mid-contact (strike at ${current.strikeMs}ms has no toe-off) — dropped incomplete cycle`,
    );
  }
  if (discardedBlips > 0) {
    warnings.push(
      `${foot} foot: discarded ${discardedBlips} sub-${MIN_CONTACT_MS}ms pressure blip(s) as noise`,
    );
  }
  return cycles;
}

/** Apply plausibility + gap checks. Returns null for noise-blip contacts that should be discarded. */
function buildCycle(
  foot: Foot,
  strikeMs: number,
  toeOffMs: number,
  peakPressure: number,
  gaps: TimeRange[],
): GaitCycle | null {
  const contactMs = toeOffMs - strikeMs;
  if (contactMs < MIN_CONTACT_MS) {
    return null;
  }

  let confidence = BASE_CONFIDENCE;
  const qualityNotes: string[] = [];

  const overlappingGap = gaps.find((gap) => gap.startMs < toeOffMs && gap.endMs > strikeMs);
  if (overlappingGap) {
    confidence = Math.min(confidence, GAP_OVERLAP_CONFIDENCE);
    qualityNotes.push(
      `stance overlaps a capture gap (${overlappingGap.startMs}-${overlappingGap.endMs}ms); boundaries are uncertain`,
    );
  }
  if (contactMs > MAX_CONTACT_MS) {
    confidence = Math.min(confidence, LONG_CONTACT_CONFIDENCE);
    qualityNotes.push(`ground contact of ${contactMs}ms exceeds plausible running range (${MAX_CONTACT_MS}ms)`);
  }

  const cycle: GaitCycle = { foot, strikeMs, toeOffMs, peakPressure, confidence };
  if (qualityNotes.length > 0) {
    cycle.qualityNotes = qualityNotes;
  }
  return cycle;
}
