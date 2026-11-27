import { deviceLabel } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { captureException } from '../../lib/analytics';
import { ApiError, api, friendly } from '../../lib/api';
import {
  PermissionRefused,
  type PushSupport,
  PushUnavailable,
  browserSubscription,
  pushSupport,
  subscribeBrowser,
} from '../reminders/push-client';

const KEY = 'ss_account_alerts';

/**
 * Notifications for the signed-in account on this device: new orders and chat messages for a
 * restaurant owner, replies and order updates for a student. One tap turns them on.
 */
export function useAccountAlerts() {
  const status = useQuery({ queryKey: ['push-status'], queryFn: api.pushStatus, staleTime: 300_000 });
  const [support, setSupport] = useState<PushSupport>('unsupported');
  const [on, setOn] = useState(false);
  // False until this phone's subscription has been looked at: "off" before that means "not known yet".
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSupport(pushSupport());
    void browserSubscription()
      .then((sub) => setOn(!!sub && localStorage.getItem(KEY) === sub.endpoint))
      .catch(() => setOn(false))
      .finally(() => setChecked(true));
  }, []);

  const enable = useCallback(async () => {
    if (!status.data?.configured) {
      setError("Notifications aren't set up on the server yet.");
      return;
    }
    setBusy(true);
    setError('');
    try {
      const sub = await subscribeBrowser(status.data.publicKey);
      await api.pushAccount({ ...sub, label: deviceLabel(navigator.userAgent) });
      localStorage.setItem(KEY, sub.endpoint);
      setOn(true);
    } catch (e) {
      if (e instanceof PermissionRefused) {
        setSupport(pushSupport());
        setError(
          e.permission === 'denied'
            ? 'Notifications are blocked for this site. Allow them in the browser settings.'
            : 'Tap "Allow" when the browser asks.',
        );
      } else {
        // Anything from the browser (not our server) gets its real reason, and is reported.
        const shown =
          e instanceof ApiError ? null : e instanceof PushUnavailable ? e : new PushUnavailable(e);
        if (shown) captureException(shown.reason);
        setError(shown ? shown.message : friendly(e));
      }
    } finally {
      setBusy(false);
    }
  }, [status.data]);

  return { support, on, checked, busy, error, enable, configured: !!status.data?.configured };
}
