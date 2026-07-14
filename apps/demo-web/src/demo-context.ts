import { createContext, useContext } from 'react';
import type { DemoArtifact, DemoPersona } from './data/demo-artifact';

export interface DemoState {
  artifact: DemoArtifact;
  persona: DemoPersona;
  setPersonaId: (personaId: string) => void;
}

export const DemoContext = createContext<DemoState | null>(null);

export function useDemo(): DemoState {
  const state = useContext(DemoContext);
  if (!state) throw new Error('useDemo must be used inside DemoContext.Provider');
  return state;
}
