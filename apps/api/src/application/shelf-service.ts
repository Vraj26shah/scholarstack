import type { ShelfItemDto } from '@ss/contracts';
import type { Principal } from '../domain/entities';
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
    const ids = await this.entitlements.listCourseIds(principal.userId);
    if (ids.length === 0) return [];
    const [courses, files, branches, recent] = await Promise.all([
      this.catalogue.coursesByIds(ids),
      this.catalogue.listFiles(ids),
      this.catalogue.listBranches(),
      this.progress.latest(principal.userId, 100),
    ]);
    const fileById = new Map(files.map((f) => [f.id, f]));
    const items = courses.map((course) => {
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
      .sort((a, b) => b.sortKey - a.sortKey || a.dto.course.title.localeCompare(b.dto.course.title))
      .map((i) => i.dto);
  }
}
