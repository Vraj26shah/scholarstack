import { useEffect, useState } from 'react';
import { api } from './api';
import { useSession } from './session';

/**
 * What Admin has switched on. Each feature (CGPA, attendance, timetable, mess menu & ordering) has
 * one launch switch, and the website and the Android apps (which load the website) both follow it,
 * so whatever Admin shows or hides changes in both places at once. Until a feature is live, every
 * way in stays hidden (tabs, buttons, sections on Today); admins still see it, to set it up.
 * Hidden while the answer loads, so nothing flashes up and disappears.
 *
 * Plain fetch with one shared answer per minute (not React Query): the site header uses it, and
 * the header renders outside the query provider too (error screens, tests).
 */
let known: { at: number; live: Set<string> } | null = null;
let asking: Promise<Set<string>> | null = null;

function ask(): Promise<Set<string>> {
  if (known && Date.now() - known.at < 60_000) return Promise.resolve(known.live);
  asking ??= api
    .features()
    .then((list) => new Set(list.filter((f) => f.status === 'live').map((f) => f.key)))
    .catch(() => known?.live ?? new Set<string>())
    .then((live) => {
      known = { at: Date.now(), live };
      asking = null;
      return live;
    });
  return asking;
}

/** After Admin changes a switch: the next check asks the server again. */
export function forgetFeatureSwitches() {
  known = null;
}

export function useFeatureLive(key: string): boolean {
  const isAdmin = useSession((s) => !!s.me?.isAdmin);
  const [live, setLive] = useState(() => known?.live.has(key) ?? false);
  useEffect(() => {
    let on = true;
    void ask().then((set) => on && setLive(set.has(key)));
    return () => {
      on = false;
    };
  }, [key]);
  return isAdmin || live;
}

/** Food: mess menus and ordering (the mess-menu switch). */
export const useFoodLive = () => useFeatureLive('mess-menu');
