import { Navigate } from 'react-router-dom';
import { useDemo } from '../demo-context';
import { sessionsForAthlete } from '../data/derive';
import { SessionCard } from '../components/SessionCard';
import { EmptyState } from '../components/States';

export function SessionListView() {
  const { artifact, persona } = useDemo();
  if (persona.role === 'coach') return <Navigate to="/coach" replace />;

  const sessions = sessionsForAthlete(artifact, persona.id);
  return (
    <section>
      <h2 className="view__heading">Sessions</h2>
      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          message="Lace up — your first run will appear here as soon as it's recorded."
        />
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <SessionCard key={session.sessionId} session={session} />
          ))}
        </ul>
      )}
    </section>
  );
}
