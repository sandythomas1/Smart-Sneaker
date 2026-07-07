import type { InsightResult, InsightSet } from '@smart-sneaker/data-contracts';

/**
 * Pure presentation mapping from the insight contract to what the screen
 * renders (Req. 4, 10-11). Kept framework-free so the formatting/reliability
 * rules are unit-testable without a renderer.
 */

export interface InsightCardViewModel {
  /** Stable per-insight key: kind plus foot when present. */
  key: string;
  title: string;
  valueText: string;
  /** 0-100, for a confidence bar/percentage label. */
  confidencePercent: number;
  reliable: boolean;
  /** Present when the insight is unreliable or carries a caveat — always shown, never hidden (Req. 11). */
  note?: string;
}

export interface InsightsViewModel {
  cards: InsightCardViewModel[];
}

/** Athlete-facing titles for the running profile's insight kinds; unknown kinds fall back to a humanized id. */
const TITLES: Readonly<Record<string, string>> = {
  pressure_balance: 'Pressure balance',
  ground_contact_time: 'Ground contact time',
  cadence: 'Cadence',
  foot_strike: 'Foot strike',
};

function titleFor(insight: InsightResult): string {
  const base = TITLES[insight.kind] ?? insight.kind.replace(/_/g, ' ');
  return insight.foot ? `${base} (${insight.foot})` : base;
}

function valueTextFor(insight: InsightResult): string {
  if (typeof insight.value === 'string') {
    return insight.value;
  }
  return insight.unit ? `${insight.value} ${insight.unit}` : String(insight.value);
}

export function buildInsightsViewModel(insightSet: InsightSet): InsightsViewModel {
  const cards = insightSet.insights.map((insight): InsightCardViewModel => {
    const card: InsightCardViewModel = {
      key: insight.foot ? `${insight.kind}:${insight.foot}` : insight.kind,
      title: titleFor(insight),
      valueText: valueTextFor(insight),
      confidencePercent: Math.round(insight.confidence * 100),
      reliable: insight.reliable,
    };
    const note = insight.note ?? (insight.reliable ? undefined : 'Low confidence — treat as indicative only.');
    if (note !== undefined) {
      card.note = note;
    }
    return card;
  });
  return { cards };
}
