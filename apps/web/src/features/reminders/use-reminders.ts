import { ReminderPrefs, deviceLabel } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { ApiError, api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { askToSignIn } from '../auth/sign-in-prompt';
import type { Course } from '../tools/timetable/domain';
import {
  PermissionRefused,
  type PushSupport,
  PushUnavailable,
  browserSubscription,
  pushSupport,
  subscribeBrowser,
  unsubscribeBrowser,
  waitForShown,
  warmPush,
} from './push-client';
import {
  type LocalReminders,
  getLocalReminders,
  serverPrefs,
  setLocalReminders,
  useLocalReminders,
} from './settings-store';

const WEEK = 7 * 24 * 3600 * 1000;

const STATUS_KEY = 'ss_push_status';
type PushStatus = Awaited<ReturnType<typeof api.pushStatus>>;
/** The push status this device saw last time (read field by field: old saved shapes are ignored). */
function savedStatus(): PushStatus | undefined {
  try {
    const raw = JSON.parse(localStorage.getItem(STATUS_KEY) ?? 'null') as Partial<PushStatus> | null;
    if (!raw || typeof raw.configured !== 'boolean' || typeof raw.open !== 'boolean') return undefined;
    return raw as PushStatus;
  } catch {
    return undefined;
  }
}

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
  e instanceof ApiError || e instanceof PushUnavailable
    ? e.message
    : "That didn't work. Check your connection and try again.";

/** Which kind a screen offers: class reminders open with the Timetable maker, meals with the Mess menu. */
export type ReminderKind = 'class' | 'meal';

/**
 * Everything a screen needs to offer, turn on, change and turn off reminders on this device.
 * `kind` hides the screen's reminders until that kind is open to students (admins: always).
 */
export function useReminders(kind?: ReminderKind) {
  const local = useLocalReminders();
  const session = useSession();
  const signedIn = session.status === 'ready' && !!session.me;
  // The last answer is kept on this device, so the switches show at once instead of popping in.
  const status = useQuery({
    queryKey: ['push-status'],
    queryFn: async () => {
      const s = await api.pushStatus();
      try {
        localStorage.setItem(STATUS_KEY, JSON.stringify(s));
      } catch {
        // storage blocked: fine, just not cached
      }
      return s;
    },
    placeholderData: savedStatus,
    staleTime: 5 * 60_000,
  });
  const [support, setSupport] = useState<PushSupport>(() => pushSupport());
  const [busy, setBusy] = useState<null | 'on' | 'save' | 'test' | 'off'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status.data?.configured) warmPush();
  }, [status.data?.configured]);

  // The browser may have dropped the subscription (site data cleared, permission reset).
  useEffect(() => {
    if (!local.endpoint) return;
    void browserSubscription().then((sub) => {
      if (!sub || sub.endpoint !== local.endpoint) setLocalReminders((r) => ({ ...r, endpoint: null }));
    });
  }, [local.endpoint]);

  const s = status.data;
  // `?? s.open`: a server from before the per-kind switches answers only `open`.
  const open = !s
    ? false
    : kind === 'class'
      ? (s.classes ?? s.open)
      : kind === 'meal'
        ? (s.meals ?? s.open)
        : s.open;
  const state: ReminderState =
    !s || !open ? 'hidden' : !s.configured ? 'unconfigured' : local.endpoint ? 'on' : support;

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
      // Signed-in students only: sign in, come straight back here, tap again.
      if (!signedIn) {
        askToSignIn({
          title: 'Sign in to turn on reminders',
          body: 'Reminders are free for students: sign in with your college email and you come straight back here to switch them on.',
          next: `${window.location.pathname}${window.location.search}${kind === 'meal' ? '#reminders' : '#class-reminders'}`,
        });
        return false;
      }
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
  const test = (kind?: 'meal' | 'class') =>
    run('test', async () => {
      if (!local.endpoint) return false;
      setTestResult('waiting');
      // Listen before sending: a fast push can arrive before the request even returns.
      const arrived = waitForShown('test', 20_000);
      try {
        await api.pushTest(local.endpoint, kind);
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

  /**
   * Stops one kind of reminder (meals, or classes) and keeps the other. When nothing is left the
   * device is let go (order alerts, if on, stay).
   */
  const stopKind = (disable: (r: LocalReminders) => LocalReminders) => {
    const rest = disable(getLocalReminders());
    const anyLeft =
      (!!rest.mess.slug && (rest.mess.meals.length > 0 || rest.mess.favourites.length > 0)) ||
      rest.classes.nightly ||
      rest.classes.before;
    update(() => rest);
    if (!anyLeft) void turnOff();
  };

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
    stopKind,
    snooze,
    unsnooze,
    snoozed,
    loading: status.isLoading,
    /** Turning reminders on needs an account; signed-out visitors are asked to sign in first. */
    signedIn,
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
