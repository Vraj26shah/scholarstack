/**
 * Google Analytics (GA4, via the Google tag) and Sentry. Nothing loads unless VITE_GA_ID /
 * VITE_SENTRY_DSN were set at build time, so demo and local builds stay clean.
 *
 * Sentry (see sentry.ts) is bundled with the site as its own chunk and loaded right after start,
 * so it's served from our domain and reports through /api/monitoring: ad blockers that block
 * Sentry's own domains don't hide our errors and page speed. Until it has loaded, errors and the
 * signed-in student are queued here and sent the moment it's ready.
 *
 * GA events (besides the automatic page_view on every route change):
 *   login          a sign-in completed
 *   view_item      a course page opened (id, name, price)
 *   peek_open      a free page opened in "Peek inside" (which format)
 *   begin_checkout the buy button pressed, payment window opening
 *   purchase       payment verified (order id and amount)
 *   read_open      a bought file opened in the reader
 */
import { env } from './env';

type Params = Record<string, string | number | boolean | undefined>;
type SentryApi = typeof import('@sentry/browser');
export interface MonitoringUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}

/** The loaded SDK, or null while it loads (or when Sentry is off). */
let sentry: SentryApi | null = null;
/** Errors from before the SDK loaded (kept to a few, so a crash loop can't pile them up). */
const early: unknown[] = [];
/** The latest signed-in student (undefined: not known yet; null: signed out). */
let user: MonitoringUser | null | undefined;

const applyUser = (s: SentryApi) => {
  if (user === undefined) return;
  s.setUser(user ? { id: user.id, email: user.email } : null);
  s.setTag('role', user ? (user.isAdmin ? 'admin' : 'student') : 'visitor');
};

/** Release tag: the commit being deployed (set by CI), so errors line up with deploys. */
const release = (import.meta.env.VITE_APP_RELEASE as string | undefined) || undefined;

function loadSentry(): void {
  import('./sentry')
    .then(({ startSentry }) => {
      sentry = startSentry({
        dsn: env.sentryDsn,
        environment: import.meta.env.DEV ? 'development' : env.mode === 'demo' ? 'demo' : 'production',
        release,
        tunnel: `${env.apiBase.replace(/\/+$/, '')}/monitoring`,
        // Every visit's speed (the site is small enough); lower this if the span quota runs short.
        tracesSampleRate: 1,
        // Replays: 1 in 10 visits, and every visit that hits an error.
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1,
      });
      applyUser(sentry);
      for (const e of early.splice(0)) sentry.captureException(e);
    })
    .catch(() => {
      // The chunk couldn't load (offline, an old tab after a deploy): the site works without it.
    });
}

let gaReady = false;

/** Called once from main.tsx, before the app renders. */
export function initAnalytics(): void {
  if (env.sentryDsn) loadSentry();

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
  if (!env.sentryDsn) return;
  if (sentry) sentry.captureException(e);
  else if (early.length < 10) early.push(e);
}

/**
 * Who is using the site, for Sentry: errors, slow pages and replays show the student's account
 * and email (or "visitor"). Called whenever the session changes; null on sign-out.
 */
export function setMonitoringUser(next: MonitoringUser | null): void {
  user = next;
  if (sentry) applyUser(sentry);
}
