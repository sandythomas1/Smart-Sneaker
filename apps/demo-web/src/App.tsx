import { useEffect, useMemo, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { DemoArtifact } from './data/demo-artifact';
import { fetchDemoArtifact, type ArtifactLoad } from './data/load';
import { personaById } from './data/derive';
import { DemoContext, type DemoState } from './demo-context';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorState } from './components/States';
import { SessionListView } from './views/SessionListView';
import { SessionDetailView } from './views/SessionDetailView';
import { TrendsView } from './views/TrendsView';
import { CaptureView } from './views/CaptureView';
import { CoachView } from './views/CoachView';
import { PipelineView } from './views/PipelineView';

export function App() {
  const [load, setLoad] = useState<ArtifactLoad | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void fetchDemoArtifact().then((result) => {
      if (!cancelled) setLoad(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (load === undefined) {
    return (
      <main className="shell__main">
        <p className="state" role="status">
          Loading seeded demo data…
        </p>
      </main>
    );
  }

  if (!load.ok) {
    return (
      <main className="shell__main">
        <ErrorState title="Demo data unavailable" message={load.message} />
      </main>
    );
  }

  return (
    <ErrorBoundary>
      <DemoApp artifact={load.artifact} />
    </ErrorBoundary>
  );
}

function DemoApp(props: { artifact: DemoArtifact }) {
  const { artifact } = props;
  const defaultPersona = artifact.personas.find((p) => p.role === 'athlete') ?? artifact.personas[0]!;
  const [personaId, setPersonaId] = useState(defaultPersona.id);
  const persona = personaById(artifact, personaId) ?? defaultPersona;

  const state = useMemo<DemoState>(
    () => ({ artifact, persona, setPersonaId }),
    [artifact, persona],
  );

  return (
    <DemoContext.Provider value={state}>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route
              path="/"
              element={<Navigate to={persona.role === 'coach' ? '/coach' : '/sessions'} replace />}
            />
            <Route path="/sessions" element={<SessionListView />} />
            <Route path="/sessions/:sessionId" element={<SessionDetailView />} />
            <Route path="/trends" element={<TrendsView />} />
            <Route path="/capture" element={<CaptureView />} />
            <Route path="/coach" element={<CoachView />} />
            <Route path="/pipeline" element={<PipelineView />} />
            <Route
              path="*"
              element={
                <ErrorState
                  title="Nothing here"
                  message="That route doesn't exist in the demo."
                />
              }
            />
          </Routes>
        </AppShell>
      </HashRouter>
    </DemoContext.Provider>
  );
}
