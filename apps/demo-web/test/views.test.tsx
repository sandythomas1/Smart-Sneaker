import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { buildFixtureArtifact, FIX_COACH, FIX_MIRA, fixtureUuid } from './fixtures';

/**
 * Component render suite (spec 002 Req. 7, 9, 10): every non-happy state has
 * a visually distinct, reachable treatment, the DEMO badge is on every view,
 * and persona switching needs no reload. Runs against the fixture artifact —
 * the real artifact's content is covered by the generator integration test.
 */

function mockArtifactFetch(): void {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => buildFixtureArtifact(),
  })) as unknown as typeof fetch;
}

async function renderAt(hash: string) {
  window.location.hash = hash;
  mockArtifactFetch();
  render(<App />);
  // The shell title only appears once the artifact loaded and validated.
  await screen.findByText('Smart Sneaker');
}

async function switchPersona(personaId: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText(/Persona/), { target: { value: personaId } });
}

describe('app shell', () => {
  it.each(['#/sessions', '#/trends', '#/capture', '#/pipeline'])(
    'shows the DEMO badge and persona switcher on %s',
    async (hash) => {
      await renderAt(hash);
      expect(screen.getByText('DEMO')).toBeTruthy();
      expect(screen.getByText('Simulated — no real access control')).toBeTruthy();
    },
  );

  it('shows the DEMO badge on the coach view too', async () => {
    await renderAt('#/sessions');
    await switchPersona(FIX_COACH);
    await screen.findByText('Your athletes');
    expect(screen.getByText('DEMO')).toBeTruthy();
  });

  it('renders the designed error state when the artifact fails validation', async () => {
    window.location.hash = '#/sessions';
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ schemaVersion: 999 }),
    })) as unknown as typeof fetch;
    render(<App />);
    await screen.findByText('Demo data unavailable');
    expect(screen.getByRole('alert').textContent).toContain('demo data failed validation');
  });
});

describe('persona switching (Req. 10)', () => {
  it('switches athlete → coach → athlete without a reload, gating data per persona', async () => {
    await renderAt('#/sessions');
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy();

    await switchPersona(FIX_COACH);
    await screen.findByText('Your athletes');
    expect(screen.getByText('Asha')).toBeTruthy();
    expect(screen.queryByText('Ben')).toBeNull(); // no grant — never in the roster

    await switchPersona(FIX_MIRA);
    await screen.findByText('No sessions yet'); // Mira's empty state
  });
});

describe('non-happy-path states (Req. 7)', () => {
  it('lists processing, on-phone-only, failed, and data-quality states distinctly', async () => {
    await renderAt('#/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    expect(screen.getByText('Processing…')).toBeTruthy();
    expect(screen.getByText('On phone only')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getAllByLabelText('Data quality warning').length).toBeGreaterThan(0);
  });

  it('renders the still-processing session detail as a designed waiting state', async () => {
    await renderAt(`#/sessions/${fixtureUuid(2)}`);
    await screen.findByText('Still processing');
  });

  it('renders the failed-validation session as a designed error state', async () => {
    await renderAt(`#/sessions/${fixtureUuid(4)}`);
    await screen.findByText("This session couldn't be processed");
    expect(screen.getByText('stored session blob is not valid JSON')).toBeTruthy();
  });

  it('marks an unreliable insight with the non-color badge and its note', async () => {
    await renderAt(`#/sessions/${fixtureUuid(5)}`);
    await screen.findByText('Not reliable this session');
    expect(
      screen.getByText('derived from low-confidence segmentation — treat as indicative only'),
    ).toBeTruthy();
  });

  it('shows a below-high-confidence insight with its percent badge', async () => {
    await renderAt(`#/sessions/${fixtureUuid(1)}`);
    await screen.findByText('Medium confidence · 71%');
  });

  it('denies another athlete’s session with an indistinguishable not-found state', async () => {
    await renderAt(`#/sessions/${fixtureUuid(6)}`); // Ben's session, Asha persona
    await screen.findByText('Session not found');
  });
});

describe('insights and provenance (Req. 2)', () => {
  it('renders all four insight classes with confidence indicators', async () => {
    await renderAt(`#/sessions/${fixtureUuid(1)}`);
    await screen.findByText('Pressure balance');
    expect(screen.getByText('Ground contact time · Left')).toBeTruthy();
    expect(screen.getByText('Ground contact time · Right')).toBeTruthy();
    expect(screen.getByText('Cadence')).toBeTruthy();
    expect(screen.getByText('Foot strike')).toBeTruthy();
    expect(screen.getByText('Computed in cloud')).toBeTruthy();
  });

  it('labels an on-phone-only session’s provisional provenance', async () => {
    await renderAt(`#/sessions/${fixtureUuid(3)}`);
    await screen.findByText('Computed on phone · not yet verified in cloud');
  });
});

describe('trends and pipeline views', () => {
  it('offers metric toggles and the drift callout structure', async () => {
    await renderAt('#/trends');
    await screen.findByRole('heading', { name: 'Trends' });
    expect(screen.getByRole('group', { name: 'Metric' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Cadence across 2 sessions/ })).toBeTruthy();
  });

  it('renders pipeline stages including failing and running states distinctly', async () => {
    await renderAt('#/pipeline');
    await screen.findByRole('heading', { name: 'Pipeline' });
    expect(screen.getByText('Capture')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    const failChips = screen.getAllByText('failing');
    expect(failChips.length).toBeGreaterThan(0);
    expect(screen.getByText('fixture-fail')).toBeTruthy();
  });
});

describe('capture simulation (Req. 4)', () => {
  it('starts recording from the idle state and shows the live indicators', async () => {
    await renderAt('#/capture');
    await screen.findByText('Ready to run');
    fireEvent.click(screen.getByText('Start session'));
    await screen.findByText('REC');
    expect(screen.getByText(/Signal · 200 packets\/s/)).toBeTruthy();
    fireEvent.click(screen.getByText('End session'));
    await screen.findByText('Session saved');
  });
});
