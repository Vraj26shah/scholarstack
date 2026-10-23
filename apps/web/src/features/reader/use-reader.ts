import type { OpenReaderDto } from '@ss/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, friendly } from '../../lib/api';

export type ReaderProblem = 'lease-taken' | 'rate-limited' | 'error' | null;

interface LoadedPage {
  bitmap: ImageBitmap;
  seed: string;
}

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

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.code === 'LEASE_TAKEN') setProblem('lease-taken');
    else if (e instanceof ApiError && e.code === 'RATE_LIMITED') setProblem('rate-limited');
    else setProblem('error');
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
        return { bitmap: await createImageBitmap(blob), seed };
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
    setLoadingPage(true);
    load(page)
      .then((loaded) => {
        if (!alive) return;
        setCurrent(loaded);
        viewed.current.add(page);
        for (const n of [page + 1, page + 2]) if (n <= session.pageCount) void load(n).catch(() => {});
      })
      .catch(async (e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.code === 'VIEWER_TOKEN_INVALID') return void open();
        fail(e);
      })
      .finally(() => alive && setLoadingPage(false));
    pageRef.current = page;
    return () => {
      alive = false;
    };
  }, [page, session, load, fail, open]);

  // Heartbeat: renew token, save progress, count pages.
  const beat = useCallback(async () => {
    if (!token.current) return;
    const pagesViewed = viewed.current.size;
    viewed.current.clear();
    try {
      const r = await api.heartbeat(token.current, { fileId, page: pageRef.current, pagesViewed });
      token.current = r.viewerToken;
    } catch (e) {
      fail(e);
    }
  }, [fileId, fail]);

  useEffect(() => {
    if (!session) return;
    const t = setInterval(beat, HEARTBEAT_MS);
    const onHide = () => document.visibilityState === 'hidden' && void beat();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
      void beat();
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
