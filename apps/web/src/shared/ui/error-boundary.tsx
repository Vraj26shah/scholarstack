import { Component, type ReactNode } from 'react';
import { reportProblem } from '../../lib/problems';

/** A new version went live while this tab was open: its old page files are gone. */
const isStaleBuild = (e: Error) =>
  /dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically/i.test(
    e.message,
  );

/**
 * If a page fails while drawing, show a calm page instead of a blank screen. The real error goes
 * to Admin → Problems; the student only sees what to do next.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    if (isStaleBuild(error)) {
      // Reload once to pick up the new version; the flag stops a reload loop.
      try {
        if (!sessionStorage.getItem('reloaded-for-update')) {
          sessionStorage.setItem('reloaded-for-update', '1');
          window.location.reload();
          return;
        }
      } catch {
        // storage blocked: fall through to the message
      }
      reportProblem('chunk', error.message);
      return;
    }
    reportProblem('crash', error.message, (info.componentStack ?? '').slice(0, 1500));
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const stale = isStaleBuild(this.state.error);
    return (
      <main id="main" className="mx-auto max-w-[720px] px-5 py-24 flex flex-col items-start gap-5">
        <p className="m-0 font-mono text-xs tracking-[0.14em] text-ink2">
          {stale ? 'A NEW VERSION IS OUT' : 'THIS PAGE TRIPPED'}
        </p>
        <h1 className="m-0 font-display font-extrabold text-[clamp(36px,6vw,64px)] leading-[0.95] tracking-[-0.05em]">
          {stale ? 'Refresh to get the latest.' : 'Something went wrong on this page.'}
        </h1>
        <p className="m-0 text-lg leading-relaxed text-ink2">
          {stale
            ? 'The site was updated while this tab was open.'
            : 'Nothing is lost: your shelf and reading progress are safe. We have been told about it.'}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-12 px-6 rounded-full bg-brand text-white font-semibold"
          >
            Refresh the page
          </button>
          <a
            href="/"
            className="h-12 px-6 rounded-full border border-line inline-flex items-center font-semibold text-ink no-underline"
          >
            Back to the catalogue
          </a>
        </div>
      </main>
    );
  }
}
