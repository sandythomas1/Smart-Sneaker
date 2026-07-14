import { parseDemoArtifact } from '../src/data/load';
import {
  detailForPersona,
  personaById,
  rosterForCoach,
  sessionsForAthlete,
  sportLabel,
  trendsForAthlete,
  visibleAthleteIds,
} from '../src/data/derive';
import { toCardModel, toCardModels } from '../src/data/insight-presentation';
import { formatDuration, formatElapsed, formatSessionDate } from '../src/data/format';
import {
  buildFixtureArtifact,
  FIX_ASHA,
  FIX_BEN,
  FIX_COACH,
  FIX_MIRA,
  fixtureInsight,
  fixtureInsightSet,
  fixtureUuid,
} from './fixtures';

describe('artifact validation at the boundary', () => {
  it('accepts the fixture artifact', () => {
    expect(parseDemoArtifact(buildFixtureArtifact()).ok).toBe(true);
  });

  it('rejects a malformed payload with a readable message, never throws', () => {
    const load = parseDemoArtifact({ schemaVersion: 999 });
    expect(load.ok).toBe(false);
    if (!load.ok) expect(load.message).toContain('demo data failed validation');
  });

  it('rejects an artifact whose detail carries both result and on-phone insights', () => {
    const artifact = buildFixtureArtifact();
    const detail = artifact.details[fixtureUuid(1)]!;
    detail.onPhoneInsights = fixtureInsightSet(fixtureUuid(1), [fixtureInsight()], 'on-phone');
    expect(parseDemoArtifact(artifact).ok).toBe(false);
  });
});

describe('persona gating', () => {
  const artifact = buildFixtureArtifact();
  const asha = personaById(artifact, FIX_ASHA)!;
  const coach = personaById(artifact, FIX_COACH)!;
  const mira = personaById(artifact, FIX_MIRA)!;

  it('an athlete sees only itself', () => {
    expect(visibleAthleteIds(artifact, asha)).toEqual([FIX_ASHA]);
  });

  it('a coach sees exactly the granted roster — Ben never appears', () => {
    expect(visibleAthleteIds(artifact, coach)).toEqual([FIX_ASHA]);
    expect(visibleAthleteIds(artifact, coach)).not.toContain(FIX_BEN);
  });

  it('an athlete cannot open another athlete’s session detail', () => {
    expect(detailForPersona(artifact, asha, fixtureUuid(6))).toBeUndefined();
  });

  it('a coach can open a granted athlete’s session detail', () => {
    const opened = detailForPersona(artifact, coach, fixtureUuid(1));
    expect(opened?.detail?.result?.ownerAthleteId).toBe(FIX_ASHA);
  });

  it('a processing session has a summary but no detail — that absence is the state', () => {
    const opened = detailForPersona(artifact, asha, fixtureUuid(2));
    expect(opened?.summary.status).toBe('processing');
    expect(opened?.detail).toBeUndefined();
  });

  it('an athlete with no sessions yields the empty state, not an error', () => {
    expect(sessionsForAthlete(artifact, mira.id)).toEqual([]);
    expect(trendsForAthlete(artifact, mira.id)).toEqual([]);
  });
});

describe('session and roster derivation', () => {
  const artifact = buildFixtureArtifact();

  it('filters sessions per athlete preserving newest-first artifact order', () => {
    const sessions = sessionsForAthlete(artifact, FIX_ASHA);
    expect(sessions).toHaveLength(5);
    const startTimes = sessions.map((s) => s.startedAtMs);
    expect(startTimes).toEqual([...startTimes].sort((a, b) => b - a));
  });

  it('returns the coach roster with last-session summaries', () => {
    const roster = rosterForCoach(artifact, FIX_COACH);
    expect(roster).toHaveLength(1);
    expect(roster[0]!.lastSession?.ownerAthleteId).toBe(FIX_ASHA);
  });

  it('maps sport profile ids to labels with a safe fallback', () => {
    expect(sportLabel('running-v1')).toBe('Running');
    expect(sportLabel('cycling-v1')).toBe('cycling-v1');
  });
});

describe('insight presentation', () => {
  it('renders pressure balance as an L/R split with share', () => {
    const model = toCardModel(
      fixtureInsight({ kind: 'pressure_balance', value: 54, unit: '%', confidence: 0.92 }),
    );
    expect(model.valueText).toBe('L 54 / R 46');
    expect(model.leftShare).toBeCloseTo(0.54);
    expect(model.takeaway).toContain('left side');
  });

  it('keeps the unreliable note and drops the takeaway for unreliable insights', () => {
    const model = toCardModel(
      fixtureInsight({ reliable: false, confidence: 0.4, note: 'too many dropped packets' }),
    );
    expect(model.reliable).toBe(false);
    expect(model.note).toBe('too many dropped packets');
    expect(model.takeaway).toBeUndefined();
  });

  it('titles per-foot insights distinctly and orders cards by design order', () => {
    const set = fixtureInsightSet(fixtureUuid(1), [
      fixtureInsight({ kind: 'foot_strike', value: 'midfoot' }),
      fixtureInsight({ kind: 'ground_contact_time', foot: 'right', value: 262, unit: 'ms' }),
      fixtureInsight({ kind: 'ground_contact_time', foot: 'left', value: 245, unit: 'ms' }),
      fixtureInsight({ kind: 'pressure_balance', value: 50, unit: '%' }),
      fixtureInsight(),
    ]);
    const models = toCardModels(set);
    expect(models.map((m) => m.key)).toEqual([
      'pressure_balance',
      'ground_contact_time:left',
      'ground_contact_time:right',
      'cadence',
      'foot_strike',
    ]);
    expect(models[1]!.title).toBe('Ground contact time · Left');
    expect(models[4]!.valueText).toBe('Midfoot');
  });
});

describe('formatting', () => {
  it('formats durations as m:ss', () => {
    expect(formatDuration(45_000)).toBe('0:45');
    expect(formatDuration(90_000)).toBe('1:30');
    expect(formatElapsed(1_122_000)).toBe('18:42');
  });

  it('formats session dates deterministically in UTC', () => {
    expect(formatSessionDate(Date.UTC(2026, 5, 1, 8, 0, 0))).toBe('Jun 1 · 8:00 AM');
  });
});
