import { ReminderPrefs, deviceLabel } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { ApiError, api } from '../../lib/api';
import type { Course } from '../tools/timetable/domain';
import {
  PermissionRefused,
  type PushSupport,
  browserSubscription,
  pushSupport,
  subscribeBrowser,
  unsubscribeBrowser,
  waitForShown,
} from './push-client';
import {
  type LocalReminders,
  getLocalReminders,
  serverPrefs,
  setLocalReminders,
  useLocalReminders,
} from './settings-store';

const WEEK = 7 * 24 * 3600 * 1000;

/** What a device that keeps order alerts but wants no reminders asks for. */
const NO_REMINDERS = ReminderPrefs.parse({
  mess: { slug: null, meals: [], favourites: [] },
  classes: { nightly: false, before: false },
});

/** Taps in quick succession are sent to the server once, when they settle. */
let saveTimer: number | undefined;

export type ReminderState =
  /** Not for this visitor yet (students before launch), or the server has no push keys. */
  'hidden' | 'unconfigured' | PushSupport | 'on';

const message = (e: unknown) =>
  e instanceof ApiError ? e.message : "That didn't work. Check your connection and try again.";

/** Everything a screen needs to offer, turn on, change and turn off reminders on this device. */
export function useReminders() {
  const local = useLocalReminders();
  const status = useQuery({ queryKey: ['push-status'], queryFn: api.pushStatus, staleTime: 5 * 60_000 });
  const [support, setSupport] = useState<PushSupport>(() => pushSupport());
  const [busy, setBusy] = useState<null | 'on' | 'save' | 'test' | 'off'>(null);
  const [error, setError] = useState<string | null>(null);

  // The browser may have dropped the subscription (site data cleared, permission reset).
  useEffect(() => {
    if (!local.endpoint) return;
    void browserSubscription().then((sub) => {
      if (!sub || sub.endpoint !== local.endpoint) setLocalReminders((r) => ({ ...r, endpoint: null }));
    });
  }, [local.endpoint]);

  const state: ReminderState = !status.data?.open
    ? 'hidden'
    : !status.data.configured
      ? 'unconfigured'
      : local.endpoint
        ? 'on'
        : support;

  const run = useCallback(async <T>(kind: NonNullable<typeof busy>, fn: () => Promise<T>) => {
    setBusy(kind);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof PermissionRefused) {
        setSupport(pushSupport());
        setError(
          e.permission === 'denied'
            ? null // the "blocked" card explains what to do
            : 'No problem. Tap "Turn on" again whenever you want them.',
        );
      } else setError(message(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  /** "Turn on": the browser's own prompt, then this device is saved with these choices. */
  const turnOn = (patch: (r: LocalReminders) => LocalReminders = (r) => r) =>
    run('on', async () => {
      const key = status.data?.publicKey;
      if (!key) throw new Error('no key');
      const sub = await subscribeBrowser(key);
      const next = { ...patch(local), endpoint: sub.endpoint, snoozedUntil: null };
      await api.pushSubscribe({ ...sub, prefs: serverPrefs(next), label: deviceLabel(navigator.userAgent) });
      setLocalReminders(next);
      track('reminders_on', {});
      return true;
    });

  const save = (next: LocalReminders) =>
    run('save', async () => {
      if (next.endpoint) await api.pushPrefs(next.endpoint, serverPrefs(next));
      setLocalReminders(next);
      return true;
    });

  /**
   * Change a setting from a tap: shown at once, sent to the server a moment later (one request for
   * several quick taps). `saved` turns true once the server has it.
   */
  const [saved, setSaved] = useState(false);
  const update = (patch: (r: LocalReminders) => LocalReminders) => {
    setLocalReminders(patch);
    setSaved(false);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const cur = getLocalReminders();
      if (!cur.endpoint) return;
      void run('save', async () => {
        await api.pushPrefs(cur.endpoint!, serverPrefs(cur));
        return true;
      }).then((ok) => setSaved(!!ok));
    }, 700);
  };

  /** After "Send a test": did it reach this screen? */
  const [testResult, setTestResult] = useState<null | 'waiting' | 'shown' | 'failed' | 'timeout'>(null);
  const test = () =>
    run('test', async () => {
      if (!local.endpoint) return false;
      setTestResult('waiting');
      // Listen before sending: a fast push can arrive before the request even returns.
      const arrived = waitForShown('test', 20_000);
      try {
        await api.pushTest(local.endpoint);
      } catch (e) {
        setTestResult(null);
        throw e;
      }
      setTestResult(await arrived);
      return true;
    });

  const turnOff = () =>
    run('off', async () => {
      // The same device may also get order alerts and chat messages: then only the reminders stop,
      // and the browser keeps its notification address.
      const alerts = !!local.endpoint && localStorage.getItem('ss_account_alerts') === local.endpoint;
      if (local.endpoint && alerts) await api.pushPrefs(local.endpoint, NO_REMINDERS);
      else {
        if (local.endpoint) await api.pushUnsubscribe(local.endpoint).catch(() => {});
        await unsubscribeBrowser();
      }
      setLocalReminders((r) => ({ ...r, endpoint: null }));
      track('reminders_off', {});
      return true;
    });

  const snooze = () => setLocalReminders((r) => ({ ...r, snoozedUntil: Date.now() + WEEK }));
  const unsnooze = () => setLocalReminders((r) => ({ ...r, snoozedUntil: null }));
  const snoozed = !!local.snoozedUntil && local.snoozedUntil > Date.now();

  return {
    state,
    local,
    busy,
    error,
    setError,
    turnOn,
    save,
    update,
    saved,
    test,
    testResult,
    turnOff,
    snooze,
    unsnooze,
    snoozed,
    loading: status.isLoading,
  };
}

/**
 * Keeps class reminders in step with the timetable: when a course is added, moved or removed,
 * the server's copy of the chosen classes is updated (a moment later, once editing settles).
 */
export function useSyncTimetableReminders(courses: Course[]) {
  const local = useLocalReminders();
  const first = useRef(true);
  const wanted = local.endpoint && (local.classes.nightly || local.classes.before);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!wanted || !local.endpoint) return;
    const t = window.setTimeout(() => {
      void api.pushPrefs(local.endpoint!, serverPrefs(local, courses)).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, [courses, wanted, local]);
}
