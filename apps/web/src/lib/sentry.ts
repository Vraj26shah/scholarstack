/**
 * Sentry for the site: errors, real-user monitoring and Session Replay. This file is its own
 * chunk, loaded by analytics.ts after the app starts, so the first page never waits for it and
 * it's served from our own domain (ad blockers block Sentry's CDN, not us).
 *
 * - Errors: everything uncaught, plus what error boundaries catch (they pass it on).
 * - RUM: a span for every page load and route change, with Web Vitals (LCP, INP, CLS, TTFB) and
 *   the API calls under it. Route names are grouped ("/c/:slug"), so one course page is one row.
 * - Session Replay: a share of all visits, and every visit that hits an error. All text and
 *   input is masked and all media (notes pages, images) blocked, so no notes or personal details
 *   are recorded — only the shape of the page and what was clicked.
 * - Everything goes through /api/monitoring (our tunnel), which ad blockers don't block.
 */
import * as Sentry from '@sentry/browser';

export interface SentryOptions {
  dsn: string;
  environment: string;
  release?: string;
  tunnel: string;
  tracesSampleRate: number;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
}

/** Group pages by route, so "/c/dbms-2025-cse-core" and "/c/dsa-2025-cse-core" are one row. */
export function routeName(pathname: string): string {
  const rules: [RegExp, string][] = [
    [/^\/c\/[^/]+\/?$/, '/c/:slug'],
    [/^\/b\/[^/]+\/?$/, '/b/:slug'],
    [/^\/read\/[^/]+\/?$/, '/read/:fileId'],
    [/^\/checkout\/[^/]+\/?$/, '/checkout/:orderId'],
    [/^\/help\/[^/]+\/?$/, '/help/:id'],
  ];
  for (const [re, name] of rules) if (re.test(pathname)) return name;
  return pathname.replace(/\/+$/, '') || '/';
}

export function startSentry(o: SentryOptions): typeof Sentry {
  Sentry.init({
    dsn: o.dsn,
    environment: o.environment,
    ...(o.release ? { release: o.release } : {}),
    tunnel: o.tunnel,
    integrations: [
      Sentry.browserTracingIntegration({
        beforeStartSpan: (ctx) => ({ ...ctx, name: routeName(window.location.pathname) }),
      }),
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    tracesSampleRate: o.tracesSampleRate,
    // Trace headers go to our own API only (same origin), never to Razorpay or Supabase.
    // (A string matches any URL that contains it.)
    tracePropagationTargets: [/^\/api\//, `${window.location.origin}/api/`],
    replaysSessionSampleRate: o.replaysSessionSampleRate,
    replaysOnErrorSampleRate: o.replaysOnErrorSampleRate,
    // Noise that isn't ours: browser extensions, and a harmless browser layout warning.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-(web-)?extension:\/\//],
  });
  return Sentry;
}
