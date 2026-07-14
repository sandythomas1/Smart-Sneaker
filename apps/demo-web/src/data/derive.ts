import type { SessionStatus } from '@smart-sneaker/design-system';
import type {
  DemoArtifact,
  DemoCoachAthlete,
  DemoPersona,
  DemoSessionDetail,
  DemoSessionSummary,
  DemoTrendSeries,
} from './demo-artifact';

/**
 * Pure view-state derivation over the validated artifact. This is the demo's
 * "persona gating": presentation-only filtering that mirrors (and is fed by)
 * the real server-side rules — the generator only ever put granted athletes
 * into a coach's roster, so nothing here can leak what the artifact doesn't
 * contain.
 */

export function personaById(artifact: DemoArtifact, personaId: string): DemoPersona | undefined {
  return artifact.personas.find((p) => p.id === personaId);
}

/** The athletes whose data this persona may see: itself, or its granted roster. */
export function visibleAthleteIds(artifact: DemoArtifact, persona: DemoPersona): string[] {
  if (persona.role === 'athlete') return [persona.id];
  return (artifact.coachRosters[persona.id] ?? []).map((entry) => entry.athleteId);
}

/** An athlete's sessions, newest first (artifact order is already newest-first). */
export function sessionsForAthlete(
  artifact: DemoArtifact,
  athleteId: string,
): DemoSessionSummary[] {
  return artifact.sessions.filter((s) => s.ownerAthleteId === athleteId);
}

/** A session's detail, only if its owner is visible to the persona. */
export function detailForPersona(
  artifact: DemoArtifact,
  persona: DemoPersona,
  sessionId: string,
): { summary: DemoSessionSummary; detail: DemoSessionDetail | undefined } | undefined {
  const summary = artifact.sessions.find((s) => s.sessionId === sessionId);
  if (!summary) return undefined;
  if (!visibleAthleteIds(artifact, persona).includes(summary.ownerAthleteId)) return undefined;
  return { summary, detail: artifact.details[sessionId] };
}

export function trendsForAthlete(artifact: DemoArtifact, athleteId: string): DemoTrendSeries[] {
  return artifact.trends[athleteId] ?? [];
}

export function rosterForCoach(artifact: DemoArtifact, coachId: string): DemoCoachAthlete[] {
  return artifact.coachRosters[coachId] ?? [];
}

/** Map a summary to the design system's status chip (failed sessions surface
 * through `failed`/error treatment, not the chip). */
export function chipStatus(summary: DemoSessionSummary): SessionStatus {
  return summary.status;
}

const SPORT_LABELS: Record<string, string> = { 'running-v1': 'Running' };

export function sportLabel(sportProfileId: string): string {
  return SPORT_LABELS[sportProfileId] ?? sportProfileId;
}
