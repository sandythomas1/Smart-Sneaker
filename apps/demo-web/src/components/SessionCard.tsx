import { Link } from 'react-router-dom';
import { StatusChip } from '@smart-sneaker/design-system';
import type { DemoSessionSummary } from '../data/demo-artifact';
import { sportLabel } from '../data/derive';
import { formatDuration, formatSessionDate } from '../data/format';

export function SessionCard(props: { session: DemoSessionSummary }) {
  const { session } = props;
  return (
    <li>
      <Link className="session-card" to={`/sessions/${session.sessionId}`}>
        <div>
          <div className="session-card__when">{formatSessionDate(session.startedAtMs)}</div>
          <div className="session-card__meta">
            {sportLabel(session.sportProfileId)} · {formatDuration(session.durationMs)}
          </div>
        </div>
        <span className="session-card__spacer" />
        <span className="chip-row">
          {session.failed ? (
            <span className="ss-chip ss-chip--bad">
              <span aria-hidden="true">✗</span>
              Failed
            </span>
          ) : (
            <StatusChip status={session.status} />
          )}
          {session.flaggedForReview && !session.failed ? (
            <span className="ss-chip ss-chip--warn">
              <span aria-hidden="true">⚑</span>
              Needs review
            </span>
          ) : null}
          {session.dataQualityWarning ? (
            <span className="warn-icon" role="img" aria-label="Data quality warning">
              ⚠
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
