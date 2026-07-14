import type { DemoTrendSeries } from './demo-artifact';
import { TREND_METRIC_LABELS } from './insight-presentation';

/** Pure helpers behind the trends view: metric toggle options and the
 * plain-language drift callout. */

export interface MetricOption {
  key: string;
  label: string;
  series: DemoTrendSeries;
}

const KIND_ORDER = ['cadence', 'pressure_balance', 'ground_contact_time'];

export function metricOptions(series: DemoTrendSeries[]): MetricOption[] {
  return [...series]
    .filter((s) => s.points.length > 0)
    .sort((a, b) => {
      const kindDelta = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (kindDelta !== 0) return kindDelta;
      return (a.foot ?? '').localeCompare(b.foot ?? '');
    })
    .map((s) => ({
      key: s.foot ? `${s.kind}|${s.foot}` : s.kind,
      label: `${TREND_METRIC_LABELS[s.kind] ?? s.kind}${s.foot ? ` (${s.foot === 'left' ? 'L' : 'R'})` : ''}`,
      series: s,
    }));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compare the mean of the first three points with the mean of the last three
 * and phrase the drift. Needs ≥ 6 points to say anything worth reading.
 */
export function driftSummary(series: DemoTrendSeries): string | undefined {
  const points = series.points;
  if (points.length < 6) return undefined;
  const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;
  const early = mean(points.slice(0, 3).map((p) => p.value));
  const late = mean(points.slice(-3).map((p) => p.value));
  const delta = late - early;
  const weeks = Math.max(1, Math.round((points[points.length - 1]!.atMs - points[0]!.atMs) / WEEK_MS));
  const magnitude = Math.abs(delta) >= 10 ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(1);
  if (Math.abs(delta) < 0.5) return undefined;

  if (series.kind === 'pressure_balance') {
    const direction = delta > 0 ? 'left' : 'right';
    return `Your left/right balance has drifted ${magnitude}% toward your ${direction} side over ${weeks} weeks.`;
  }
  const label = (TREND_METRIC_LABELS[series.kind] ?? series.kind).toLowerCase();
  const direction = delta > 0 ? 'up' : 'down';
  const unit = series.unit ? ` ${series.unit}` : '';
  return `Your ${label} is ${direction} ${magnitude}${unit} over ${weeks} weeks.`;
}
