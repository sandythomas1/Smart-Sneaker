import { Link, useParams } from 'react-router-dom';
import { InsightCard, StatusChip } from '@smart-sneaker/design-system';
import type { InsightSet } from '@smart-sneaker/data-contracts';
import { useDemo } from '../demo-context';
import { detailForPersona, sportLabel } from '../data/derive';
import { formatDuration, formatSessionDate } from '../data/format';
import { toCardModels } from '../data/insight-presentation';
import type { DemoSessionDetail, DemoSessionSummary } from '../data/demo-artifact';
import { ErrorState, ProcessingState } from '../components/States';

function provenanceLine(detail: DemoSessionDetail): string {
  if (detail.onPhoneInsights) return 'Computed on phone · not yet verified in cloud';
  const consistency = detail.result?.consistency;
  if (!consistency) return 'Computed in cloud';
  return consistency.withinTolerance
    ? 'Computed on phone · verified in cloud'
    : 'Computed in cloud · phone result diverged';
}

function insightSetOf(detail: DemoSessionDetail): InsightSet | undefined {
  return detail.result?.insights ?? detail.onPhoneInsights;
}

export function SessionDetailView() {
  const { artifact, persona } = useDemo();
  const { sessionId } = useParams();
  const opened = sessionId ? detailForPersona(artifact, persona, sessionId) : undefined;

  if (!opened) {
    return (
      <ErrorState
        title="Session not found"
        message="This session doesn't exist or belongs to an athlete this persona can't see."
      >
        <Link to={persona.role === 'coach' ? '/coach' : '/sessions'}>Back to overview</Link>
      </ErrorState>
    );
  }

  const { summary, detail } = opened;
  return (
    <section>
      <SessionHeader summary={summary} detail={detail} />
      <SessionBody summary={summary} detail={detail} />
    </section>
  );
}

function SessionHeader(props: { summary: DemoSessionSummary; detail: DemoSessionDetail | undefined }) {
  const { summary, detail } = props;
  return (
    <header className="detail-header">
      <h2 className="view__heading">{formatSessionDate(summary.startedAtMs)}</h2>
      <div className="chip-row">
        <span className="session-card__meta">
          {sportLabel(summary.sportProfileId)} · {formatDuration(summary.durationMs)}
        </span>
        <StatusChip status={summary.status} />
        {summary.dataQualityWarning ? (
          <span className="warn-icon" role="img" aria-label="Data quality warning">
            ⚠
          </span>
        ) : null}
      </div>
      {detail ? <p className="detail-header__provenance">{provenanceLine(detail)}</p> : null}
    </header>
  );
}

function SessionBody(props: { summary: DemoSessionSummary; detail: DemoSessionDetail | undefined }) {
  const { summary, detail } = props;

  if (summary.status === 'processing' || !detail) {
    return (
      <ProcessingState
        title="Still processing"
        message="This session is queued behind the cloud worker. Insights appear as soon as processing finishes."
      />
    );
  }

  if (detail.result?.status === 'failed-validation') {
    return (
      <ErrorState
        title="This session couldn't be processed"
        message={detail.result.failureReason ?? 'The stored session data failed validation.'}
      >
        <p className="session-card__meta">
          The raw recording is kept, so it can be reprocessed once the problem is fixed. It's
          flagged for review.
        </p>
      </ErrorState>
    );
  }

  const insightSet = insightSetOf(detail);
  if (!insightSet) {
    return (
      <ErrorState
        title="No insights available"
        message="The result for this session carries no insight data."
      />
    );
  }

  return (
    <>
      {detail.result?.flaggedForReview ? (
        <p className="review-banner">
          <span aria-hidden="true">⚑ </span>
          Flagged for review: the phone's provisional result diverged from the cloud result beyond
          tolerance. The cloud numbers below are authoritative.
        </p>
      ) : null}
      <div className="insight-grid">
        {toCardModels(insightSet).map((model) => (
          <InsightCard
            key={model.key}
            kind={model.title}
            value={model.valueText}
            {...(model.unit !== undefined ? { unit: model.unit } : {})}
            confidence={model.confidence}
            reliable={model.reliable}
            {...(model.takeaway ?? model.note
              ? { takeaway: model.takeaway ?? model.note }
              : {})}
            {...(model.leftShare !== undefined ? { leftShare: model.leftShare } : {})}
          />
        ))}
      </div>
    </>
  );
}
