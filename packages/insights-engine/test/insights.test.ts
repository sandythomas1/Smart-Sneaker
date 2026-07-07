import { InsightSetSchema, validateContract } from '@smart-sneaker/data-contracts';
import type { InsightResult, Session } from '@smart-sneaker/data-contracts';
import {
  computeInsightsFromSegmentation,
  computeSessionInsights,
  defaultSportProfileRegistry,
  FeatureComputerNotFoundError,
  loadSportProfile,
  RELIABILITY_THRESHOLD,
  RUNNING_PROFILE_ID,
} from '../src';
import type { SegmentationResult } from '../src';
import { generateSyntheticRun, SyntheticRunOptions } from '../src/testing/synthetic';

const runningProfile = loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry);

/** ~171 steps/min, 200ms contacts, 100 Hz, dual foot — same shape T3's tests use. */
const CLEAN_RUN: SyntheticRunOptions = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

function insightsFor(session: Session) {
  return computeSessionInsights(session, runningProfile, { computedBy: 'on-phone', nowMs: 1 });
}

function byKind(insights: InsightResult[], kind: string, foot?: 'left' | 'right') {
  const match = insights.find((i) => i.kind === kind && (foot === undefined || i.foot === foot));
  if (!match) throw new Error(`no ${kind}${foot ? ` (${foot})` : ''} insight in result`);
  return match;
}

describe('computeSessionInsights (running profile, clean fixture)', () => {
  const { session } = generateSyntheticRun(CLEAN_RUN);
  const set = insightsFor(session);

  it('produces a contract-valid InsightSet stamped with profile, engine version, and source', () => {
    expect(validateContract(InsightSetSchema, set).ok).toBe(true);
    expect(set.sportProfileId).toBe(RUNNING_PROFILE_ID);
    expect(set.sessionId).toBe(session.sessionId);
    expect(set.computedBy).toBe('on-phone');
    expect(set.engineVersion).toBeTruthy();
  });

  it('computes all four running insights, each with a confidence indicator (Req. 10-11)', () => {
    const kinds = set.insights.map((i) => i.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['pressure_balance', 'ground_contact_time', 'cadence', 'foot_strike']),
    );
    for (const insight of set.insights) {
      expect(insight.confidence).toBeGreaterThanOrEqual(0);
      expect(insight.confidence).toBeLessThanOrEqual(1);
      expect(typeof insight.reliable).toBe('boolean');
    }
  });

  it('computes cadence near the fixture ground truth (~171 steps/min)', () => {
    const cadence = byKind(set.insights, 'cadence');
    expect(cadence.reliable).toBe(true);
    expect(cadence.value as number).toBeGreaterThan(160);
    expect(cadence.value as number).toBeLessThan(185);
  });

  it('computes per-foot ground contact time near the fixture 200ms contacts', () => {
    for (const foot of ['left', 'right'] as const) {
      const gct = byKind(set.insights, 'ground_contact_time', foot);
      expect(gct.reliable).toBe(true);
      // Hysteresis thresholds trigger partway up/down the 20ms ramps, so the
      // measured contact is slightly shorter than the true 200ms.
      expect(gct.value as number).toBeGreaterThan(160);
      expect(gct.value as number).toBeLessThan(220);
    }
  });

  it('reports near-50% balance for a symmetric run', () => {
    const balance = byKind(set.insights, 'pressure_balance');
    expect(balance.reliable).toBe(true);
    expect(balance.value as number).toBeGreaterThan(47);
    expect(balance.value as number).toBeLessThan(53);
  });

  it('classifies a uniform pressure distribution as midfoot', () => {
    const strike = byKind(set.insights, 'foot_strike');
    expect(strike.reliable).toBe(true);
    expect(strike.value).toBe('midfoot');
  });
});

