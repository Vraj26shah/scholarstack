import { useEffect } from 'react';
import { api } from './api';

/**
 * The server skips a notification while its person has the screen open (their page's refresh says
 * so). When the screen is hidden (another app, tab in the background) or closed, this tells the
 * server right away, so the next update rings their phone instead of waiting for the mark to fade.
 */
export function useLeaveWhenHidden(scopes: (string | false | null | undefined)[]) {
  const key = scopes.filter(Boolean).join(',');
  useEffect(() => {
    if (!key) return;
    const list = key.split(',');
    const leave = () => void api.presenceLeave(list).catch(() => {});
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leave);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [key]);
}
