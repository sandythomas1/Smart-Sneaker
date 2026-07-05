import { computeSessionInsights, defaultSportProfileRegistry, ENGINE_VERSION, loadSportProfile, RUNNING_PROFILE_ID } from '@smart-sneaker/insights-engine';
import { processSessionEvent, SessionBlobMissingError } from '../src/process-session';
import { eventFor, harnessWithSession, OWNER_ID, syntheticSession } from './helpers';

describe('processSessionEvent (T7: authoritative server-side processing)', () => {
  it('consumes an event and persists a structured result computed by the same insights engine (Req. 17)', async () => {
    const session = syntheticSession();
    const { deps, results } = harnessWithSession(session);

    const outcome = await processSessionEvent(eventFor(session), deps);

    expect(outcome).toEqual({ outcome: 'processed', flaggedForReview: false });
    const stored = results.results.get(session.sessionId)!;
    expect(stored).toMatchObject({
      sessionId: session.sessionId,
      ownerAthleteId: OWNER_ID,
      correlationId: eventFor(session).correlationId,
      status: 'processed',
      flaggedForReview: false,
    });
    expect(stored.insights!.computedBy).toBe('cloud-worker');
    expect(stored.insights!.engineVersion).toBe(ENGINE_VERSION);
    expect(stored.insights!.insights.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['pressure_balance', 'ground_contact_time', 'cadence', 'foot_strike']),
    );
  });

  it('redelivering the same event does not duplicate the stored result (Req. 18)', async () => {
    const session = syntheticSession();
    const { deps, results } = harnessWithSession(session);

    await processSessionEvent(eventFor(session), deps);
    const second = await processSessionEvent(eventFor(session), deps);

    expect(second).toEqual({ outcome: 'duplicate' });
    expect(results.results.size).toBe(1);
  });

  it('records a per-insight comparison when the upload carries an on-phone result; agreement is not flagged', async () => {
    const base = syntheticSession();
    const profile = loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry);
    const onPhone = computeSessionInsights(base, profile, { computedBy: 'on-phone', nowMs: 1 });
    const session = { ...base, onPhoneInsights: onPhone };
    const { deps, results } = harnessWithSession(session);

    const outcome = await processSessionEvent(eventFor(session), deps);

    expect(outcome).toEqual({ outcome: 'processed', flaggedForReview: false });
    const consistency = results.results.get(session.sessionId)!.consistency!;
    expect(consistency.withinTolerance).toBe(true);
    expect(consistency.engineVersionMatch).toBe(true);
    expect(consistency.comparisons.length).toBeGreaterThanOrEqual(5); // 4 kinds, contact time × 2 feet
  });

  it('flags a session whose on-phone result exceeds tolerance instead of silently accepting it (Req. 17)', async () => {
    const base = syntheticSession();
    const profile = loadSportProfile(RUNNING_PROFILE_ID, defaultSportProfileRegistry);
    const onPhone = computeSessionInsights(base, profile, { computedBy: 'on-phone', nowMs: 1 });
    const doctored = {
      ...onPhone,
      insights: onPhone.insights.map((i) =>
        i.kind === 'cadence' ? { ...i, value: (i.value as number) * 1.3 } : i,
      ),
    };
    const session = { ...base, onPhoneInsights: doctored };
    const { deps, results } = harnessWithSession(session);

    const outcome = await processSessionEvent(eventFor(session), deps);

    expect(outcome).toEqual({ outcome: 'processed', flaggedForReview: true });
    const stored = results.results.get(session.sessionId)!;
    expect(stored.flaggedForReview).toBe(true);
    const cadence = stored.consistency!.comparisons.find((c) => c.kind === 'cadence')!;
    expect(cadence.status).toBe('out-of-tolerance');
  });

  it('rejects an event that fails contract validation without touching storage', async () => {
    const session = syntheticSession();
    const { deps, results } = harnessWithSession(session);

    const outcome = await processSessionEvent({ sessionId: 'not-a-uuid' }, deps);

    expect(outcome.outcome).toBe('rejected-event');
    if (outcome.outcome === 'rejected-event') {
      expect(outcome.issues.length).toBeGreaterThan(0);
    }
    expect(results.results.size).toBe(0);
  });

  it('throws for a missing blob so delivery is retried (transient by construction)', async () => {
    const session = syntheticSession();
    const { deps, blobs, results } = harnessWithSession(session);
    blobs.blobs.clear();

    await expect(processSessionEvent(eventFor(session), deps)).rejects.toThrow(SessionBlobMissingError);
    expect(results.results.size).toBe(0);
  });

  it('persists an idempotent, visible failure for a blob that is not valid JSON', async () => {
    const session = syntheticSession();
    const { deps, blobs, results } = harnessWithSession(session);
    blobs.blobs.set(eventFor(session).blobPath, '{not json');

    const first = await processSessionEvent(eventFor(session), deps);
    const second = await processSessionEvent(eventFor(session), deps);

    expect(first).toEqual({ outcome: 'failed-validation', reason: expect.stringMatching(/not valid JSON/) });
    expect(second).toEqual({ outcome: 'duplicate' });
    const stored = results.results.get(session.sessionId)!;
    expect(stored.status).toBe('failed-validation');
    expect(stored.flaggedForReview).toBe(true);
    expect(stored.insights).toBeUndefined();
  });

  it('persists a failure with field detail for a blob that fails the Session contract', async () => {
    const session = syntheticSession();
    const { deps, blobs } = harnessWithSession(session);
    blobs.blobs.set(eventFor(session).blobPath, JSON.stringify({ ...session, samples: [] }));

    const outcome = await processSessionEvent(eventFor(session), deps);

    expect(outcome.outcome).toBe('failed-validation');
    if (outcome.outcome === 'failed-validation') {
      expect(outcome.reason).toMatch(/samples/);
    }
  });

  it('persists a failure for an unknown sport profile instead of crashing the delivery', async () => {
    const session = { ...syntheticSession(), sportProfileId: 'curling-v1' };
    const { deps, results } = harnessWithSession(session);

    const outcome = await processSessionEvent(eventFor(session), deps);

    expect(outcome).toEqual({
      outcome: 'failed-validation',
      reason: expect.stringMatching(/curling-v1/),
    });
    expect(results.results.get(session.sessionId)!.status).toBe('failed-validation');
  });
});
