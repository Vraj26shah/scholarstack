import type { Batch, Branch, Bundle, Course, CourseFile } from '../domain/entities';
import type { BundleRepository, CatalogueReader } from '../domain/ports';
import { Memo, MemoMap } from './memo';

/**
 * The public catalogue's database reads, remembered: every page (home, drawers, search, bundles,
 * prices) is built from the same few reads, so they are made once and shared. Fresh for 30 seconds,
 * then served while a background read refreshes them; an admin change forgets them at once.
 */
const FRESH = 30_000;
const STALE = 15 * 60_000;

export type ForgettableReader = CatalogueReader & { forget(): void };

export function cachedCatalogue(reader: CatalogueReader): ForgettableReader {
  const batches = new Memo<Batch[]>(() => reader.listBatches(), FRESH, STALE);
  const branches = new Memo<Branch[]>(() => reader.listBranches(), FRESH, STALE);
  const links = new Memo(() => reader.listLiveCourseLinks(), FRESH, STALE);
  // Files of every live course, in one read; a request for live courses' files is answered from it.
  const liveFiles = new Memo<CourseFile[]>(
    async () => reader.listFiles((await links.get()).map((l) => l.course.id)),
    FRESH,
    STALE,
  );
  const other = new MemoMap<CourseFile[]>(FRESH, STALE);
  const byIds = new MemoMap<Course[]>(FRESH, STALE);
  return {
    ...reader,
    listBatches: () => batches.get(),
    listBranches: () => branches.get(),
    listLiveCourses: (y, b) => reader.listLiveCourses(y, b),
    listLiveCourseLinks: async (batchYear) => {
      const all = await links.get();
      return batchYear === undefined ? all : all.filter((l) => l.course.batchYear === batchYear);
    },
    findCourse: (idOrSlug) => reader.findCourse(idOrSlug),
    coursesByIds: (ids) => byIds.get([...ids].sort().join(','), () => reader.coursesByIds(ids)),
    listFiles: async (ids) => {
      if (!ids.length) return [];
      const live = new Set((await links.get()).map((l) => l.course.id));
      if (ids.every((id) => live.has(id))) {
        const want = new Set(ids);
        return (await liveFiles.get()).filter((f) => want.has(f.courseId));
      }
      return other.get([...ids].sort().join(','), () => reader.listFiles(ids));
    },
    findFile: (id) => reader.findFile(id),
    listHiddenFiles: (ids) => reader.listHiddenFiles(ids),
    forget() {
      for (const m of [batches, branches, links, liveFiles, other, byIds]) m.forget();
    },
  };
}

export type ForgettableBundles = BundleRepository & { forget(): void };

/** Live bundles, remembered the same way (every drawer and course page asks for them). */
export function cachedBundles(repo: BundleRepository): ForgettableBundles {
  const live = new Memo<Bundle[]>(() => repo.listLive(), FRESH, STALE);
  return {
    listLive: () => live.get(),
    listAll: () => repo.listAll(),
    find: (idOrSlug) => repo.find(idOrSlug),
    save: async (b) => {
      live.forget();
      return repo.save(b);
    },
    remove: async (id) => {
      live.forget();
      return repo.remove(id);
    },
    forget: () => live.forget(),
  };
}
