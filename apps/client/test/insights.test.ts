import type { InsightSet } from '@smart-sneaker/data-contracts';
import { generateSyntheticRun } from '@smart-sneaker/insights-engine';
import { computeOnPhoneInsights } from '../src/insights/compute-on-phone';
import { buildInsightsViewModel } from '../src/insights/view-model';

const CLEAN_RUN = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

describe('computeOnPhoneInsights (Req. 4)', () => {
  it('produces all four running insights, marked as the provisional on-phone result', () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const state = computeOnPhoneInsights(session, { nowMs: 1 });

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(state.insights.computedBy).toBe('on-phone');
    const kinds = new Set(state.insights.insights.map((i) => i.kind));
    expect(kinds).toEqual(
      new Set(['pressure_balance', 'ground_contact_time', 'cadence', 'foot_strike']),
    );
    for (const insight of state.insights.insights) {
      expect(insight.confidence).toBeGreaterThanOrEqual(0);
      expect(insight.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('reflects a deliberately one-leg-favoring session as asymmetric balance', () => {
    const { session } = generateSyntheticRun({
      ...CLEAN_RUN,
      peakPressureByFoot: { right: 5 }, // left keeps the default 10 — heavy left favoring
    });
    const state = computeOnPhoneInsights(session, { nowMs: 1 });

    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    const balance = state.insights.insights.find((i) => i.kind === 'pressure_balance');
    expect(balance?.reliable).toBe(true);
    expect(balance?.value).toBeGreaterThan(60); // left share of pressure, %
  });

  it('degrades to an actionable "unavailable" state instead of crashing on an unknown profile', () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const state = computeOnPhoneInsights({ ...session, sportProfileId: 'curling-v1' });

    expect(state.status).toBe('unavailable');
    if (state.status !== 'unavailable') return;
    expect(state.reason).toContain('saved');
  });
});

describe('buildInsightsViewModel (Req. 10-11)', () => {
  const insightSet: InsightSet = {
    sessionId: '3d3adf13-5a52-4a1c-9e7d-6f7b1a2c4e90',
    sportProfileId: 'running-v1',
    computedBy: 'on-phone',
    engineVersion: '0.1.0',
    computedAtMs: 1,
    insights: [
      { kind: 'pressure_balance', value: 52.3, unit: '% left', confidence: 0.9, reliable: true },
      { kind: 'ground_contact_time', foot: 'left', value: 210, unit: 'ms', confidence: 0.9, reliable: true },
      { kind: 'foot_strike', value: 'heel', confidence: 0.85, reliable: true },
      { kind: 'cadence', value: 171.4, unit: 'steps/min', confidence: 0.3, reliable: false },
    ],
  };

  it('formats values with units, feet, and confidence percentages', () => {
    const { cards } = buildInsightsViewModel(insightSet);

    expect(cards.map((c) => c.key)).toEqual([
      'pressure_balance',
      'ground_contact_time:left',
      'foot_strike',
      'cadence',
    ]);
    expect(cards[0]).toMatchObject({ title: 'Pressure balance', valueText: '52.3 % left', confidencePercent: 90 });
    expect(cards[1]?.title).toBe('Ground contact time (left)');
    expect(cards[2]?.valueText).toBe('heel');
  });

  it('marks unreliable insights and always gives them a caveat to display', () => {
    const { cards } = buildInsightsViewModel(insightSet);
    const cadence = cards.find((c) => c.key === 'cadence');
    expect(cadence?.reliable).toBe(false);
    expect(cadence?.note).toBeTruthy();
  });
});
