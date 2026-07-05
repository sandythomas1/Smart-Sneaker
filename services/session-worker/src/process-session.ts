import {
  SessionReceivedEvent,
  SessionReceivedEventSchema,
  SessionSchema,
  validateContract,
  ValidationIssue,
} from '@smart-sneaker/data-contracts';
import {
  computeSessionInsights,
  defaultSportProfileRegistry,
  loadSportProfile,
  SportProfileNotFoundError,
  SportProfileRegistry,
} from '@smart-sneaker/insights-engine';
import { compareInsightSets } from './consistency';
import { AuthoritativeResultStore, SessionBlobReader, StoredAuthoritativeResult } from './ports';

export interface ProcessSessionDeps {
  blobReader: SessionBlobReader;
  resultStore: AuthoritativeResultStore;
  /** Overridable in tests; defaults to the engine's shipped profiles. */
  profileRegistry?: SportProfileRegistry;
  nowMs?: () => number;
}

/**
 * How one delivery ended. `rejected-event` and `failed-validation` are
 * permanent (acknowledge, don't redeliver — the input won't get better);
 * transient problems (missing blob, store outages) throw instead, so the
 * caller can signal Pub/Sub to retry.
 */
export type ProcessSessionOutcome =
  | { outcome: 'processed'; flaggedForReview: boolean }
  | { outcome: 'duplicate' }
  | { outcome: 'rejected-event'; issues: ValidationIssue[] }
  | { outcome: 'failed-validation'; reason: string };

/** The blob the event points at is missing — transient by construction (ingest writes the blob before publishing). */
export class SessionBlobMissingError extends Error {
  constructor(blobPath: string) {
    super(`session blob not found at ${blobPath}`);
    this.name = 'SessionBlobMissingError';
  }
}

/**
 * Consume one session-processing event (Req. 17): load the raw session, run
 * the SAME insights engine the client runs, persist the authoritative result,
 * and — when the upload carried an on-phone result — record the per-insight
 * consistency comparison, flagging out-of-tolerance sessions for review.
 *
 * Idempotency (Req. 18, worker half): the result store's atomic
 * createIfAbsent is the only write; a redelivered event finds the existing
 * result and becomes a no-op.
 */
export async function processSessionEvent(
  rawEvent: unknown,
  deps: ProcessSessionDeps,
): Promise<ProcessSessionOutcome> {
  const nowMs = deps.nowMs ?? Date.now;

  // The event arrives off a queue — untrusted input, validated like any other (constitution Security Bar).
  const eventValidation = validateContract(SessionReceivedEventSchema, rawEvent);
  if (!eventValidation.ok) {
    return { outcome: 'rejected-event', issues: eventValidation.issues };
  }
  const event = eventValidation.data;

  const blobJson = await deps.blobReader.get(event.blobPath);
  if (blobJson === null) {
    throw new SessionBlobMissingError(event.blobPath);
  }

  let parsedBlob: unknown;
  try {
    parsedBlob = JSON.parse(blobJson);
  } catch {
    return persistFailure(event, 'stored session blob is not valid JSON', deps, nowMs());
  }

  const sessionValidation = validateContract(SessionSchema, parsedBlob);
  if (!sessionValidation.ok) {
    const detail = sessionValidation.issues
      .slice(0, 3)
      .map((i) => `${i.path}: ${i.message}`)
      .join('; ');
    return persistFailure(event, `stored session failed contract validation — ${detail}`, deps, nowMs());
  }
  const session = sessionValidation.data;

  let insights;
  try {
    const profile = loadSportProfile(
      session.sportProfileId,
      deps.profileRegistry ?? defaultSportProfileRegistry,
    );
    insights = computeSessionInsights(session, profile, {
      computedBy: 'cloud-worker',
      nowMs: nowMs(),
    });
  } catch (error) {
    if (error instanceof SportProfileNotFoundError) {
      // Client-supplied profile id we don't ship — permanent for this payload.
      return persistFailure(event, `unknown sport profile "${session.sportProfileId}"`, deps, nowMs());
    }
    // Anything else (e.g. a registered profile referencing a missing feature)
    // is a deploy/config bug: throw so delivery retries and ops sees it,
    // instead of permanently mislabeling the session as bad data.
    throw error;
  }

  const result: StoredAuthoritativeResult = {
    sessionId: event.sessionId,
    ownerAthleteId: event.ownerAthleteId,
    correlationId: event.correlationId,
    status: 'processed',
    insights,
    flaggedForReview: false,
    processedAtMs: nowMs(),
  };

  if (session.onPhoneInsights) {
    const consistency = compareInsightSets(insights, session.onPhoneInsights);
    result.consistency = consistency;
    if (!consistency.withinTolerance) {
      result.flaggedForReview = true; // out of tolerance → human review, not silent acceptance (Req. 17)
    }
  }

  const stored = await deps.resultStore.createIfAbsent(result);
  if (!stored.created) {
    return { outcome: 'duplicate' };
  }
  return { outcome: 'processed', flaggedForReview: result.flaggedForReview };
}

/** Persist a permanent processing failure so it is visible and idempotent, then report it. */
async function persistFailure(
  event: SessionReceivedEvent,
  reason: string,
  deps: ProcessSessionDeps,
  processedAtMs: number,
): Promise<ProcessSessionOutcome> {
  const stored = await deps.resultStore.createIfAbsent({
    sessionId: event.sessionId,
    ownerAthleteId: event.ownerAthleteId,
    correlationId: event.correlationId,
    status: 'failed-validation',
    failureReason: reason,
    flaggedForReview: true, // a stored-but-unprocessable session always warrants a look
    processedAtMs,
  });
  if (!stored.created) {
    return { outcome: 'duplicate' };
  }
  return { outcome: 'failed-validation', reason };
}
