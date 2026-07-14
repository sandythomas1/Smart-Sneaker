import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@smart-sneaker/design-system';
import { useDemo } from '../demo-context';
import { formatElapsed } from '../data/format';
import { connectionLabel, frameAt } from '../capture/replay';
import { EmptyState } from '../components/States';

const TICK_MS = 100;

type Phase = 'idle' | 'recording' | 'ended';

export function CaptureView() {
  const { artifact, persona } = useDemo();
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);

  const capture = artifact.capture;

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const timer = setInterval(() => {
      setElapsedMs((previous) => previous + TICK_MS);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase]);

  const frame = frameAt(capture, elapsedMs);

  useEffect(() => {
    if (phase === 'recording' && frame.done) setPhase('ended');
  }, [phase, frame.done]);

  if (persona.role === 'coach') return <Navigate to="/coach" replace />;

  if (phase === 'idle') {
    return (
      <section className="capture">
        <h2 className="view__heading">Record</h2>
        <EmptyState
          icon="●"
          title="Ready to run"
          message={`Replays the seeded session "${capture.sourceSlug}" — including its mid-run BLE dropout — as a live capture.`}
        />
        <Button
          onClick={() => {
            setElapsedMs(0);
            setPhase('recording');
          }}
        >
          Start session
        </Button>
      </section>
    );
  }

  if (phase === 'ended') {
    return (
      <section className="capture">
        <h2 className="view__heading">Session saved</h2>
        <p className="capture__timer">{formatElapsed(frame.elapsedMs)}</p>
        <p className="session-card__meta">
          Recording stored on the phone — it syncs and processes like every seeded session.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            setElapsedMs(0);
            setPhase('idle');
          }}
        >
          Back to start
        </Button>
      </section>
    );
  }

  return (
    <section className="capture">
      <span className="capture__rec">
        <span className="capture__rec-dot" aria-hidden="true" />
        REC
      </span>
      <p className="capture__timer" aria-label={`Elapsed ${formatElapsed(frame.elapsedMs)}`}>
        {formatElapsed(frame.elapsedMs)}
      </p>
      <div className="capture__status" role="status">
        <span className={frame.reconnecting ? 'capture__reassure' : undefined}>
          {connectionLabel(frame)}
        </span>
        {frame.reconnecting ? (
          <span className="capture__reassure">
            Still recording — the shoe buffers while disconnected, no data lost.
          </span>
        ) : (
          <span>Signal · {Math.round(frame.packetsPerSecond)} packets/s</span>
        )}
      </div>
      <Button variant="danger" onClick={() => setPhase('ended')}>
        End session
      </Button>
    </section>
  );
}
