import type { StoredObject } from '../domain/entities';
import type { ObjectStore } from '../domain/ports';
import { fail } from './errors';

/** Areas of the bucket that are never notes: generated pages, uploads, help-desk files, backups. */
export const PROTECTED = /^(pages|contributions|support|_system)\//;

export async function walk(
  store: ObjectStore,
  prefix: string,
  keep: (o: StoredObject) => boolean = () => true,
): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await store.listPage(prefix, cursor, 1000);
    for (const o of page.objects) if (keep(o)) out.push(o);
    if (page.nextCursor && (seen.has(page.nextCursor) || page.nextCursor === cursor))
      throw fail.syncFailed('Storage listing stalled; try again.');
    if (page.nextCursor) seen.add(page.nextCursor);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

export interface PageStats {
  objects: number;
  bytes: number;
}

/**
 * What is in the bucket, read once and shared by every storage screen for a short while.
 *
 * The bucket holds a few hundred notes and tens of thousands of generated page tiles. Walking all
 * of it for each screen (and twice for the tree) took 15 s and, with several admin tabs polling,
 * ran the Worker out of memory, which showed as 503s on unrelated calls. Now:
 *  - notes are listed folder by folder from the top, skipping the page, upload and help-desk areas;
 *  - page tiles are only counted (per file id), never kept in memory;
 *  - each answer is kept for a minute and shared by callers that ask at the same time;
 *  - any admin change, and every finished conversion, clears it, so nothing shown is stale.
 * Deletes and moves always ask for a fresh listing before they act.
 */
export class StorageIndex {
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();
  /** The last good page-tile count, served while a newer one is read (it only feeds sizes). */
  private pagesKept: { at: number; value: Map<string, PageStats> } | null = null;
  private pagesLoading: Promise<Map<string, PageStats>> | null = null;
  private pagesStale = false;

  constructor(
    private readonly sources: ObjectStore,
    private readonly pages: ObjectStore,
    private readonly ttlMs = 60_000,
    private readonly now = () => Date.now(),
    /** How long a page-tile count may be shown before it must be re-read before answering. */
    private readonly pagesMaxAgeMs = 10 * 60_000,
  ) {}

  /**
   * After an admin change. Notes are re-read on the next look (they are few and cheap to list),
   * but the tens of thousands of page tiles are not walked again straight away: the last count
   * keeps answering while a new one is read in the background. Walking them after every click
   * is what ran the Worker out of time and made the admin lose storage until it recovered.
   */
  forget() {
    this.cache.clear();
    this.pagesStale = true;
  }

  /** A conversion finished: only the page tiles changed. */
  forgetPages() {
    this.pagesStale = true;
  }

  private memo<T>(key: string, fresh: boolean, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (!fresh && hit && this.now() - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { at: this.now(), value });
    // A failed listing is never kept.
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }

  /** Every object outside the protected areas: the admin's notes, at any depth. */
  notes(fresh = false): Promise<StoredObject[]> {
    return this.memo('notes', fresh, async () => {
      const level = this.sources.listLevel?.bind(this.sources);
      if (!level) return walk(this.sources, '', (o) => !PROTECTED.test(o.key));
      const top = await level('');
      const folders = top.folders.filter((f) => !PROTECTED.test(f));
      const inside = await Promise.all(folders.map((f) => walk(this.sources, f)));
      return [...top.objects, ...inside.flat()];
    });
  }

  /** Objects in one protected area ("contributions/", "support/"). */
  area(prefix: string, fresh = false): Promise<StoredObject[]> {
    return this.memo(`area:${prefix}`, fresh, () => walk(this.sources, prefix));
  }

  /** Generated page tiles, counted per file id ("(loose)" for anything not in a file folder). */
  pageStats(fresh = false): Promise<Map<string, PageStats>> {
    const kept = this.pagesKept;
    const age = kept ? this.now() - kept.at : Number.POSITIVE_INFINITY;
    // Deletes and moves always count again before they act (and an index with no cache, too).
    if (fresh || !kept || this.ttlMs === 0 || age >= this.pagesMaxAgeMs) return this.readPages();
    // Recent enough to show; read a newer count in the background if it may be out of date.
    if (this.pagesStale || age >= this.ttlMs) void this.readPages().catch(() => {});
    return Promise.resolve(kept.value);
  }

  /** One walk of the page tiles at a time; everyone asking meanwhile shares it. */
  private readPages(): Promise<Map<string, PageStats>> {
    if (this.pagesLoading) return this.pagesLoading;
    this.pagesStale = false;
    const started = this.now();
    const loading = this.walkPages().then(
      (value) => {
        this.pagesKept = { at: started, value };
        return value;
      },
      (error: unknown) => {
        this.pagesStale = true;
        throw error;
      },
    );
    this.pagesLoading = loading;
    const done = () => {
      if (this.pagesLoading === loading) this.pagesLoading = null;
    };
    loading.then(done, done);
    return loading;
  }

  private walkPages(): Promise<Map<string, PageStats>> {
    return (async () => {
      const out = new Map<string, PageStats>();
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await this.pages.listPage('pages/', cursor, 1000);
        for (const o of page.objects) {
          const id = /^pages\/([^/]+)\//.exec(o.key)?.[1] ?? '(loose)';
          const g = out.get(id) ?? { objects: 0, bytes: 0 };
          g.objects++;
          g.bytes += o.size;
          out.set(id, g);
        }
        if (page.nextCursor && (seen.has(page.nextCursor) || page.nextCursor === cursor))
          throw fail.syncFailed('Storage listing stalled; try again.');
        if (page.nextCursor) seen.add(page.nextCursor);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return out;
    })();
  }
}
