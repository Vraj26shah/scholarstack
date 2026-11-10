import type { ClientProblemInput } from '@ss/contracts';
import { env, isDemo } from './env';

/**
 * Quietly tells the admin's Problems log about something unexpected in this browser: a crash, a
 * page image that would not load, a blocked script. Students never see these reports, and the
 * console stays clean: nothing here prints. At most 10 different reports per page load.
 */
const sent = new Set<string>();

export function reportProblem(kind: ClientProblemInput['kind'], message: string, detail = ''): void {
  try {
    const key = `${kind}|${message}`;
    if (sent.has(key) || sent.size >= 10) return;
    sent.add(key);
    const body = JSON.stringify({
      kind,
      message: message.slice(0, 500) || kind,
      path: `${window.location.pathname}${window.location.search}`.slice(0, 300),
      detail: detail.slice(0, 2000),
    });
    const url = `${env.apiBase}/problems`;
    // sendBeacon survives page unloads and never shows up as a failed request.
    if (navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) return;
    void fetch(url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => {});
  } catch {
    // reporting must never cause a problem of its own
  }
}

/** Old tabs after a deploy ask for files that no longer exist: reload once to get the new ones. */
function reloadOnceForNewVersion(reason: string): boolean {
  try {
    const key = 'ss_reloaded_for_version';
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
    reportProblem('chunk', 'Reloaded to pick up a new version of the site', reason);
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

const isChunkError = (text: string) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    text,
  );

/** Installed once at start-up. */
export function installProblemReporting(): void {
  if (typeof window === 'undefined' || isDemo) return;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnceForNewVersion(String((event as Event & { payload?: unknown }).payload ?? '')))
      event.preventDefault();
  });
  window.addEventListener('error', (event) => {
    const message = event.message || String(event.error ?? '');
    // Errors from other sites' scripts (Razorpay, Cloudflare) arrive as "Script error." with no detail.
    if (!message || message === 'Script error.') return;
    if (isChunkError(message) && reloadOnceForNewVersion(message)) return;
    reportProblem(
      'crash',
      message,
      `${event.filename ?? ''}:${event.lineno ?? ''}\n${event.error?.stack ?? ''}`,
    );
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string; stack?: string; name?: string } | undefined;
    const message = reason?.message ?? String(event.reason ?? '');
    if (reason?.name === 'AbortError') return;
    if (isChunkError(message) && reloadOnceForNewVersion(message)) return;
    reportProblem('unhandled', message || 'Unhandled promise rejection', reason?.stack ?? '');
  });
}
