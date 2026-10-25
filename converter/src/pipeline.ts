import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  BROKEN_SOURCE,
  type ConversionProgressReport,
  type ConversionReport,
  type ConversionStage,
} from '@ss/contracts';
import { renderPreview } from './preview';
import { scramblePage } from './scramble';
import { tileSeed } from './seed';

const run = promisify(execFile);

// ── Ports ──

export interface Job {
  fileId: string;
  sourceKey: string;
  queueId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

export interface Storage {
  download(key: string): Promise<Buffer>;
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  deletePrefix(prefix: string): Promise<void>;
}

/** An opened document whose pages can be rendered a few at a time. */
export interface PageSource {
  pageCount: number;
  /** PNG buffers for pages from..to (1-based, inclusive), in order. */
  renderRange(from: number, to: number): Promise<Buffer[]>;
}

export interface Rasterizer {
  /** Preferred: open once, then render small page ranges so memory stays flat. */
  open?(source: Buffer, fileName: string, workDir: string): Promise<PageSource>;
  /** Legacy whole-document render, still accepted (test doubles, simple adapters). */
  toPages?(source: Buffer, fileName: string, workDir: string): Promise<Buffer[]>;
}

async function openPages(
  rasterizer: Rasterizer,
  source: Buffer,
  fileName: string,
  workDir: string,
): Promise<PageSource> {
  if (rasterizer.open) return rasterizer.open(source, fileName, workDir);
  if (!rasterizer.toPages) throw new Error('Rasterizer cannot render pages.');
  const pages = await rasterizer.toPages(source, fileName, workDir);
  return { pageCount: pages.length, renderRange: async (from, to) => pages.slice(from - 1, to) };
}

export interface Reporter {
  report(report: ConversionReport): Promise<void>;
  progress?(progress: ConversionProgressReport): Promise<void>;
}

// ── Source check ──

export { BROKEN_SOURCE };

/**
 * What the bytes really are, whatever the name says. Google Drive exports that hit a sign-in
 * page save HTML under the original file name; those can never be converted.
 */
export function sniff(source: Buffer, fileName: string): void {
  const head = source.subarray(0, 1024).toString('latin1');
  const ext = extname(fileName).toLowerCase();
  if (/^\s*<(!doctype|html|head)/i.test(head) || head.includes('accounts.google.com')) {
    throw new Error(
      `${BROKEN_SOURCE} this "${ext.slice(1)}" is really a web page (a Google sign-in page saved instead of the file). Download it from Drive again and re-upload it to R2.`,
    );
  }
  if (source.length === 0) throw new Error(`${BROKEN_SOURCE} the file is empty. Re-upload it to R2.`);
  const isPdf = head.includes('%PDF');
  const isZip = head.startsWith('PK');
  const isOle = source[0] === 0xd0 && source[1] === 0xcf;
  if (ext === '.pdf' && !isPdf)
    throw new Error(`${BROKEN_SOURCE} the file is not a PDF inside. Re-export it and re-upload it to R2.`);
  if (['.pptx', '.ppsx', '.docx'].includes(ext) && !isZip && !isOle)
    throw new Error(`${BROKEN_SOURCE} the file is not an Office document inside. Re-upload it to R2.`);
}

// ── Adapters ──

const OFFICE = new Set(['.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.doc', '.docx', '.odt', '.txt']);
const IMAGE = new Set(['.jpg', '.jpeg', '.png']);

/** LibreOffice for office files, poppler's pdftoppm for PDFs, images pass straight through. */
export class CliRasterizer implements Rasterizer {
  constructor(private readonly dpi = 150) {}

