import type { InsightResult, InsightSet } from '@smart-sneaker/data-contracts';
import { ConsistencyReport, InsightComparison } from './ports';

/**
 * Client/cloud consistency check (Req. 17, Consistency NFR): the worker's
 * result is authoritative, and the client's on-phone result must agree with
 * it within tolerance — numeric insights within ±10% relative difference,
 * categorical insights (foot-strike) on the same label. A session outside
 * tolerance is flagged for review, never silently accepted.
 *
 * The 10% default is the spec's proposed placeholder (Open Questions) —
 * revisit once ground-truth validation data exists.
 */
export const NUMERIC_RELATIVE_TOLERANCE = 0.1;

/** Below this magnitude a worker value is treated as zero for relative comparison. */
const ZERO_EPSILON = 1e-9;

/** Absorbs float rounding so a difference of exactly 10% counts as within tolerance (the bound is inclusive). */
const BOUNDARY_EPSILON = 1e-9;

export function compareInsightSets(worker: InsightSet, onPhone: InsightSet): ConsistencyReport {
  const comparisons = worker.insights.map((workerInsight) =>
    compareOne(workerInsight, findCounterpart(onPhone.insights, workerInsight)),
  );
  return {
    workerEngineVersion: worker.engineVersion,
    onPhoneEngineVersion: onPhone.engineVersion,
    engineVersionMatch: worker.engineVersion === onPhone.engineVersion,
    comparisons,
    withinTolerance: comparisons.every((c) => c.status !== 'out-of-tolerance'),
  };
}

/** Insights pair up by (kind, foot) — a left contact time is never compared to a right one. */
function findCounterpart(
  onPhoneInsights: InsightSet['insights'],
  workerInsight: InsightResult,
): InsightResult | undefined {
  return onPhoneInsights.find(
    (i) => i.kind === workerInsight.kind && i.foot === workerInsight.foot,
  );
}

function compareOne(
  workerInsight: InsightResult,
  onPhoneInsight: InsightResult | undefined,
): InsightComparison {
  const base: InsightComparison = {
    kind: workerInsight.kind,
    status: 'not-compared',
    workerValue: workerInsight.value,
  };
  if (workerInsight.foot) base.foot = workerInsight.foot;

  if (!onPhoneInsight) {
    return { ...base, reason: 'no on-phone counterpart for this (kind, foot)' };
  }
  base.onPhoneValue = onPhoneInsight.value;

  if (!workerInsight.reliable || !onPhoneInsight.reliable) {
    // An unreliable side already announces itself via its confidence flag;
    // comparing it would raise false alarms on data both sides distrust.
    return { ...base, reason: 'insight is unreliable on at least one side' };
  }

  if (typeof workerInsight.value === 'string' || typeof onPhoneInsight.value === 'string') {
    if (typeof workerInsight.value !== typeof onPhoneInsight.value) {
      return { ...base, status: 'out-of-tolerance', reason: 'value types disagree' };
    }
    // Categorical (foot-strike type): tolerance is label agreement.
    return {
      ...base,
      status: workerInsight.value === onPhoneInsight.value ? 'within-tolerance' : 'out-of-tolerance',
    };
  }

  if (Math.abs(workerInsight.value) < ZERO_EPSILON) {
    const phoneIsAlsoZero = Math.abs(onPhoneInsight.value) < ZERO_EPSILON;
    return {
      ...base,
      status: phoneIsAlsoZero ? 'within-tolerance' : 'out-of-tolerance',
      ...(phoneIsAlsoZero ? {} : { reason: 'worker value is zero but on-phone value is not' }),
    };
  }

  const relativeDifference =
    Math.abs(workerInsight.value - onPhoneInsight.value) / Math.abs(workerInsight.value);
  return {
    ...base,
    relativeDifference,
    status:
      relativeDifference <= NUMERIC_RELATIVE_TOLERANCE + BOUNDARY_EPSILON
        ? 'within-tolerance'
        : 'out-of-tolerance',
  };
}
