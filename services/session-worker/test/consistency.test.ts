import type { InsightResult, InsightSet } from '@smart-sneaker/data-contracts';
import { compareInsightSets, NUMERIC_RELATIVE_TOLERANCE } from '../src/consistency';

const SESSION_ID = '3d3adf13-5a52-4a1c-9e7d-6f7b1a2c4e90';

function insight(overrides: Partial<InsightResult> & { kind: string }): InsightResult {
  return { value: 100, confidence: 0.9, reliable: true, ...overrides };
}

function set(computedBy: InsightSet['computedBy'], insights: InsightResult[], engineVersion = '0.1.0'): InsightSet {
  return { sessionId: SESSION_ID, sportProfileId: 'running-v1', computedBy, engineVersion, computedAtMs: 1, insights };
}

function comparisonFor(report: ReturnType<typeof compareInsightSets>, kind: string, foot?: 'left' | 'right') {
  const match = report.comparisons.find((c) => c.kind === kind && c.foot === foot);
  if (!match) throw new Error(`no comparison for ${kind}${foot ? `/${foot}` : ''}`);
  return match;
}

describe('compareInsightSets (Consistency NFR: ±10% numeric, label agreement categorical)', () => {
  it('identical results are within tolerance across the board', () => {
    const insights = [insight({ kind: 'cadence' }), insight({ kind: 'foot_strike', value: 'midfoot' })];
    const report = compareInsightSets(set('cloud-worker', insights), set('on-phone', insights));
    expect(report.withinTolerance).toBe(true);
    expect(report.engineVersionMatch).toBe(true);
    expect(report.comparisons.every((c) => c.status === 'within-tolerance')).toBe(true);
  });

  it('a 9% numeric difference is within tolerance; 11% is out', () => {
    const worker = set('cloud-worker', [insight({ kind: 'cadence', value: 100 })]);
    const within = compareInsightSets(worker, set('on-phone', [insight({ kind: 'cadence', value: 109 })]));
    const outside = compareInsightSets(worker, set('on-phone', [insight({ kind: 'cadence', value: 111 })]));
    expect(comparisonFor(within, 'cadence').status).toBe('within-tolerance');
    expect(comparisonFor(within, 'cadence').relativeDifference).toBeCloseTo(0.09);
    expect(comparisonFor(outside, 'cadence').status).toBe('out-of-tolerance');
    expect(outside.withinTolerance).toBe(false);
  });

  it('the boundary value (exactly 10%) counts as within tolerance', () => {
    const report = compareInsightSets(
      set('cloud-worker', [insight({ kind: 'cadence', value: 100 })]),
      set('on-phone', [insight({ kind: 'cadence', value: 100 * (1 + NUMERIC_RELATIVE_TOLERANCE) })]),
    );
    expect(report.withinTolerance).toBe(true);
  });

  it('categorical insights compare by label: agreement passes, disagreement fails', () => {
    const worker = set('cloud-worker', [insight({ kind: 'foot_strike', value: 'heel' })]);
    const agree = compareInsightSets(worker, set('on-phone', [insight({ kind: 'foot_strike', value: 'heel' })]));
    const disagree = compareInsightSets(worker, set('on-phone', [insight({ kind: 'foot_strike', value: 'midfoot' })]));
    expect(agree.withinTolerance).toBe(true);
    expect(comparisonFor(disagree, 'foot_strike').status).toBe('out-of-tolerance');
  });

  it('per-foot insights pair by (kind, foot) — left is never compared to right', () => {
    const worker = set('cloud-worker', [
      insight({ kind: 'ground_contact_time', foot: 'left', value: 200 }),
      insight({ kind: 'ground_contact_time', foot: 'right', value: 210 }),
    ]);
    const onPhone = set('on-phone', [
      insight({ kind: 'ground_contact_time', foot: 'right', value: 400 }),
      insight({ kind: 'ground_contact_time', foot: 'left', value: 205 }),
    ]);
    const report = compareInsightSets(worker, onPhone);
    expect(comparisonFor(report, 'ground_contact_time', 'left').status).toBe('within-tolerance');
    expect(comparisonFor(report, 'ground_contact_time', 'right').status).toBe('out-of-tolerance');
  });

  it('an insight unreliable on either side is recorded as not-compared and does not fail the session', () => {
    const report = compareInsightSets(
      set('cloud-worker', [insight({ kind: 'cadence', value: 100 })]),
      set('on-phone', [insight({ kind: 'cadence', value: 500, reliable: false, confidence: 0.1 })]),
    );
    const comparison = comparisonFor(report, 'cadence');
    expect(comparison.status).toBe('not-compared');
    expect(comparison.reason).toMatch(/unreliable/);
    expect(report.withinTolerance).toBe(true);
  });

  it('a worker insight with no on-phone counterpart is recorded as not-compared', () => {
    const report = compareInsightSets(
      set('cloud-worker', [insight({ kind: 'cadence' }), insight({ kind: 'pressure_balance' })]),
      set('on-phone', [insight({ kind: 'cadence' })]),
    );
    expect(comparisonFor(report, 'pressure_balance').status).toBe('not-compared');
  });

  it('zero worker values compare exactly: zero/zero passes, zero/non-zero fails', () => {
    const worker = set('cloud-worker', [insight({ kind: 'cadence', value: 0 })]);
    expect(
      compareInsightSets(worker, set('on-phone', [insight({ kind: 'cadence', value: 0 })])).withinTolerance,
    ).toBe(true);
    expect(
      compareInsightSets(worker, set('on-phone', [insight({ kind: 'cadence', value: 5 })])).withinTolerance,
    ).toBe(false);
  });

  it('a numeric/categorical type mismatch is out of tolerance, not a crash', () => {
    const report = compareInsightSets(
      set('cloud-worker', [insight({ kind: 'foot_strike', value: 'heel' })]),
      set('on-phone', [insight({ kind: 'foot_strike', value: 2 })]),
    );
    const comparison = comparisonFor(report, 'foot_strike');
    expect(comparison.status).toBe('out-of-tolerance');
    expect(comparison.reason).toMatch(/types disagree/);
  });

  it('differing engine versions are recorded — drift between deployments is visible', () => {
    const report = compareInsightSets(
      set('cloud-worker', [insight({ kind: 'cadence' })], '0.2.0'),
      set('on-phone', [insight({ kind: 'cadence' })], '0.1.0'),
    );
    expect(report.engineVersionMatch).toBe(false);
    expect(report.workerEngineVersion).toBe('0.2.0');
    expect(report.onPhoneEngineVersion).toBe('0.1.0');
  });
});
