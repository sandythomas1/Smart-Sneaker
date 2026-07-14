import { linearScale, niceTicks } from './chart-math';

/**
 * Accessible single-series SVG line chart for demo-scale data (tens of
 * points). Hard accessibility rules baked in: visible axis labels with units,
 * and unreliable points encoded by shape (hollow) — never by color alone.
 */

export interface LineChartPoint {
  x: number;
  y: number;
  /** Unreliable points render hollow and are named in the aria description. */
  reliable?: boolean;
}

export interface LineChartProps {
  points: LineChartPoint[];
  /** Unit label rendered on the y-axis, e.g. "steps/min". */
  unit?: string;
  /** Accessible one-line description of what the chart shows. */
  ariaLabel: string;
  /** Formats an x value (epoch ms in the demo) into a short tick label. */
  formatX: (x: number) => string;
  /** Optional "typical range" band behind the line. */
  band?: { min: number; max: number };
}

const WIDTH = 360;
const HEIGHT = 180;
const PAD = { left: 46, right: 16, top: 14, bottom: 26 };

export function LineChart(props: LineChartProps) {
  const { points } = props;
  if (points.length === 0) return null;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const yLow = Math.min(...ys, props.band?.min ?? Infinity);
  const yHigh = Math.max(...ys, props.band?.max ?? -Infinity);
  const yPadding = (yHigh - yLow || Math.abs(yHigh) || 1) * 0.15;

  const xScale = linearScale(Math.min(...xs), Math.max(...xs), PAD.left, WIDTH - PAD.right);
  const yScale = linearScale(yLow - yPadding, yHigh + yPadding, HEIGHT - PAD.bottom, PAD.top);
  const ticks = niceTicks(yLow, yHigh, 3);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.x).toFixed(1)},${yScale(p.y).toFixed(1)}`)
    .join(' ');
  const latest = points[points.length - 1]!;

  return (
    <svg
      className="ss-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={props.ariaLabel}
    >
      {props.band ? (
        <rect
          className="ss-chart__band"
          x={PAD.left}
          width={WIDTH - PAD.left - PAD.right}
          y={yScale(props.band.max)}
          height={Math.max(0, yScale(props.band.min) - yScale(props.band.max))}
        />
      ) : null}
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            className="ss-chart__grid"
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={yScale(tick)}
            y2={yScale(tick)}
          />
          <text className="ss-chart__tick" x={PAD.left - 6} y={yScale(tick) + 3} textAnchor="end">
            {tick}
          </text>
        </g>
      ))}
      {props.unit ? (
        <text className="ss-chart__tick" x={PAD.left - 6} y={PAD.top - 2} textAnchor="end">
          {props.unit}
        </text>
      ) : null}
      <text className="ss-chart__tick" x={PAD.left} y={HEIGHT - 8}>
        {props.formatX(points[0]!.x)}
      </text>
      <text className="ss-chart__tick" x={WIDTH - PAD.right} y={HEIGHT - 8} textAnchor="end">
        {props.formatX(latest.x)}
      </text>
      <path className="ss-chart__line" d={path} />
      {points.map((p, i) => {
        const isLatest = i === points.length - 1;
        const unreliable = p.reliable === false;
        return (
          <circle
            key={`${p.x}-${i}`}
            className={[
              'ss-chart__point',
              unreliable ? 'ss-chart__point--unreliable' : '',
              isLatest ? 'ss-chart__point--latest' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            cx={xScale(p.x)}
            cy={yScale(p.y)}
            r={isLatest ? 5 : unreliable ? 3.5 : 3}
          />
        );
      })}
      <text
        className="ss-chart__value"
        x={Math.min(xScale(latest.x), WIDTH - PAD.right - 4)}
        y={Math.max(yScale(latest.y) - 10, 10)}
        textAnchor="end"
      >
        {latest.y}
        {props.unit ? ` ${props.unit}` : ''}
      </text>
    </svg>
  );
}
