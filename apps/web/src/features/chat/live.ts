import { useEffect, useRef, useState } from 'react';
import { authGateway } from '../../lib/auth';

/**
 * Listens on a live channel the API handed out (Supabase Realtime). The server only says "this
 * changed"; `onChange` then refetches through the normal signed-in API. Returns whether the channel
 * is connected, so callers can poll slowly when it is and quickly when it isn't (demo, offline).
 */
export function useLive(topic: string | undefined, onChange: () => void): boolean {
  const [ready, setReady] = useState(false);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!topic || !authGateway.listen) {
      setReady(false);
      return;
    }
    return authGateway.listen(
      topic,
      () => latest.current(),
      (ok) => setReady(ok),
    );
  }, [topic]);
  return ready;
}

/**
 * The service worker got a notification for this account (held back because this page is open, or
 * shown): refetch at once, so the page never waits for its next poll to show it.
 */
export function usePushWhileOpen(onPush: (tag: string) => void) {
  const latest = useRef(onPush);
  latest.current = onPush;
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      if (e.data?.type === 'push' || e.data?.type === 'shown') latest.current(String(e.data.tag ?? ''));
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, []);
}

/**
 * A tapped notification, while a tab of the site is already open: the service worker asks this
 * app to go to the notification's page (a client-side move, so nothing half-typed elsewhere in the
 * app is lost) and waits for the reply; without one it navigates the tab itself.
 */
export function useNotificationOpener(go: (path: string) => void) {
  const latest = useRef(go);
  latest.current = go;
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      if (e.data?.type !== 'open' || typeof e.data.url !== 'string') return;
      const url = e.data.url as string;
      if (!url.startsWith('/') || url.startsWith('//')) return;
      latest.current(url);
      e.ports?.[0]?.postMessage('ok');
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, []);
}
