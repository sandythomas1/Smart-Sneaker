import type { Foot, SessionResult } from '@smart-sneaker/data-contracts';

/**
 * Multi-session trends (Req. 19): one series per numeric (kind, foot) insight
 * across an athlete's processed sessions. Categorical insights (foot-strike
 * label) don't chart as a line and are omitted here — they stay visible in the
 * per-session view.
 */

export interface TrendPoint {
  sessionId: string;
  /** Session start (client clock) when known; processing time as fallback. */
  atMs: number;
  value: number;
  confidence: number;
  /** Unreliable points are kept but marked, so the UI can dim them instead of
   * silently hiding data (Req. 11). */
  reliable: boolean;
}

export interface TrendSeries {
  kind: string;
  foot?: Foot;
  unit?: string;
  points: TrendPoint[];
}

export function buildTrends(results: SessionResult[]): TrendSeries[] {
  const seriesByKey = new Map<string, TrendSeries>();

  for (const result of results) {
    if (result.status !== 'processed' || !result.insights) {
      continue;
    }
    const atMs = result.sessionStartedAtMs ?? result.processedAtMs;
    for (const insight of result.insights.insights) {
      if (typeof insight.value !== 'number') {
        continue;
      }
      const key = `${insight.kind}|${insight.foot ?? ''}`;
      let series = seriesByKey.get(key);
      if (!series) {
        series = { kind: insight.kind, points: [] };
        if (insight.foot) series.foot = insight.foot;
        seriesByKey.set(key, series);
      }
      if (insight.unit && !series.unit) {
        series.unit = insight.unit;
      }
      series.points.push({
        sessionId: result.sessionId,
        atMs,
        value: insight.value,
        confidence: insight.confidence,
        reliable: insight.reliable,
      });
    }
  }

  const trends = [...seriesByKey.values()];
  for (const series of trends) {
    series.points.sort((a, b) => a.atMs - b.atMs || a.sessionId.localeCompare(b.sessionId));
  }
  trends.sort(
    (a, b) => a.kind.localeCompare(b.kind) || (a.foot ?? '').localeCompare(b.foot ?? ''),
  );
  return trends;
}
