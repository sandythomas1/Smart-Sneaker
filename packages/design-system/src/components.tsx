import type { ReactNode } from 'react';
import { describeConfidence } from './confidence';

/* Core presentational components. Styling lives in tokens.css (import it once
 * in the app); components emit `ss-*` classes only. */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button(props: {
  variant?: ButtonVariant;
  onClick?: () => void;
  children: ReactNode;
}) {
  const variant = props.variant ?? 'primary';
  return (
    <button type="button" className={`ss-btn ss-btn--${variant}`} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

export type SessionStatus = 'synced' | 'processing' | 'on-phone-only' | 'data-quality';

const SESSION_STATUS_CHIP: Record<SessionStatus, { tone: string; icon: string; label: string }> = {
  synced: { tone: 'good', icon: '✓', label: 'Synced' },
  processing: { tone: 'info', icon: '↻', label: 'Processing…' },
  'on-phone-only': { tone: 'warn', icon: '⌁', label: 'On phone only' },
  'data-quality': { tone: 'warn', icon: '⚠', label: 'Data quality' },
};

export function StatusChip(props: { status: SessionStatus }) {
  const chip = SESSION_STATUS_CHIP[props.status];
  return (
    <span className={`ss-chip ss-chip--${chip.tone}`}>
      <span aria-hidden="true">{chip.icon}</span>
      {chip.label}
    </span>
  );
}

export function ConfidenceBadge(props: { confidence: number; reliable: boolean }) {
  const display = describeConfidence(props.confidence, props.reliable);
  const tone = display.level === 'high' ? 'good' : display.level === 'medium' ? 'info' : display.level === 'low' ? 'warn' : 'bad';
  return (
    <span className={`ss-chip ss-chip--${tone}`}>
      <span aria-hidden="true">{display.icon}</span>
      {display.label}
    </span>
  );
}

export function InsightCard(props: {
  kind: string;
  value: string;
  unit?: string;
  confidence: number;
  reliable: boolean;
  takeaway?: string;
  /** Left share 0–1 — renders the L/R split bar (labels carry identity). */
  leftShare?: number;
}) {
  const unreliable = !props.reliable;
  return (
    <section className={`ss-card${unreliable ? ' ss-card--unreliable' : ''}`}>
      <h3 className="ss-card__kind">{props.kind}</h3>
      <p className="ss-card__value">
        {props.value}
        {props.unit ? <span className="ss-card__unit"> {props.unit}</span> : null}
      </p>
      {props.leftShare !== undefined ? (
        <>
          <div className="ss-split" role="img" aria-label={`Left ${Math.round(props.leftShare * 100)}%, right ${Math.round((1 - props.leftShare) * 100)}%`}>
            <div className="ss-split__left" style={{ width: `${props.leftShare * 100}%` }} />
            <div className="ss-split__right" style={{ flex: 1 }} />
          </div>
          <div className="ss-split-labels">
            <span>L {Math.round(props.leftShare * 100)}%</span>
            <span>R {Math.round((1 - props.leftShare) * 100)}%</span>
          </div>
        </>
      ) : null}
      <ConfidenceBadge confidence={props.confidence} reliable={props.reliable} />
      {props.takeaway ? <p className="ss-card__takeaway">{props.takeaway}</p> : null}
    </section>
  );
}

export function DemoBadge() {
  return <span className="ss-demo-badge">DEMO</span>;
}
