import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render(
        el: HTMLElement,
        options: {
          sitekey: string;
          callback(token: string): void;
          'error-callback'(): void;
          'expired-callback'(): void;
          appearance?: string;
        },
      ): string;
      remove(id: string): void;
      reset(id: string): void;
    };
  }
}

/** Cloudflare Turnstile managed bot check. Renders nothing when no site key is set. */
export function Turnstile({
  siteKey,
  onToken,
  onError,
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onError: () => void;
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
          'error-callback': onError,
          'expired-callback': onError,
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
      s.onerror = onError;
      document.head.appendChild(s);
    }
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, onToken, onError]);
  return siteKey ? <div ref={ref} /> : null;
}
