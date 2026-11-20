import { PREVIEW_LIMITS, type PreviewPick, type UnitPreviewInput } from '@ss/contracts';
import { isReaderReady } from '../domain/entities';
import type { CatalogueReader, CatalogueWriter, ObjectStore, RateLimiter, TileSeeder } from '../domain/ports';
import { fail } from './errors';
import { isPreviewPage } from './mappers';

export interface PreviewPage {
  body: ReadableStream | ArrayBuffer | Uint8Array;
  contentType: string;
  tileSeed: string;
}

/**
 * Free previews the admin chooses: per unit, up to four files with up to five pages each. The public
 * can fetch exactly those pages of live courses (tile-scrambled, like the reader); admins can
 * look at any page of any file while choosing.
 */
export class PreviewService {
  constructor(
    private readonly reader: CatalogueReader,
    private readonly writer: CatalogueWriter,
    private readonly pages: ObjectStore,
    private readonly seeder: TileSeeder,
    private readonly limiter: RateLimiter,
  ) {}

  private async page(fileId: string, pageNo: number): Promise<PreviewPage> {
    const object = await this.pages.get(`pages/${fileId}/${pageNo}.webp`);
    if (!object) throw fail.notFound('That page');
    return { ...object, tileSeed: await this.seeder.seedFor(fileId, pageNo) };
  }

  /** A public preview page: only a chosen page of a live course's preview file. */
  async publicPage(fileId: string, pageNo: number, who: string): Promise<PreviewPage> {
    if (!Number.isInteger(pageNo) || pageNo < 1) throw fail.notFound('That preview');
    if (!(await this.limiter.allow(`preview:${who}`))) throw fail.rateLimited();
    const file = await this.reader.findFile(fileId);
    if (!file || !isReaderReady(file)) throw fail.notFound('That preview');
    const course = await this.reader.findCourse(file.courseId);
    if (!course || course.status !== 'live') throw fail.notFound('That preview');
    const siblings = await this.reader.listFiles([course.id]);
    if (!isPreviewPage(file, pageNo, siblings)) throw fail.notFound('That preview');
    return this.page(fileId, pageNo);
  }

  /** Any page of any converted file, for an admin choosing what to show. */
  async adminPage(fileId: string, pageNo: number): Promise<PreviewPage> {
    const file = await this.writer.findAnyFile(fileId);
    if (!file || file.conversionStatus !== 'ready') throw fail.notFound('That file’s pages');
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > file.pageCount) throw fail.notFound('That page');
    return this.page(fileId, pageNo);
  }

  /**
   * Choose a unit's free previews: one or more files of the unit, each with up to five pages
   * (ten pages in all). An empty list goes back to the default (page 1 of the first file).
   */
  async choose(courseId: string, unitKey: string, input: UnitPreviewInput) {
    const previews: PreviewPick[] = [];
    for (const pick of input.previews) {
      if (previews.some((p) => p.fileId === pick.fileId))
        throw fail.badRequest('Each file can be picked once; tick more pages of it instead.');
      const file = await this.writer.findAnyFile(pick.fileId);
      if (!file || file.courseId !== courseId || file.unitKey !== unitKey)
        throw fail.badRequest('Pick files from this unit.');
      if (!isReaderReady(file)) throw fail.badRequest(`${file.name} has no pages yet. Make its pages first.`);
      const pages = [...new Set(pick.pages)].sort((a, b) => a - b);
      const tooFar = pages.find((n) => n > file.pageCount);
      if (tooFar)
        throw fail.badRequest(`${file.name} has ${file.pageCount} pages; page ${tooFar} doesn’t exist.`);
      previews.push({ fileId: file.id, pages });
    }
    if (previews.length > PREVIEW_LIMITS.files)
      throw fail.badRequest(`Pick at most ${PREVIEW_LIMITS.files} files to preview.`);
    if (previews.reduce((s, p) => s + p.pages.length, 0) > PREVIEW_LIMITS.pages)
      throw fail.badRequest(
        `Students can peek at up to ${PREVIEW_LIMITS.pages} pages per unit. Untick a few.`,
      );
    const ok = await this.writer.setUnitPreview(courseId, unitKey, previews);
    if (!ok) throw fail.notFound('That unit');
    return { previews };
  }
}
