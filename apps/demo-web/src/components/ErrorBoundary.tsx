import { Component, type ReactNode } from 'react';
import { ErrorState } from './States';

interface ErrorBoundaryState {
  failed: boolean;
}

/** Last line of defense: render the designed error state, never a blank page
 * or a raw stack (consumer-facing bar). */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[demo] render failed:', error);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="shell__main">
          <ErrorState
            title="Something broke in the demo"
            message="The console has the details. Reload to start over — seeded data is regenerated on every run."
          />
        </main>
      );
    }
    return this.props.children;
  }
}
