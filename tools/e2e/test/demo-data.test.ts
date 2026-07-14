import {
  computeSessionInsights,
  defaultSportProfileRegistry,
  loadSportProfile,
} from '@smart-sneaker/insights-engine';
import { HIGH_CONFIDENCE_MIN } from '@smart-sneaker/design-system';
import { DemoArtifactSchema } from '../../../apps/demo-web/src/data/demo-artifact';
import type { DemoArtifact } from '../../../apps/demo-web/src/data/demo-artifact';
import { generateDemoArtifact } from '../src/demo-data';
import { ATHLETE_ASHA, ATHLETE_BEN, ATHLETE_CHIKE, buildSeedCorpus, COACH_DANA } from '../src/seed';

/**
 * Generator integration test (spec 002 AC 1/3/4/5): the demo artifact is
 * schema-valid, deterministic, credential-free, and contains every state the
 * demo promises to show — produced by the real pipeline, never hand-written.
 */
describe('demo-data generator', () => {
  let artifact: DemoArtifact;

  beforeAll(async () => {
    const run = await generateDemoArtifact();
    expect(run.problems).toEqual([]);
    artifact = run.artifact!;
  }, 120_000);

  it('produces a schema-valid artifact', () => {
    expect(DemoArtifactSchema.safeParse(artifact).success).toBe(true);
  });

  it('is byte-deterministic across runs', async () => {
    const second = await generateDemoArtifact();
    expect(JSON.stringify(second.artifact)).toBe(JSON.stringify(artifact));
  }, 120_000);

  it('ships nothing credential-shaped — seed tokens never reach the browser', () => {
    const json = JSON.stringify(artifact);
    expect(json).not.toContain('"token"'); // the roster's bearer-token key
    expect(json).not.toContain('seed-token'); // any literal token value
  });

  it('contains all four Req. 7 trigger states', () => {
    const statuses = new Set(artifact.sessions.map((s) => s.status));
    expect(statuses.has('processing')).toBe(true); // (a) still processing
    expect(artifact.sessions.some((s) => s.failed)).toBe(true); // (d) error state
    expect(artifact.sessions.some((s) => s.dataQualityWarning)).toBe(true); // (c) degraded

    const insights = Object.values(artifact.details).flatMap(
      (d) => d.result?.insights?.insights ?? d.onPhoneInsights?.insights ?? [],
    );
    // (b) low-confidence: both a reliable-but-below-high insight and a fully
    // unreliable one exist, so both visual treatments are reachable.
    expect(insights.some((i) => i.reliable && i.confidence < HIGH_CONFIDENCE_MIN)).toBe(true);
    expect(insights.some((i) => !i.reliable && i.note !== undefined)).toBe(true);

    // Empty state: at least one athlete persona owns no sessions.
    const owners = new Set(artifact.sessions.map((s) => s.ownerAthleteId));
    const emptyAthletes = artifact.personas.filter(
      (p) => p.role === 'athlete' && !owners.has(p.id),
    );
    expect(emptyAthletes.length).toBeGreaterThan(0);
  });

  it('carries a ≥10-point cadence trend series for the primary athlete', () => {
    const cadence = artifact.trends[ATHLETE_ASHA]?.find((s) => s.kind === 'cadence');
    expect(cadence).toBeDefined();
    expect(cadence!.points.length).toBeGreaterThanOrEqual(10);
    const times = cadence!.points.map((p) => p.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('gives the coach exactly the granted athletes — the private athlete is absent', () => {
    const roster = artifact.coachRosters[COACH_DANA]!;
    expect(roster.map((r) => r.athleteId).sort()).toEqual([ATHLETE_ASHA, ATHLETE_BEN]);
    expect(JSON.stringify(roster)).not.toContain(ATHLETE_CHIKE);
  });

  it('records five pipeline stages and only passing scenarios', () => {
    expect(artifact.pipeline.stages.map((s) => s.status)).toEqual([
      'pass',
      'pass',
      'pass',
      'pass',
      'pass',
    ]);
    expect(artifact.pipeline.scenarios.length).toBeGreaterThanOrEqual(20);
    expect(artifact.pipeline.scenarios.every((s) => s.status === 'pass')).toBe(true);
  });

  it('pins the capture replay to a real seed session’s run options', () => {
    const corpus = buildSeedCorpus();
    const source = corpus.sessions.find((s) => s.slug === artifact.capture.sourceSlug);
    expect(source).toBeDefined();
    expect(artifact.capture.durationMs).toBe(source!.runOptions.durationMs);
    expect(artifact.capture.dropouts).toEqual(source!.runOptions.dropouts ?? []);
  });

  it('spot-check (Req. 6): artifact insight values equal a fresh engine recomputation', () => {
    const corpus = buildSeedCorpus();
    for (const slug of ['asha-trend-9', 'asha-noisy-run', 'ben-dropout-run']) {
      const seeded = corpus.sessions.find((s) => s.slug === slug)!;
      const detail = artifact.details[seeded.session.sessionId]!;
      const profile = loadSportProfile(seeded.session.sportProfileId, defaultSportProfileRegistry);
      const recomputed = computeSessionInsights(seeded.session, profile, {
        computedBy: 'cloud-worker',
        nowMs: seeded.session.startedAtMs + seeded.runOptions.durationMs + 60_000,
      });
      expect(detail.result!.insights!.insights).toEqual(recomputed.insights);
    }
  });
});
