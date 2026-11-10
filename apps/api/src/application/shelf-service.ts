import { SHELF_GRACE_HOURS, type ShelfItemDto } from '@ss/contracts';
import { type Principal, accessState } from '../domain/entities';
import type { CatalogueReader, EntitlementRepository, ProgressRepository } from '../domain/ports';
import { toCard } from './mappers';

/** The student's shelf: owned courses, most recently read first. */
export class ShelfService {
  constructor(
    private readonly catalogue: CatalogueReader,
    private readonly entitlements: EntitlementRepository,
    private readonly progress: ProgressRepository,
  ) {}

  async list(principal: Principal): Promise<ShelfItemDto[]> {
    const records = await this.entitlements.listForUser(principal.userId);
    if (records.length === 0) return [];
    const now = new Date();
    // A lost bank dispute is not shown on the shelf. Ended and admin-blocked courses are, for
    // SHELF_GRACE_HOURS, so the student sees why a course no longer opens; then they leave it.
    const grace = SHELF_GRACE_HOURS * 3_600_000;
    const endedAt = (r: (typeof records)[number]) => {
      const state = accessState(r, now);
      if (state === 'active') return null;
      return state === 'ended' ? r.expiresAt : (r.revokedAt ?? r.expiresAt);
    };
    const shown = records.filter((r) => {
      if (accessState(r, now) === 'disputed') return false;
      const end = endedAt(r);
      return !end || now.getTime() - end.getTime() < grace;
    });
    const byCourse = new Map(shown.map((r) => [r.courseId, r]));
    const ids = [...byCourse.keys()];
    if (ids.length === 0) return [];
    const [courses, files, branches, recent] = await Promise.all([
      this.catalogue.coursesByIds(ids),
      this.catalogue.listFiles(ids),
      this.catalogue.listBranches(),
      this.progress.latest(principal.userId, 100),
    ]);
    const fileById = new Map(files.map((f) => [f.id, f]));
    // Only courses that are live: a course taken off sale (draft or archived) can't be opened, so
    // it doesn't sit on the shelf as a dead end. It comes back the moment it is live again.
    const items = courses
      .filter((course) => course.status === 'live')
      .map((course) => {
        const last = recent.find((p) => fileById.get(p.fileId)?.courseId === course.id);
        const lastFile = last ? fileById.get(last.fileId) : undefined;
        return {
          sortKey: last ? last.updatedAt.getTime() : 0,
          dto: {
            course: toCard(
              course,
              files,
              branches.find((b) => b.slug === course.branchSlug),
            ),
            access: (() => {
              const r = byCourse.get(course.id)!;
              const state = accessState(r, now);
              return {
                state: state === 'active' ? 'active' : state === 'ended' ? 'ended' : 'blocked',
                until: r.expiresAt ? r.expiresAt.toISOString() : null,
                termLabel: '',
                note: r.note ?? null,
                leavesShelfAt: (() => {
                  const end = endedAt(r);
                  return end ? new Date(end.getTime() + grace).toISOString() : null;
                })(),
                endedAt:
                  state === 'ended'
                    ? (r.expiresAt?.toISOString() ?? null)
                    : state === 'active'
                      ? null
                      : (r.revokedAt?.toISOString() ?? null),
              } as const;
            })(),
            lastRead:
              last && lastFile
                ? {
                    fileId: lastFile.id,
                    fileName: lastFile.name,
                    page: last.page,
                    pageCount: lastFile.pageCount,
                  }
                : null,
          } satisfies ShelfItemDto,
        };
      });
    return items
      .sort(
        (a, b) =>
          Number(a.dto.access.state !== 'active') - Number(b.dto.access.state !== 'active') ||
          b.sortKey - a.sortKey ||
          a.dto.course.title.localeCompare(b.dto.course.title),
      )
      .map((i) => i.dto);
  }
}
