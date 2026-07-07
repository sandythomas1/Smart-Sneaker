import { act, create, ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { generateSyntheticRun } from '@smart-sneaker/insights-engine';
import { InsightsScreen } from '../src/screens/InsightsScreen';

/**
 * T10 acceptance criteria: after a recorded session, all four insights display
 * with confidence indicators — with networking disabled — and an asymmetric
 * fixture displays the expected asymmetric balance.
 */

const CLEAN_RUN = {
  durationMs: 10_000,
  strideIntervalMs: 700,
  contactMs: 200,
  sampleIntervalMs: 10,
  rightFootOffsetMs: 350,
};

// Networking disabled for the whole suite: the on-phone path must never touch it (Req. 4).
const fetchSpy = jest.fn(() => {
  throw new Error('network access attempted on the on-phone insights path');
});
beforeAll(() => {
  (globalThis as { fetch?: unknown }).fetch = fetchSpy;
});

function renderScreen(session: Parameters<typeof InsightsScreen>[0]['session']): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<InsightsScreen session={session} />);
  });
  return renderer;
}

function textOf(instance: ReactTestInstance): string {
  return instance.props.children.toString();
}

describe('InsightsScreen (Req. 4, 10-11)', () => {
  it('displays all four running insights with confidence indicators, offline', () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const renderer = renderScreen(session);

    renderer.root.findByProps({ testID: 'insights-ready' });
    for (const key of ['pressure_balance', 'ground_contact_time:left', 'ground_contact_time:right', 'cadence', 'foot_strike']) {
      renderer.root.findByProps({ testID: `card-${key}` });
      expect(textOf(renderer.root.findByProps({ testID: `confidence-${key}` }))).toMatch(
        /Confidence: \d+%|Unreliable \(confidence \d+%\)/,
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the expected asymmetry for a deliberately left-favoring session', () => {
    const { session } = generateSyntheticRun({ ...CLEAN_RUN, peakPressureByFoot: { right: 5 } });
    const renderer = renderScreen(session);

    const value = textOf(renderer.root.findByProps({ testID: 'value-pressure_balance' }));
    const leftShare = Number.parseFloat(value);
    expect(leftShare).toBeGreaterThan(60);
    expect(value).toContain('% left');
  });

  it('renders the degraded state, not a crash, when insights are unavailable', () => {
    const { session } = generateSyntheticRun(CLEAN_RUN);
    const renderer = renderScreen({ ...session, sportProfileId: 'curling-v1' });

    renderer.root.findByProps({ testID: 'insights-unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
