import type { QueryClient } from '@tanstack/react-query';

/**
 * Keeps the public catalogue on the student's device: the home page, the drawers they opened and
 * their bundles show at once on the next visit (even before the network answers), then refresh in
 * the background. Only public data is kept, never anything about the account. A new release
 * starts afresh, so an old shape never meets new code.
 */
const KEY = 'ss_query_cache_v1';
const KEEP = new Set(['catalogue', 'drawer', 'bundles', 'features']);
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 600_000;

interface Saved {
  build: string;
  at: number;
  queries: { key: unknown[]; data: unknown; updatedAt: number }[];
}

const keep = (key: readonly unknown[]) => typeof key[0] === 'string' && KEEP.has(key[0]);

export function restoreQueries(client: QueryClient, build: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (!saved || saved.build !== build || Date.now() - saved.at > MAX_AGE) return;
    // Marked as old, so React Query shows it straight away and fetches the current version.
    for (const q of saved.queries)
      client.setQueryData(q.key, q.data, { updatedAt: Math.min(q.updatedAt, Date.now() - 60_000) });
  } catch {
    // Blocked storage or a damaged entry: start empty.
  }
}

export function persistQueries(client: QueryClient, build: string) {
  let timer: number | undefined;
  const save = () => {
    timer = undefined;
    try {
      const queries = client
        .getQueryCache()
        .getAll()
        .filter((q) => keep(q.queryKey) && q.state.status === 'success' && q.state.data !== undefined)
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
        .slice(0, 40)
        .map((q) => ({ key: q.queryKey as unknown[], data: q.state.data, updatedAt: q.state.dataUpdatedAt }));
      let text = JSON.stringify({ build, at: Date.now(), queries } satisfies Saved);
      // Too big for comfort: keep the newest half.
      if (text.length > MAX_BYTES)
        text = JSON.stringify({ build, at: Date.now(), queries: queries.slice(0, 10) } satisfies Saved);
      localStorage.setItem(KEY, text);
    } catch {
      // Full or blocked storage: nothing to keep, the site works the same.
    }
  };
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || !keep(event.query.queryKey)) return;
    if (timer === undefined) timer = window.setTimeout(save, 1_000);
  });
}
