import { Component, type ReactNode } from 'react';
import { captureException, signal } from '../../lib/analytics';
import { reportProblem } from '../../lib/problems';
import { BackInner, backClass } from './back-link';
import { Eyebrow, PageTitle } from './page-title';

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
    // React swallows render errors from the window, so Sentry only hears about them from here.
    captureException(error);
    signal('stuck_crash');
    reportProblem('crash', error.message, (info.componentStack ?? '').slice(0, 1500));
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const stale = isStaleBuild(this.state.error);
    return (
      <main id="main" className="mx-auto max-w-[1100px] px-5 sm:px-9 pt-16 sm:pt-24 pb-16">
        <div className="max-w-[640px] flex flex-col items-start gap-5">
          <Eyebrow>{stale ? 'A new version is out' : 'This page tripped'}</Eyebrow>
          <PageTitle size="state">
            {stale ? 'Refresh to get the latest.' : 'Something went wrong on this page.'}
          </PageTitle>
          <p className="m-0 text-lg leading-relaxed text-ink2">
            {stale
              ? 'The site was updated while this tab was open.'
              : 'Nothing is lost: your shelf and reading progress are safe. We have been told about it.'}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-11 px-5 rounded-full bg-brand text-white text-[15px] font-semibold cursor-pointer press hover:brightness-110"
            >
              Refresh the page
            </button>
            {/* A full load, not a router link: the router may be what broke. */}
            <a href="/" className={backClass('lg')}>
              <BackInner size="lg">Back to catalogue</BackInner>
            </a>
          </div>
        </div>
      </main>
    );
  }
}
