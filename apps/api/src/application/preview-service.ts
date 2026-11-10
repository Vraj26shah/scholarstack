import type { UnitPreviewInput } from '@ss/contracts';
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
 * Free previews the admin chooses: per unit, one file and up to five of its pages. The public
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

  /** Choose a unit's free preview. `fileId: null` goes back to the default (page 1 of the first file). */
  async choose(courseId: string, unitKey: string, input: UnitPreviewInput) {
    const pages = [...new Set(input.pages)].sort((a, b) => a - b);
    if (input.fileId) {
      const file = await this.writer.findAnyFile(input.fileId);
      if (!file || file.courseId !== courseId || file.unitKey !== unitKey)
        throw fail.badRequest('Pick a file from this unit.');
      if (!isReaderReady(file)) throw fail.badRequest('That file has no pages yet. Make its pages first.');
      const tooFar = pages.filter((n) => n > file.pageCount);
      if (tooFar.length)
        throw fail.badRequest(`That file has ${file.pageCount} pages; page ${tooFar[0]} doesn’t exist.`);
    }
    const ok = await this.writer.setUnitPreview(courseId, unitKey, input.fileId, input.fileId ? pages : [1]);
    if (!ok) throw fail.notFound('That unit');
    return { fileId: input.fileId, pages: input.fileId ? pages : [1] };
  }
}
