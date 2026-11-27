import { api } from './api';

/**
 * What Admin has switched on (the launch switches), one shared answer per minute. Asked as the
 * session starts, alongside the account, so the header draws its buttons once and nothing shifts.
 */
let known: { at: number; live: Set<string> } | null = null;
let asking: Promise<Set<string>> | null = null;

export function featureSwitches(): Promise<Set<string>> {
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

/** The last answer, if there is one (for a first render without waiting). */
export const knownSwitches = () => known?.live ?? null;

/** After Admin changes a switch: the next check asks the server again. */
export function forgetFeatureSwitches() {
  known = null;
}
