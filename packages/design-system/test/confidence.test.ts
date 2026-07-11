import {
  describeConfidence,
  HIGH_CONFIDENCE_MIN,
  MEDIUM_CONFIDENCE_MIN,
} from '../src/confidence';

describe('describeConfidence', () => {
  it('maps high confidence to the high level with a rounded percent', () => {
    const display = describeConfidence(0.92, true);
    expect(display.level).toBe('high');
    expect(display.percent).toBe(92);
    expect(display.label).toContain('92%');
  });

  it('treats the band boundaries as inclusive lower bounds', () => {
    expect(describeConfidence(HIGH_CONFIDENCE_MIN, true).level).toBe('high');
    expect(describeConfidence(MEDIUM_CONFIDENCE_MIN, true).level).toBe('medium');
    expect(describeConfidence(MEDIUM_CONFIDENCE_MIN - 0.01, true).level).toBe('low');
  });

  it('marks unreliable insights regardless of confidence value', () => {
    const display = describeConfidence(0.99, false);
    expect(display.level).toBe('unreliable');
    expect(display.percent).toBeUndefined();
    expect(display.label).toMatch(/not reliable/i);
  });

  it('clamps out-of-range confidence into 0–100%', () => {
    expect(describeConfidence(1.5, true).percent).toBe(100);
    expect(describeConfidence(-0.2, true).percent).toBe(0);
    expect(describeConfidence(-0.2, true).level).toBe('low');
  });

  it('always pairs a non-color icon glyph with the label', () => {
    for (const [confidence, reliable] of [
      [0.95, true],
      [0.7, true],
      [0.3, true],
      [0.9, false],
    ] as const) {
      expect(describeConfidence(confidence, reliable).icon).not.toBe('');
    }
  });
});
