import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LineChart, typicalRange } from '@smart-sneaker/design-system';
import { useDemo } from '../demo-context';
import { trendsForAthlete } from '../data/derive';
import { driftSummary, metricOptions } from '../data/trends-view';
import { EmptyState } from '../components/States';

const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function TrendsView() {
  const { artifact, persona } = useDemo();
  const options = useMemo(
    () => metricOptions(trendsForAthlete(artifact, persona.id)),
    [artifact, persona.id],
  );
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);

  if (persona.role === 'coach') return <Navigate to="/coach" replace />;

  if (options.length === 0) {
    return (
      <section>
        <h2 className="view__heading">Trends</h2>
        <EmptyState
          title="No trends yet"
          message="Trends need a few processed sessions. Record some runs and come back."
        />
      </section>
    );
  }

  const selected = options.find((o) => o.key === selectedKey) ?? options[0]!;
  const values = selected.series.points.map((p) => p.value);
  const band = typicalRange(values);
  const unreliableCount = selected.series.points.filter((p) => !p.reliable).length;
  const drift = driftSummary(selected.series);

  return (
    <section>
      <h2 className="view__heading">Trends</h2>
      <div className="metric-toggle" role="group" aria-label="Metric">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.key === selected.key}
            onClick={() => setSelectedKey(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="trend-card">
        <LineChart
          points={selected.series.points.map((p) => ({
            x: p.atMs,
            y: p.value,
            reliable: p.reliable,
          }))}
          {...(selected.series.unit !== undefined ? { unit: selected.series.unit } : {})}
          {...(band !== undefined ? { band } : {})}
          ariaLabel={`${selected.label} across ${selected.series.points.length} sessions`}
          formatX={(x) => SHORT_DATE.format(new Date(x))}
        />
        <p className="trend-legend">
          Latest point highlighted · shaded band = typical range
          {unreliableCount > 0 ? ' · hollow points = unreliable sessions' : ''}
        </p>
      </div>
      {drift ? <p className="callout">{drift}</p> : null}
    </section>
  );
}
