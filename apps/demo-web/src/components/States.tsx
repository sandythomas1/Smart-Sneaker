import type { ReactNode } from 'react';

/** Designed empty/error/processing states (Req. 7d) — never a blank screen. */

export function EmptyState(props: { icon?: string; title: string; message: string }) {
  return (
    <div className="state" role="status">
      <span className="state__icon" aria-hidden="true">
        {props.icon ?? '👟'}
      </span>
      <h2 className="state__title">{props.title}</h2>
      <p className="state__message">{props.message}</p>
    </div>
  );
}

export function ErrorState(props: { title: string; message: string; children?: ReactNode }) {
  return (
    <div className="state state--error" role="alert">
      <span className="state__icon" aria-hidden="true">
        ⚠
      </span>
      <h2 className="state__title">{props.title}</h2>
      <p className="state__message">{props.message}</p>
      {props.children}
    </div>
  );
}

export function ProcessingState(props: { title: string; message: string }) {
  return (
    <div className="state" role="status">
      <span className="state__icon" aria-hidden="true">
        ↻
      </span>
      <h2 className="state__title">{props.title}</h2>
      <p className="state__message">{props.message}</p>
    </div>
  );
}