  async open(source: Buffer, fileName: string, workDir: string): Promise<PageSource> {
    const ext = extname(fileName).toLowerCase();
    const extensionlessPdf = !ext && source.subarray(0, 5).toString('latin1') === '%PDF-';
    await mkdir(workDir, { recursive: true });
    if (IMAGE.has(ext)) return { pageCount: 1, renderRange: async () => [source] };

    let pdfPath = join(workDir, 'input.pdf');
    if (OFFICE.has(ext)) {
      const officePath = join(workDir, `input${ext}`);
      await writeFile(officePath, source);
      // A profile per job, so several conversions can run side by side.
      const profile = `-env:UserInstallation=${pathToFileURL(join(workDir, 'lo-profile')).href}`;
      await run('soffice', [profile, '--headless', '--convert-to', 'pdf', '--outdir', workDir, officePath], {
        timeout: 180_000,
      });
      await rm(officePath, { force: true });
      pdfPath = join(workDir, `${basename(officePath, ext)}.pdf`);
    } else if (ext === '.pdf' || extensionlessPdf) {
      await writeFile(pdfPath, source);
    } else {
      throw new Error(`Unsupported file type ${ext}`);
    }

    // Read the page count independently so a partial render can never be published as ready.
    const { stdout: pdfInfo } = await run('pdfinfo', [pdfPath], { timeout: 30_000 });
    const expectedPages = Number(/^Pages:\s+(\d+)\s*$/im.exec(pdfInfo)?.[1]);
    if (!Number.isInteger(expectedPages) || expectedPages < 1) {
      throw new Error('Could not verify the source document page count; conversion was not published.');
    }

    const dpi = this.dpi;
    return {
      pageCount: expectedPages,
      async renderRange(from: number, to: number): Promise<Buffer[]> {
        const chunkDir = join(workDir, `chunk-${from}`);
        await mkdir(chunkDir, { recursive: true });
        try {
          await run(
            'pdftoppm',
            [
              '-r',
              String(dpi),
              '-png',
              '-f',
              String(from),
              '-l',
              String(to),
              pdfPath,
              join(chunkDir, 'page'),
            ],
            { timeout: 300_000 },
          );
          const files = (await readdir(chunkDir)).filter((f) => /^page-\d+\.png$/.test(f));
          const numbers = files.map((f) => Number(/page-(\d+)\.png$/.exec(f)![1])).sort((a, b) => a - b);
          const want = Array.from({ length: to - from + 1 }, (_, i) => from + i);
          if (numbers.length !== want.length || numbers.some((n, i) => n !== want[i])) {
            throw new Error(
              `Page verification failed: expected pages ${from}-${to} of ${expectedPages} but rendered ${numbers.join(', ') || 'none'}.`,
            );
          }
          const byNumber = new Map(files.map((f) => [Number(/page-(\d+)\.png$/.exec(f)![1]), f]));
          return await Promise.all(want.map((n) => readFile(join(chunkDir, byNumber.get(n)!))));
        } finally {
          await rm(chunkDir, { recursive: true, force: true });
        }
      },
    };
  }
}

export class HttpReporter implements Reporter {
  constructor(
    private readonly url: string,
    private readonly secret: string,
  ) {}
  async report(report: ConversionReport): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ss-converter': this.secret },
      body: JSON.stringify(report),
    });
    if (!res.ok) throw new Error(`Callback failed with HTTP ${res.status}.`);
  }

  async progress(progress: ConversionProgressReport): Promise<void> {
    const progressUrl = new URL(this.url);
    progressUrl.pathname = progressUrl.pathname.replace(
      /\/internal\/conversion\/?$/,
      '/internal/conversion-progress',
    );
    const res = await fetch(progressUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ss-converter': this.secret },
      body: JSON.stringify(progress),
    });
    if (!res.ok) throw new Error(`Progress callback failed with HTTP ${res.status}.`);
  }
}

// ── Use case ──

export class ConvertPages {
  constructor(
    private readonly storage: Storage,
    private readonly rasterizer: Rasterizer,
    private readonly reporter: Reporter,
    private readonly seedSecret: string,
    private readonly workRoot: string,
    private readonly pageConcurrency = 4,
    /** Pages rendered per pdftoppm call; bounds memory to roughly this many PNGs. */
    private readonly chunkSize = 8,
    private readonly progressIntervalMs = 1000,
  ) {}

