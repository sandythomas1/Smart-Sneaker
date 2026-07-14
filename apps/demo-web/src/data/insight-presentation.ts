import type { InsightResult, InsightSet } from '@smart-sneaker/data-contracts';

/**
 * Pure presentation models for insight rendering. All values arrive from the
 * pipeline-produced artifact (Req. 6); this module only formats and phrases —
 * it never invents numbers.
 */

export interface InsightCardModel {
  /** Stable key: kind plus foot when present. */
  key: string;
  title: string;
  valueText: string;
  unit?: string;
  confidence: number;
  reliable: boolean;
  note?: string;
  takeaway?: string;
  /** Left share 0–1 for the balance split bar. */
  leftShare?: number;
}

const KIND_TITLES: Record<string, string> = {
  pressure_balance: 'Pressure balance',
  ground_contact_time: 'Ground contact time',
  cadence: 'Cadence',
  foot_strike: 'Foot strike',
};

function titleFor(insight: InsightResult): string {
  const base = KIND_TITLES[insight.kind] ?? insight.kind.replaceAll('_', ' ');
  return insight.foot ? `${base} · ${insight.foot === 'left' ? 'Left' : 'Right'}` : base;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Plain-language one-liners, phrased from pipeline values (never the reverse). */
function takeawayFor(insight: InsightResult): string | undefined {
  if (!insight.reliable) return undefined;
  if (insight.kind === 'pressure_balance' && typeof insight.value === 'number') {
    const left = insight.value;
    if (left >= 53) return `You're loading your left side noticeably harder (${formatNumber(left)}% vs ${formatNumber(100 - left)}%).`;
    if (left <= 47) return `You're loading your right side noticeably harder (${formatNumber(100 - left)}% vs ${formatNumber(left)}%).`;
    return 'Your left/right loading is well balanced.';
  }
  if (insight.kind === 'cadence' && typeof insight.value === 'number') {
    return insight.value >= 170
      ? 'A quick, efficient turnover for a training run.'
      : 'A relaxed turnover — cadence tends to rise with faster efforts.';
  }
  if (insight.kind === 'foot_strike' && typeof insight.value === 'string') {
    return `You landed mostly ${insight.value} this session.`;
  }
  return undefined;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function toCardModel(insight: InsightResult): InsightCardModel {
  const model: InsightCardModel = {
    key: insight.foot ? `${insight.kind}:${insight.foot}` : insight.kind,
    title: titleFor(insight),
    valueText:
      typeof insight.value === 'number' ? formatNumber(insight.value) : capitalize(insight.value),
    confidence: insight.confidence,
    reliable: insight.reliable,
  };
  if (insight.unit !== undefined) model.unit = insight.unit;
  if (insight.note !== undefined) model.note = insight.note;
  const takeaway = takeawayFor(insight);
  if (takeaway !== undefined) model.takeaway = takeaway;
  if (insight.kind === 'pressure_balance' && typeof insight.value === 'number') {
    model.leftShare = insight.value / 100;
    model.valueText = `L ${formatNumber(insight.value)} / R ${formatNumber(100 - insight.value)}`;
    model.unit = '%';
  }
  return model;
}

/** Cards in a stable, design-led order: balance, contact (L, R), cadence, strike. */
const KIND_ORDER = ['pressure_balance', 'ground_contact_time', 'cadence', 'foot_strike'];

export function toCardModels(set: InsightSet): InsightCardModel[] {
  return [...set.insights]
    .sort((a, b) => {
      const kindDelta = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (kindDelta !== 0) return kindDelta;
      return (a.foot ?? '').localeCompare(b.foot ?? '');
    })
    .map(toCardModel);
}

/** Trend metric labels for the toggle (Req. 3). */
export const TREND_METRIC_LABELS: Record<string, string> = {
  cadence: 'Cadence',
  pressure_balance: 'Balance',
  ground_contact_time: 'Contact time',
};
