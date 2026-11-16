import { Component, type ReactNode } from 'react';
import { captureException } from '../../lib/analytics';
import { reportProblem } from '../../lib/problems';
import { Button } from '../../shared/ui/button';

/**
 * One admin section that fails while drawing stays inside its own box: the tabs, the header and
 * every other section keep working, and the admin can try that section again. The error goes to
 * Admin › Problems (and Sentry) like any other crash.
 */
export class PanelBoundary extends Component<
  { children: ReactNode; resetKey: string; label: string },
  { error: Error | null; attempt: number }
> {
  override state = { error: null as Error | null, attempt: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    try {
      captureException(error);
      reportProblem(
        'crash',
        `Admin › ${this.props.label}: ${error.message}`,
        (info.componentStack ?? '').slice(0, 1500),
      );
    } catch {
      // Reporting must never be the thing that breaks the page.
    }
  }

  override componentDidUpdate(prev: { resetKey: string }) {
    // Moving to another section clears the problem.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error)
      // A new key on "Try again" draws the section from scratch.
      return <div key={this.state.attempt}>{this.props.children}</div>;
    return (
      <div
        role="alert"
        className="rounded-2xl border-2 border-dashed border-line p-8 flex flex-col items-start gap-3"
      >
        <p className="m-0 font-mono text-xs tracking-[0.14em] text-ink2">THIS SECTION TRIPPED</p>
        <p className="m-0 font-display font-extrabold text-2xl tracking-[-0.03em]">
          {this.props.label} couldn't be shown just now.
        </p>
        <p className="m-0 text-ink2 max-w-xl">
          Nothing was changed or lost, and the rest of Admin still works: pick another tab above, or try this
          one again. The details went to Storage › Problems.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
            Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      </div>
    );
  }
}
