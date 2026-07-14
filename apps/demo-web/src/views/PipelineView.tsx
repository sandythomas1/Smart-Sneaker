import { Fragment } from 'react';
import { useDemo } from '../demo-context';
import type { DemoPipelineScenario, DemoPipelineStage } from '../data/demo-artifact';

/**
 * "Behind the curtain" (Req. 12): the event-driven pipeline that produced
 * every number in this demo, stage by stage, plus the scenario expectations
 * the generation run verified. This screen is the demo's visible test of the
 * software solution.
 */

const STAGE_GLYPHS: Record<DemoPipelineStage['status'], { icon: string; label: string }> = {
  pass: { icon: '✓', label: 'passing' },
  fail: { icon: '✗', label: 'failing' },
  running: { icon: '↻', label: 'running' },
};

function ScenarioRow(props: { scenario: DemoPipelineScenario }) {
  const { scenario } = props;
  const glyph = STAGE_GLYPHS[scenario.status];
  return (
    <li className={`scenario${scenario.status === 'fail' ? ' scenario--fail' : ''}`}>
      <span className={`ss-chip ss-chip--${scenario.status === 'pass' ? 'good' : 'bad'}`}>
        <span aria-hidden="true">{glyph.icon}</span>
        {glyph.label}
      </span>
      <span className="scenario__slug">{scenario.slug}</span>
      {scenario.detail ? <span className="session-card__meta">{scenario.detail}</span> : null}
      <span className="scenario__description">{scenario.description}</span>
    </li>
  );
}

export function PipelineView() {
  const { artifact } = useDemo();
  const { stages, scenarios } = artifact.pipeline;

  return (
    <section>
      <h2 className="view__heading">Pipeline</h2>
      <p className="view__subheading">
        Every insight in this demo came out of this run of the real software pipeline over the
        seed corpus — no hand-written numbers.
      </p>
      <div className="stage-flow" role="list" aria-label="Pipeline stages">
        {stages.map((stage, index) => {
          const glyph = STAGE_GLYPHS[stage.status];
          return (
            <Fragment key={stage.id}>
              {index > 0 ? (
                <span className="stage-flow__arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
              <div role="listitem" className={`stage-card stage-card--${stage.status}`}>
                <span className={`ss-chip ss-chip--${stage.status === 'pass' ? 'good' : stage.status === 'fail' ? 'bad' : 'info'}`}>
                  <span aria-hidden="true">{glyph.icon}</span>
                  {glyph.label}
                </span>
                <span className="stage-card__label">{stage.label}</span>
                <span className="stage-card__detail">{stage.detail}</span>
              </div>
            </Fragment>
          );
        })}
      </div>
      <h3 className="view__heading" style={{ fontSize: 'var(--ss-text-lg)' }}>
        Scenarios
      </h3>
      <ul className="scenario-list">
        {scenarios.map((scenario) => (
          <ScenarioRow key={scenario.slug} scenario={scenario} />
        ))}
      </ul>
    </section>
  );
}
