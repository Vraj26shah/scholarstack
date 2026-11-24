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

/** The service worker says a notification was held back because this page is open: refetch. */
export function usePushWhileOpen(onPush: (tag: string) => void) {
  const latest = useRef(onPush);
  latest.current = onPush;
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      if (e.data?.type === 'push') latest.current(String(e.data.tag ?? ''));
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, []);
}
