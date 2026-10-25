import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Warm what the next click will need, the moment intent shows (hover, focus, touch start):
 * the course or bundle data, the first page-one previews, and the code for the page itself.
 * Each is fetched at most once; failures are silent because the real navigation retries.
 */
const warmed = new Set<string>();

const idle = (fn: () => void) =>
  'requestIdleCallback' in window
    ? (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(fn)
    : setTimeout(fn, 200);

function warmImages(urls: string[]) {
  for (const url of urls) {
    if (warmed.has(url)) continue;
    warmed.add(url);
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  }
}

export function prefetchCourse(qc: QueryClient, slug: string, status: string) {
  const key = `course:${slug}:${status}`;
  if (warmed.has(key)) return;
  warmed.add(key);
  void qc
    .prefetchQuery({ queryKey: ['course', slug, status], queryFn: () => api.course(slug), staleTime: 30_000 })
    .then(() => {
      const course = qc.getQueryData<Awaited<ReturnType<typeof api.course>>>(['course', slug, status]);
      const previews = (course?.units ?? [])
        .map((u) => u.previewFileId)
        .filter((id): id is string => !!id)
        .slice(0, 3)
        .map((id) => api.previewUrl(id));
      idle(() => warmImages(previews));
    })
    .catch(() => warmed.delete(key));
}

export function prefetchBundle(qc: QueryClient, slug: string, status: string) {
  const key = `bundle:${slug}:${status}`;
  if (warmed.has(key)) return;
  warmed.add(key);
  void qc
    .prefetchQuery({ queryKey: ['bundle', slug, status], queryFn: () => api.bundle(slug), staleTime: 30_000 })
    .catch(() => warmed.delete(key));
}

/** Download a lazily loaded page's code ahead of time (reader, bundle page). */
export function prefetchChunk(name: 'reader' | 'bundle') {
  const key = `chunk:${name}`;
  if (warmed.has(key)) return;
  warmed.add(key);
  idle(() => {
    if (name === 'reader') void import('../features/reader/reader-page');
    else void import('../features/bundles/bundle-page');
  });
}
