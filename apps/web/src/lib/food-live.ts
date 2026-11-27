import { useEffect, useState } from 'react';
import { api } from './api';
import { useSession } from './session';

/**
 * Food (mess menus and ordering) is shown only once its launch switch (Admin › mess-menu) is
 * live. Until then every way in stays hidden: the Food tab, Order food buttons, My orders links.
 * Admins still see it, to set it up. Hidden while the answer loads, so it never flashes up.
 *
 * Plain fetch with one shared answer per minute (not React Query): the site header uses it, and
 * the header renders outside the query provider too (error screens, tests).
 */
let known: { at: number; live: boolean } | null = null;
let asking: Promise<boolean> | null = null;

function ask(): Promise<boolean> {
  if (known && Date.now() - known.at < 60_000) return Promise.resolve(known.live);
  asking ??= api
    .features()
    .then((list) => list.find((f) => f.key === 'mess-menu')?.status === 'live')
    .catch(() => known?.live ?? false)
    .then((live) => {
      known = { at: Date.now(), live };
      asking = null;
      return live;
    });
  return asking;
}

export function useFoodLive(): boolean {
  const isAdmin = useSession((s) => !!s.me?.isAdmin);
  const [live, setLive] = useState(() => known?.live ?? false);
  useEffect(() => {
    let on = true;
    void ask().then((v) => on && setLive(v));
    return () => {
      on = false;
    };
  }, []);
  return isAdmin || live;
}
