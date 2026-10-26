import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render(
        el: HTMLElement,
        options: {
          sitekey: string;
          callback(token: string): void;
          'error-callback'(code?: string): boolean | undefined;
          'expired-callback'(): void;
          appearance?: string;
          'refresh-expired'?: 'auto' | 'manual' | 'never';
          retry?: 'auto' | 'never';
        },
      ): string;
      remove(id: string): void;
      reset(id: string): void;
    };
  }
}

/** Why the check failed, in words a student (or the admin setting it up) can act on. */
export function turnstileProblem(code?: string, isAdmin?: boolean): string {
  const c = code ?? '';
  const admin =
    isAdmin ??
    (typeof window !== 'undefined' &&
      (window.location?.pathname.startsWith('/admin') || window.location?.search.includes('admin=1')));

  // Configuration errors (site key, domain)
  if (/^1101(00|10)/.test(c) || c === '400020') {
    if (admin) {
      return 'The security check is not set up correctly (wrong site key). Check Cloudflare Turnstile configuration.';
    }
    return "We're having technical issues with the security check. Please contact support.";
  }

  if (c.startsWith('110200')) {
    if (admin) {
      return 'This web address is not allowed in the Turnstile widget. Add it to the allowed domains list.';
    }
    return "We're having technical issues with the security check. Please contact support.";
  }

  // User verification failed (can retry)
  if (c.startsWith('300') || c.startsWith('600')) {
    return "We couldn't verify you're human. Please refresh the page and try again, or try a different browser.";
  }

  // Script loading failed (ad blockers, network issues)
  return 'The security check could not load. Please disable ad or tracker blockers for this site, then refresh the page.';
}

/**
 * Cloudflare Turnstile managed bot check. Renders nothing when no site key is set. An expired
 * token refreshes itself quietly; only a real failure is reported, with Turnstile's error code.
 */
export function Turnstile({
  siteKey,
  onToken,
  onExpired,
  onError,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onExpired: () => void;
  onError: (code?: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const mount = () => {
      if (ref.current && window.turnstile && !widgetId.current) {
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: onToken,
          'error-callback': (code) => {
            onError(code);
            return true; // handled: don't also throw in the console
          },
          'expired-callback': onExpired,
          'refresh-expired': 'auto',
          retry: 'auto',
          appearance: 'always',
        });
      }
    };
    if (window.turnstile) mount();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.onload = mount;
      s.onerror = () => onError('script');
      document.head.appendChild(s);
    }
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, onToken, onExpired, onError]);
  return siteKey ? <div ref={ref} /> : null;
}
