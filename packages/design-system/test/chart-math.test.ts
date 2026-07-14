import { linearScale, niceTicks, typicalRange } from '../src/chart-math';

describe('linearScale', () => {
  it('maps the domain onto the range linearly', () => {
    const scale = linearScale(0, 10, 100, 200);
    expect(scale(0)).toBe(100);
    expect(scale(5)).toBe(150);
    expect(scale(10)).toBe(200);
  });

  it('supports inverted ranges (SVG y grows downward)', () => {
    const scale = linearScale(0, 10, 200, 100);
    expect(scale(0)).toBe(200);
    expect(scale(10)).toBe(100);
  });

  it('maps a degenerate domain to the range midpoint instead of NaN', () => {
    const scale = linearScale(7, 7, 0, 100);
    expect(scale(7)).toBe(50);
    expect(scale(123)).toBe(50);
  });
});

describe('niceTicks', () => {
  it('produces round-numbered ticks covering the domain', () => {
    expect(niceTicks(165, 176, 3)).toEqual([165, 170, 175]);
  });

  it('handles small fractional domains without float-drift labels', () => {
    for (const tick of niceTicks(0.4, 0.9, 4)) {
      expect(String(tick).length).toBeLessThanOrEqual(4);
    }
  });

  it('collapses a flat domain to a single tick', () => {
    expect(niceTicks(50, 50)).toEqual([50]);
  });
});

describe('typicalRange', () => {
  it('returns mean ± std clamped to the observed extent', () => {
    const range = typicalRange([10, 10, 10, 10])!;
    expect(range.min).toBe(10);
    expect(range.max).toBe(10);
    const spread = typicalRange([160, 170, 180])!;
    expect(spread.min).toBeGreaterThanOrEqual(160);
    expect(spread.max).toBeLessThanOrEqual(180);
    expect(spread.min).toBeLessThan(spread.max);
  });

  it('declines to summarize fewer than three points', () => {
    expect(typicalRange([1, 2])).toBeUndefined();
  });
});
