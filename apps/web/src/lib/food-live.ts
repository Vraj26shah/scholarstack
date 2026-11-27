import { useEffect, useState } from 'react';
import { featureSwitches, knownSwitches } from './feature-switches';
import { useSession } from './session';

export { forgetFeatureSwitches } from './feature-switches';

/**
 * What Admin has switched on. Each feature (CGPA, attendance, timetable, mess menu & ordering) has
 * one launch switch, and the website and the Android apps (which load the website) both follow it,
 * so whatever Admin shows or hides changes in both places at once. Until a feature is live, every
 * way in stays hidden (tabs, buttons, sections on Today); admins still see it, to set it up.
 * Hidden while the answer loads, so nothing flashes up and disappears. The session asks for the
 * switches alongside the account, so by the time the header shows the answer is usually here.
 *
 * Plain fetch with one shared answer per minute (not React Query): the site header uses it, and
 * the header renders outside the query provider too (error screens, tests).
 */
export function useFeatureLive(key: string): boolean {
  const isAdmin = useSession((s) => !!s.me?.isAdmin);
  const [live, setLive] = useState(() => knownSwitches()?.has(key) ?? false);
  useEffect(() => {
    let on = true;
    void featureSwitches().then((set) => on && setLive(set.has(key)));
    return () => {
      on = false;
    };
  }, [key]);
  return isAdmin || live;
}

/** Food: mess menus and ordering (the mess-menu switch). */
export const useFoodLive = () => useFeatureLive('mess-menu');