describe('asymmetry and strike-type sensitivity', () => {
  it('a left-favoring fixture produces a left-shifted balance (spec asymmetry criterion)', () => {
    const { session } = generateSyntheticRun({
      ...CLEAN_RUN,
      peakPressureByFoot: { left: 10, right: 6 },
    });
    const balance = byKind(insightsFor(session).insights, 'pressure_balance');
    expect(balance.reliable).toBe(true);
    expect(balance.value as number).toBeGreaterThan(55);
  });

  it('heel-weighted channels classify as heel strike', () => {
    const { session } = generateSyntheticRun({
      ...CLEAN_RUN,
      channelWeightsByFoot: { left: [6, 2, 1, 1], right: [6, 2, 1, 1] },
    });
    expect(byKind(insightsFor(session).insights, 'foot_strike').value).toBe('heel');
  });

  it('forefoot-weighted channels classify as forefoot strike', () => {
    const { session } = generateSyntheticRun({
      ...CLEAN_RUN,
      channelWeightsByFoot: { left: [1, 1, 2, 6], right: [1, 1, 2, 6] },
    });
    expect(byKind(insightsFor(session).insights, 'foot_strike').value).toBe('forefoot');
  });
});

describe('confidence propagation (Req. 11)', () => {
  const { session } = generateSyntheticRun(CLEAN_RUN);

  it('insights derived from low-confidence segmentation are marked unreliable, not silently reported', () => {
    const lowConfidence: SegmentationResult = {
      cycles: [
        { foot: 'left', strikeMs: 0, toeOffMs: 200, peakPressure: 10, confidence: 0.4 },
        { foot: 'left', strikeMs: 700, toeOffMs: 900, peakPressure: 10, confidence: 0.4 },
        { foot: 'right', strikeMs: 350, toeOffMs: 550, peakPressure: 10, confidence: 0.4 },
        { foot: 'right', strikeMs: 1050, toeOffMs: 1250, peakPressure: 10, confidence: 0.4 },
        { foot: 'left', strikeMs: 1400, toeOffMs: 1600, peakPressure: 10, confidence: 0.4 },
        { foot: 'right', strikeMs: 1750, toeOffMs: 1950, peakPressure: 10, confidence: 0.4 },
        { foot: 'left', strikeMs: 2100, toeOffMs: 2300, peakPressure: 10, confidence: 0.4 },
        { foot: 'right', strikeMs: 2450, toeOffMs: 2650, peakPressure: 10, confidence: 0.4 },
      ],
      quality: 0.4,
      warnings: ['synthetic low-confidence segmentation'],
    };
    const set = computeInsightsFromSegmentation(session, runningProfile, lowConfidence, {
      computedBy: 'on-phone',
      nowMs: 1,
    });
    for (const insight of set.insights) {
      expect(insight.confidence).toBeLessThan(RELIABILITY_THRESHOLD);
      expect(insight.reliable).toBe(false);
      expect(insight.note).toBeTruthy();
    }
  });

  it('too few cycles makes an insight unreliable even when each cycle is clean', () => {
    const twoCycles: SegmentationResult = {
      cycles: [
        { foot: 'left', strikeMs: 0, toeOffMs: 200, peakPressure: 10, confidence: 0.9 },
        { foot: 'right', strikeMs: 350, toeOffMs: 550, peakPressure: 10, confidence: 0.9 },
      ],
      quality: 0.9,
      warnings: [],
    };
    const set = computeInsightsFromSegmentation(session, runningProfile, twoCycles, {
      computedBy: 'on-phone',
      nowMs: 1,
    });
    for (const insight of set.insights) {
      expect(insight.reliable).toBe(false);
    }
  });

  it('an empty segmentation still reports all four insights as unreliable instead of throwing or omitting', () => {
    const empty: SegmentationResult = { cycles: [], quality: 0, warnings: ['unusable signal'] };
    const set = computeInsightsFromSegmentation(session, runningProfile, empty, {
      computedBy: 'cloud-worker',
      nowMs: 1,
    });
    const kinds = set.insights.map((i) => i.kind).sort();
    expect(kinds).toEqual(
      ['cadence', 'foot_strike', 'ground_contact_time', 'ground_contact_time', 'pressure_balance'].sort(),
    );
    for (const insight of set.insights) {
      expect(insight.reliable).toBe(false);
      expect(insight.confidence).toBe(0);
    }
  });
});

describe('failure modes', () => {
  it('a profile referencing an unregistered feature id fails loudly (config bug, not silent skip)', () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const brokenProfile = { ...runningProfile, featureSet: ['vertical_oscillation'] };
    expect(() =>
      computeSessionInsights(session, brokenProfile, { computedBy: 'on-phone' }),
    ).toThrow(FeatureComputerNotFoundError);
  });
});
