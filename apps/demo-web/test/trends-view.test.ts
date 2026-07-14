import type { DemoTrendSeries } from '../src/data/demo-artifact';
import { driftSummary, metricOptions } from '../src/data/trends-view';
import { fixtureUuid } from './fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

function series(
  kind: string,
  values: number[],
  overrides: Partial<DemoTrendSeries> = {},
): DemoTrendSeries {
  return {
    kind,
    points: values.map((value, i) => ({
      sessionId: fixtureUuid(i + 1),
      atMs: i * 4 * DAY_MS,
      value,
      confidence: 0.9,
      reliable: true,
    })),
    ...overrides,
  };
}

describe('metricOptions', () => {
  it('orders metrics cadence → balance → contact time and labels feet', () => {
    const options = metricOptions([
      series('ground_contact_time', [240, 241, 242], { foot: 'right', unit: 'ms' }),
      series('pressure_balance', [50, 51, 52], { unit: '%' }),
      series('ground_contact_time', [238, 239, 240], { foot: 'left', unit: 'ms' }),
      series('cadence', [165, 170, 172], { unit: 'steps/min' }),
    ]);
    expect(options.map((o) => o.label)).toEqual([
      'Cadence',
      'Balance',
      'Contact time (L)',
      'Contact time (R)',
    ]);
  });

  it('drops empty series instead of offering a blank chart', () => {
    expect(metricOptions([series('cadence', [])])).toEqual([]);
  });
});

describe('driftSummary', () => {
  it('phrases balance drift with a side and a week count', () => {
    const summary = driftSummary(series('pressure_balance', [50, 50, 50.5, 52, 53, 53.5]));
    expect(summary).toContain('toward your left side');
    expect(summary).toMatch(/over \d+ weeks/);
  });

  it('phrases numeric drift with unit and direction', () => {
    const summary = driftSummary(
      series('cadence', [165, 166, 167, 172, 174, 176], { unit: 'steps/min' }),
    );
    expect(summary).toContain('cadence is up');
    expect(summary).toContain('steps/min');
  });

  it('stays quiet for short or flat series', () => {
    expect(driftSummary(series('cadence', [170, 170, 171]))).toBeUndefined();
    expect(driftSummary(series('cadence', [170, 170, 170, 170, 170, 170]))).toBeUndefined();
  });
});
