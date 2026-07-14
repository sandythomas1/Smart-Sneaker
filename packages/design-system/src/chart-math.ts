/**
 * Pure geometry/scale helpers for the SVG charts. Kept separate from the
 * components so chart math is unit-testable without rendering.
 */

/** Map a domain value to a pixel range. A degenerate domain (min === max)
 * maps everything to the range midpoint instead of dividing by zero. */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (value: number) => number {
  const span = domainMax - domainMin;
  if (span === 0) {
    const mid = (rangeMin + rangeMax) / 2;
    return () => mid;
  }
  return (value: number) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

/** Round-numbered axis ticks covering [min, max] with a 1/2/5×10ᵏ step. */
export function niceTicks(min: number, max: number, targetCount = 4): number[] {
  if (min === max) return [min];
  const rawStep = (max - min) / Math.max(1, targetCount);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= max + step * 1e-9; tick += step) {
    // Round away float drift so labels read "170", not "170.00000000000003".
    ticks.push(Number(tick.toPrecision(12)));
  }
  return ticks;
}

/** "Typical range" band: mean ± one standard deviation, clamped to the data
 * extent so the band never exceeds what was actually observed. */
export function typicalRange(values: number[]): { min: number; max: number } | undefined {
  if (values.length < 3) return undefined;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return {
    min: Math.max(Math.min(...values), mean - std),
    max: Math.min(Math.max(...values), mean + std),
  };
}
