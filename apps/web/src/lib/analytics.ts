/**
 * Google Analytics (GA4, via the Google tag) and Sentry, both from their CDNs. Nothing loads
 * unless VITE_GA_ID / VITE_SENTRY_DSN were set at build time, so demo and local builds stay
 * clean and the site's own bundle carries none of it (the security headers list the CDNs).
 *
 * Sentry loads the tracing bundle, so besides errors it also records real-user monitoring:
 * page loads, SPA route changes, and Web Vitals (LCP, FID/INP, CLS) for every visitor.
 *
 * Events (besides the automatic page_view on every route change):
 *   login          a sign-in completed
 *   view_item      a course page opened (id, name, price)
 *   peek_open      a free page opened in "Peek inside" (which format)
 *   begin_checkout the buy button pressed, payment window opening
 *   purchase       payment verified (order id and amount)
 *   read_open      a bought file opened in the reader
 */
import { env } from './env';

type Params = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
    Sentry?: {
      init: (options: {
        dsn: string;
        environment: string;
        tracesSampleRate: number;
      }) => void;
      captureException: (e: unknown) => void;
      /** Present (and truthy) once init has bound a client — errors sent before are dropped. */
      getClient: () => unknown;
    };
  }
}

let gaReady = false;

/** Called once from main.tsx, before the app renders. */
export function initAnalytics(): void {
  if (env.sentryDsn) {
    const s = document.createElement('script');
    s.src = 'https://browser.sentry-cdn.com/7.120.0/bundle.tracing.min.js';
    s.crossOrigin = 'anonymous';
    s.addEventListener('load', () =>
      window.Sentry?.init({ dsn: env.sentryDsn, environment: env.mode, tracesSampleRate: 1 }),
    );
    document.head.appendChild(s);
  }

  const id = env.gaId;
  if (!id) return;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer ?? [];
  const gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  window.gtag = gtag;
  gtag('js', new Date());
  // Page views are sent by <PageViews> on each route change, not by the tag on load.
  gtag('config', id, { send_page_view: false, anonymize_ip: true });
  gaReady = true;
}

/** An event for GA4. No-op when analytics is off, so call sites never need to check. */
export function track(name: string, params: Params = {}): void {
  if (gaReady) window.gtag?.('event', name, params);
}

/** One page_view per route the student actually lands on (the app is a SPA). */
export function trackPageView(path: string): void {
  if (!gaReady) return;
  window.gtag?.('event', 'page_view', { page_path: path, page_title: document.title });
}

/** An error React caught (error boundaries swallow it from the window, so Sentry never sees it). */
export function captureException(e: unknown): void {
  // The SDK loads async from its CDN, so a crash in the first moments after page load can beat
  // it. Retry for a few seconds rather than lose it; a page with analytics off never retries.
  const ready = () => typeof window.Sentry?.getClient === 'function' && !!window.Sentry.getClient();
  let tries = 0;
  const send = () => window.Sentry!.captureException(e);
  if (ready()) {
    send();
    return;
  }
  const t = window.setInterval(() => {
    if (ready()) {
      window.clearInterval(t);
      send();
    } else if (++tries > 20) window.clearInterval(t);
  }, 500);
}
