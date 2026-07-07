import { randomUUID } from 'node:crypto';
import type { SessionResult } from '@smart-sneaker/data-contracts';
import { buildTrends } from '../src/trends';
import { processedResult, workerInsightSet } from './helpers';

describe('buildTrends', () => {
  it('splits numeric insights into per-(kind, foot) series and drops categorical ones', () => {
    const trends = buildTrends([
      processedResult({ ownerAthleteId: 'a', sessionStartedAtMs: 1_000 }),
    ]);

    const keys = trends.map((t) => `${t.kind}|${t.foot ?? ''}`);
    expect(keys).toEqual([
      'cadence|',
      'ground_contact_time|left',
      'ground_contact_time|right',
      'pressure_balance|',
    ]);
    // foot_strike is categorical — visible per-session, not charted as a line.
    expect(trends.some((t) => t.kind === 'foot_strike')).toBe(false);
    expect(trends.find((t) => t.kind === 'cadence')?.unit).toBe('steps/min');
  });

  it('orders points by session start time, so a backfilled upload lands where it happened', () => {
    const backfilled = processedResult({ ownerAthleteId: 'a', sessionStartedAtMs: 1_000 });
    const recent = processedResult({ ownerAthleteId: 'a', sessionStartedAtMs: 5_000 });
    // Listed with the backfilled session second, as a store might return it.
    const trends = buildTrends([recent, backfilled]);

    const cadence = trends.find((t) => t.kind === 'cadence');
    expect(cadence?.points.map((p) => p.sessionId)).toEqual([
      backfilled.sessionId,
      recent.sessionId,
    ]);
  });

  it('keeps unreliable points but marks them, instead of silently hiding data (Req. 11)', () => {
    const sessionId = randomUUID();
    const insights = workerInsightSet(sessionId);
    insights.insights = insights.insights.map((i) =>
      i.kind === 'cadence' ? { ...i, confidence: 0.2, reliable: false } : i,
    );
    const trends = buildTrends([processedResult({ ownerAthleteId: 'a', sessionId, insights })]);

    const cadence = trends.find((t) => t.kind === 'cadence');
    expect(cadence?.points).toEqual([expect.objectContaining({ reliable: false, confidence: 0.2 })]);
  });

  it('skips failed-validation results entirely', () => {
    const failed: SessionResult = {
      sessionId: randomUUID(),
      ownerAthleteId: 'a',
      correlationId: randomUUID(),
      status: 'failed-validation',
      failureReason: 'stored session blob is not valid JSON',
      flaggedForReview: true,
      processedAtMs: 1_750_000_200_000,
    };
    expect(buildTrends([failed])).toEqual([]);
  });

  it('falls back to processing time when the session start is unknown', () => {
    const result = processedResult({ ownerAthleteId: 'a' }); // no sessionStartedAtMs
    const trends = buildTrends([result]);
    expect(trends[0]?.points[0]?.atMs).toBe(result.processedAtMs);
  });
});