  async run(job: Job): Promise<ConversionReport> {
    const workDir = join(this.workRoot, job.fileId);
    let activeStage: NonNullable<ConversionReport['errorStage']> = 'downloading_source';
    let progressWrites: Promise<void> = Promise.resolve();
    let lastSentAt = 0;
    let lastSentStage: ConversionStage | null = null;
    const progress = (stage: ConversionStage, current = 0, total = 0) => {
      activeStage = stage as NonNullable<ConversionReport['errorStage']>;
      if (!job.queueId || !job.queuePosition || !job.queueTotal || !this.reporter.progress)
        return progressWrites;
      // One callback per page would hammer the API on long documents: send stage changes,
      // the final count, and otherwise at most one update per interval.
      const now = Date.now();
      const due = stage !== lastSentStage || current === total || now - lastSentAt >= this.progressIntervalMs;
      if (!due) return progressWrites;
      lastSentAt = now;
      lastSentStage = stage;
      const report: ConversionProgressReport = {
        fileId: job.fileId,
        queueId: job.queueId,
        queuePosition: job.queuePosition,
        queueTotal: job.queueTotal,
        stage,
        current,
        total,
      };
      // Ordered, and best-effort: a dropped progress update must never fail the conversion.
      progressWrites = progressWrites
        .then(() => this.reporter.progress!(report))
        .catch((error: unknown) => {
          console.warn(`progress update skipped for ${job.fileId}: ${(error as Error).message}`);
        });
      return progressWrites;
    };
    try {
      await progress('downloading_source');
      const source = await this.storage.download(job.sourceKey);
      await progress('validating_source');
      sniff(source, basename(job.sourceKey));
      await progress('rendering_pages', 0, 0);
      const doc = await openPages(this.rasterizer, source, basename(job.sourceKey), workDir);
      const total = doc.pageCount;
      if (total === 0) throw new Error('No pages produced');
      await progress('rendering_pages', 0, total);
      const pages: ConversionReport['pages'] = [];
      const previewKey = `pages/${job.fileId}/preview.webp`;
      await progress('clearing_previous_pages');
      await this.storage.deletePrefix(`pages/${job.fileId}/`);

      // Render a few pages, ship them to R2, drop them from memory, repeat.
      let written = 0;
      for (let from = 1; from <= total; from += this.chunkSize) {
        const to = Math.min(total, from + this.chunkSize - 1);
        activeStage = 'rendering_pages';
        const pngs = await doc.renderRange(from, to);
        if (pngs.length !== to - from + 1) {
          throw new Error(`Page verification failed: expected ${to - from + 1} pages for ${from}-${to}.`);
        }
        if (from === 1) {
          await progress('writing_preview', 0, 1);
          await this.storage.upload(previewKey, await renderPreview(pngs[0]!), 'image/webp');
          await progress('writing_preview', 1, 1);
        }
        let next = 0;
        let workerError: unknown;
        const worker = async () => {
          try {
            while (!workerError && next < pngs.length) {
              const i = next++;
              const pageNo = from + i;
              const seed = tileSeed(this.seedSecret, job.fileId, pageNo);
              const imageKey = `pages/${job.fileId}/${pageNo}.webp`;
              await this.storage.upload(imageKey, await scramblePage(pngs[i]!, seed), 'image/webp');
              pngs[i] = Buffer.alloc(0);
              pages[pageNo - 1] = { pageNo, imageKey, tileSeed: seed };
              written++;
              await progress('writing_pages', written, total);
            }
          } catch (error) {
            workerError ??= error;
          }
        };
        activeStage = 'writing_pages';
        await Promise.all(Array.from({ length: Math.min(this.pageConcurrency, pngs.length) }, worker));
        if (workerError) throw workerError;
      }
      await progress('verifying_r2', 0, pages.length + 1);
      const keys = [previewKey, ...pages.map((page) => page.imageKey)];
      let verified = 0;
      for (let offset = 0; offset < keys.length; offset += 10) {
        const batch = keys.slice(offset, offset + 10);
        const present = await Promise.all(batch.map((key) => this.storage.exists(key)));
        const missing = batch.filter((_key, index) => !present[index]);
        if (missing.length) throw new Error(`R2 verification failed: missing ${missing.join(', ')}.`);
        verified += batch.length;
        await progress('verifying_r2', verified, keys.length);
      }
      await progress('saving_manifest', 0, 1);
      const report: ConversionReport = {
        fileId: job.fileId,
        ...(job.queueId ? { queueId: job.queueId } : {}),
        ...(job.queuePosition ? { queuePosition: job.queuePosition } : {}),
        ...(job.queueTotal ? { queueTotal: job.queueTotal } : {}),
        status: 'ready',
        pages,
        previewKey,
      };
      await this.reporter.report(report);
      return report;
    } catch (e) {
      await progressWrites.catch(() => {});
      let error = (e as Error).message;
      try {
        await this.storage.deletePrefix(`pages/${job.fileId}/`);
      } catch (cleanupError) {
        error = `${error} R2 cleanup also failed: ${(cleanupError as Error).message}`;
      }
      const report: ConversionReport = {
        fileId: job.fileId,
        ...(job.queueId ? { queueId: job.queueId } : {}),
        ...(job.queuePosition ? { queuePosition: job.queuePosition } : {}),
        ...(job.queueTotal ? { queueTotal: job.queueTotal } : {}),
        status: 'failed',
        error: error.slice(0, 480),
        errorStage: activeStage,
        pages: [],
      };
      await this.reporter.report(report);
      return report;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
