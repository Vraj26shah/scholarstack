import type { OpenReaderDto } from '@ss/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, friendly } from '../../lib/api';
import { reportProblem } from '../../lib/problems';
import { preassemble } from './page-canvas';

export type ReaderProblem = 'lease-taken' | 'rate-limited' | 'error' | null;

interface LoadedPage {
  bitmap: ImageBitmap;
  seed: string;
  ordered: boolean;
}

/** A cached page that resolves this fast never flashes the spinner. */
const SPINNER_DELAY_MS = 150;
const KEEP_BEHIND = 3;
const KEEP_AHEAD = 6;

const HEARTBEAT_MS = 60_000;

/**
 * Reader state machine: open (lease + token) → fetch pages (with a small cache and
 * prefetch) → heartbeat every minute (renews token, saves progress, reports pages read).
 */
export function useReader(fileId: string) {
  const [session, setSession] = useState<OpenReaderDto | null>(null);
  const [page, setPage] = useState(1);
  const [current, setCurrent] = useState<LoadedPage | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [problem, setProblem] = useState<ReaderProblem>(null);
  const [message, setMessage] = useState('');
  const token = useRef('');
  const cache = useRef(new Map<number, Promise<LoadedPage>>());
  const viewed = useRef(new Set<number>());
  const pageRef = useRef(1);
  // A reader that is closing (you opened another file) must never flag a problem on the next one.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fail = useCallback((e: unknown) => {
    if (!alive.current) return;
    if (e instanceof ApiError && e.code === 'LEASE_TAKEN') setProblem('lease-taken');
    else if (e instanceof ApiError && e.code === 'RATE_LIMITED') setProblem('rate-limited');
    else {
      setProblem('error');
      // Expected states (signed out, no access, offline) are not problems for the admin.
      if (!(e instanceof ApiError) || e.status >= 500)
        reportProblem('api', `Reader: ${e instanceof Error ? e.message : String(e)}`);
    }
    setMessage(friendly(e));
  }, []);

  const open = useCallback(async () => {
    setProblem(null);
    cache.current.clear();
    try {
      const s = await api.openReader(fileId);
      token.current = s.viewerToken;
      setSession(s);
      setPage(s.lastPage);
      pageRef.current = s.lastPage;
    } catch (e) {
      fail(e);
    }
  }, [fileId, fail]);

  useEffect(() => {
    void open();
  }, [open]);

  const load = useCallback(
    (n: number): Promise<LoadedPage> => {
      const hit = cache.current.get(n);
      if (hit) return hit;
      const p = (async () => {
        const { blob, seed } = await api.page(token.current, fileId, n);
        const scrambled = await createImageBitmap(blob);
        const ready = await preassemble(scrambled, seed).catch(() => null);
        if (!ready) return { bitmap: scrambled, seed, ordered: false };
        scrambled.close();
        return { bitmap: ready, seed, ordered: true };
      })();
      cache.current.set(n, p);
      p.catch(() => cache.current.delete(n));
      return p;
    },
    [fileId],
  );

  // Show the current page, prefetch the next two.
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const spin = setTimeout(() => alive && setLoadingPage(true), SPINNER_DELAY_MS);
    load(page)
      .then((loaded) => {
        if (!alive) return;
        setCurrent(loaded);
        viewed.current.add(page);
        // Keep memory flat on long files: a decoded page is several MB, so only a window
        // around where you are stays cached (the garbage collector frees the rest).
        for (const n of cache.current.keys())
          if (n < page - KEEP_BEHIND || n > page + KEEP_AHEAD) cache.current.delete(n);
        // Warm the pages you are most likely to turn to next, so they appear instantly.
        for (const n of [page + 1, page + 2, page + 3, page - 1])
          if (n >= 1 && n <= session.pageCount) void load(n).catch(() => {});
      })
      .catch(async (e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.code === 'VIEWER_TOKEN_INVALID') return void open();
        fail(e);
      })
      .finally(() => {
        clearTimeout(spin);
        if (alive) setLoadingPage(false);
      });
    pageRef.current = page;
    return () => {
      alive = false;
      clearTimeout(spin);
    };
  }, [page, session, load, fail, open]);

  // Heartbeat: renew token, save progress, count pages.
  const beat = useCallback(
    async (closing = false) => {
      if (!token.current) return;
      const pagesViewed = viewed.current.size;
      viewed.current.clear();
      try {
        const r = await api.heartbeat(token.current, { fileId, page: pageRef.current, pagesViewed });
        if (!closing) token.current = r.viewerToken;
      } catch (e) {
        // The last save of a closing reader may race the next file taking the reading slot.
        if (!closing) fail(e);
      }
    },
    [fileId, fail],
  );

  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => void beat(), HEARTBEAT_MS);
    const onHide = () => document.visibilityState === 'hidden' && void beat();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
      void beat(true);
    };
  }, [session, beat]);

  const go = useCallback(
    (n: number) => {
      if (!session) return;
      setPage(Math.max(1, Math.min(session.pageCount, n)));
    },
    [session],
  );

  return { session, page, go, current, loadingPage, problem, message, reopen: open };
}
