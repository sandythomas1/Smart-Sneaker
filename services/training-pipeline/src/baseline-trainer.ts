import type { Session, SessionLabels } from '@smart-sneaker/data-contracts';
import {
  computeSessionInsights,
  defaultSportProfileRegistry,
  loadSportProfile,
  SportProfileRegistry,
} from '@smart-sneaker/insights-engine';

/**
 * The baseline "training" step (T14): fits the asymmetry-alert threshold from
 * labeled sessions and evaluates how well measured balance agrees with the
 * session labels. Deliberately small — the point of this task is the
 * pipeline (immutable data in, versioned artifact + metrics out); a real
 * model swaps in behind the same shapes once real shoe data exists.
 *
 * Label conventions (from the T9 labeling protocol):
 *   'favor-left-leg' / 'favor-right-leg' — deliberately asymmetric sessions
 *   anything else — treated as normal/even loading
 */

export const FAVOR_LEFT_CONDITION = 'favor-left-leg';
export const FAVOR_RIGHT_CONDITION = 'favor-right-leg';

/** Used when the corpus can't separate normal from asymmetric loading. */
export const DEFAULT_ASYMMETRY_THRESHOLD_PERCENT = 5;
const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 20;

export interface LabeledSession {
  session: Session;
  labels: SessionLabels;
}

export interface BaselineTrainingResult {
  /** The learned model parameters — the artifact's payload. */
  parameters: {
    /** |left share − 50| beyond which a session is flagged asymmetric. */
    asymmetryThresholdPercent: number;
  };
  /** Evaluation metrics persisted with the model version (Req. 21). */
  metrics: Record<string, number>;
}

export function trainBaselineModel(
  labeledSessions: readonly LabeledSession[],
  profileRegistry: SportProfileRegistry = defaultSportProfileRegistry,
): BaselineTrainingResult {
  let skippedUnreliable = 0;
  let directionalCount = 0;
  let directionalAgreements = 0;
  const normalDeviations: number[] = [];
  const directionalDeviations: number[] = [];

  for (const { session, labels } of labeledSessions) {
    const profile = loadSportProfile(session.sportProfileId, profileRegistry);
    const insights = computeSessionInsights(session, profile, { computedBy: 'cloud-worker' });
    const balance = insights.insights.find((i) => i.kind === 'pressure_balance');
    if (!balance || !balance.reliable || typeof balance.value !== 'number') {
      skippedUnreliable += 1; // training only on data the engine itself trusts (Req. 11)
      continue;
    }

    const deviation = balance.value - 50; // + = left-heavy, − = right-heavy
    const favorsLeft = labels.conditions.includes(FAVOR_LEFT_CONDITION);
    const favorsRight = labels.conditions.includes(FAVOR_RIGHT_CONDITION);
    if (favorsLeft || favorsRight) {
      directionalCount += 1;
      directionalDeviations.push(Math.abs(deviation));
      if ((favorsLeft && deviation > 0) || (favorsRight && deviation < 0)) {
        directionalAgreements += 1;
      }
    } else {
      normalDeviations.push(Math.abs(deviation));
    }
  }

  const evaluatedCount = labeledSessions.length - skippedUnreliable;
  return {
    parameters: { asymmetryThresholdPercent: fitThreshold(normalDeviations, directionalDeviations) },
    metrics: {
      sessionCount: labeledSessions.length,
      evaluatedCount,
      skippedUnreliable,
      directionalCount,
      /** 1 when there was nothing directional to disagree with. */
      labelAgreementRate: directionalCount === 0 ? 1 : directionalAgreements / directionalCount,
    },
  };
}

/**
 * Midpoint between the worst normal session and the mildest deliberately
 * asymmetric one — the widest-margin separator this 1-D problem has. Falls
 * back to the default when the classes are missing or overlap.
 */
function fitThreshold(normalDeviations: number[], directionalDeviations: number[]): number {
  if (normalDeviations.length === 0 || directionalDeviations.length === 0) {
    return DEFAULT_ASYMMETRY_THRESHOLD_PERCENT;
  }
  const maxNormal = Math.max(...normalDeviations);
  const minDirectional = Math.min(...directionalDeviations);
  if (minDirectional <= maxNormal) {
    return DEFAULT_ASYMMETRY_THRESHOLD_PERCENT; // classes overlap — don't pretend to have learned a boundary
  }
  const midpoint = (maxNormal + minDirectional) / 2;
  return Math.round(Math.min(Math.max(midpoint, MIN_THRESHOLD), MAX_THRESHOLD) * 100) / 100;
}
