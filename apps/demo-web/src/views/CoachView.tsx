import { Link, Navigate } from 'react-router-dom';
import { StatusChip } from '@smart-sneaker/design-system';
import { useDemo } from '../demo-context';
import { rosterForCoach } from '../data/derive';
import { formatSessionDate } from '../data/format';
import { EmptyState } from '../components/States';

/** Minimal coach surface (spec: athlete-first investment split). It exists to
 * demonstrate the visibility model: only athletes with an explicit sharing
 * grant ever reach this roster — enforced upstream by the generator. */
export function CoachView() {
  const { artifact, persona } = useDemo();
  if (persona.role !== 'coach') return <Navigate to="/sessions" replace />;

  const roster = rosterForCoach(artifact, persona.id);
  return (
    <section>
      <h2 className="view__heading">Your athletes</h2>
      <p className="view__subheading sharing-note">
        Athletes appear here only after they explicitly share their data with you.
      </p>
      {roster.length === 0 ? (
        <EmptyState
          icon="🤝"
          title="No shared athletes"
          message="When an athlete grants you access, their summaries show up here."
        />
      ) : (
        <ul className="roster">
          {roster.map((athlete) => (
            <li key={athlete.athleteId} className="roster__card">
              <h3 className="roster__name">{athlete.displayName}</h3>
              <p className="roster__meta">
                {athlete.sessionCount} session{athlete.sessionCount === 1 ? '' : 's'} shared
              </p>
              {athlete.lastSession ? (
                <p className="roster__meta chip-row">
                  Last session · {formatSessionDate(athlete.lastSession.startedAtMs)}
                  <StatusChip status={athlete.lastSession.status} />
                  <Link to={`/sessions/${athlete.lastSession.sessionId}`}>View insights</Link>
                </p>
              ) : (
                <p className="roster__meta">No sessions yet.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
