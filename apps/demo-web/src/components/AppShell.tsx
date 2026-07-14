import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { DemoBadge } from '@smart-sneaker/design-system';
import { useDemo } from '../demo-context';

interface TabItem {
  to: string;
  label: string;
  icon: string;
}

const ATHLETE_TABS: TabItem[] = [
  { to: '/sessions', label: 'Sessions', icon: '☰' },
  { to: '/trends', label: 'Trends', icon: '↗' },
  { to: '/capture', label: 'Record', icon: '●' },
  { to: '/pipeline', label: 'Pipeline', icon: '⚙' },
];

const COACH_TABS: TabItem[] = [
  { to: '/coach', label: 'Athletes', icon: '☰' },
  { to: '/pipeline', label: 'Pipeline', icon: '⚙' },
];

export function AppShell(props: { children: ReactNode }) {
  const { artifact, persona, setPersonaId } = useDemo();
  const navigate = useNavigate();
  const tabs = persona.role === 'coach' ? COACH_TABS : ATHLETE_TABS;

  const switchPersona = (personaId: string): void => {
    const next = artifact.personas.find((p) => p.id === personaId);
    if (!next) return;
    setPersonaId(personaId);
    navigate(next.role === 'coach' ? '/coach' : '/sessions');
  };

  return (
    <div className="shell">
      <header className="shell__header">
        <h1 className="shell__title">Smart Sneaker</h1>
        <DemoBadge />
        <span className="shell__spacer" />
        <label className="persona-switcher">
          Persona
          <select value={persona.id} onChange={(event) => switchPersona(event.target.value)}>
            {artifact.personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} · {p.role}
              </option>
            ))}
          </select>
          <span className="persona-switcher__note">Simulated — no real access control</span>
        </label>
      </header>
      <nav className="tabbar" aria-label="Primary">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className="tabbar__item">
            <span className="tabbar__icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <main className="shell__main">{props.children}</main>
    </div>
  );
}
