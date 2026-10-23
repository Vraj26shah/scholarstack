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

export interface Rasterizer {
  /** Returns PNG buffers, one per page, in order. */
  toPages(source: Buffer, fileName: string, workDir: string): Promise<Buffer[]>;
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

  async toPages(source: Buffer, fileName: string, workDir: string): Promise<Buffer[]> {
    const ext = extname(fileName).toLowerCase();
    const extensionlessPdf = !ext && source.subarray(0, 5).toString('latin1') === '%PDF-';
    await mkdir(workDir, { recursive: true });
    if (IMAGE.has(ext)) return [source];

    let pdfPath = join(workDir, 'input.pdf');
    if (OFFICE.has(ext)) {
      const officePath = join(workDir, `input${ext}`);
      await writeFile(officePath, source);
      // A profile per job, so several conversions can run side by side.
      const profile = `-env:UserInstallation=${pathToFileURL(join(workDir, 'lo-profile')).href}`;
      await run('soffice', [profile, '--headless', '--convert-to', 'pdf', '--outdir', workDir, officePath], {
        timeout: 180_000,
      });
      pdfPath = join(workDir, `${basename(officePath, ext)}.pdf`);
    } else if (ext === '.pdf' || extensionlessPdf) {
      await writeFile(pdfPath, source);
    } else {
      throw new Error(`Unsupported file type ${ext}`);
    }

    // Do not publish a partial render as a ready file. Read the source PDF's page count
    // independently, then compare it with the complete set of rasterized pages.
    const { stdout: pdfInfo } = await run('pdfinfo', [pdfPath], { timeout: 30_000 });
    const pageCount = /^Pages:\s+(\d+)\s*$/im.exec(pdfInfo)?.[1];
    const expectedPages = Number(pageCount);
    if (!Number.isInteger(expectedPages) || expectedPages < 1) {
      throw new Error('Could not verify the source document page count; conversion was not published.');
    }

    await run('pdftoppm', ['-r', String(this.dpi), '-png', pdfPath, join(workDir, 'page')], {
      timeout: 300_000,
    });
    const pages = (await readdir(workDir)).filter((f) => /^page-\d+\.png$/.test(f));
    pages.sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const pageNumbers = pages.map((file) => Number(/page-(\d+)\.png$/.exec(file)![1]));
    const completeSequence = pageNumbers.every((pageNo, index) => pageNo === index + 1);
    if (pages.length !== expectedPages || !completeSequence) {
      throw new Error(
        `Page verification failed: source has ${expectedPages} pages but rendered pages are ${pageNumbers.join(', ') || 'none'}.`,
      );
    }
    return Promise.all(pages.map((p) => readFile(join(workDir, p))));
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
    private readonly pageConcurrency = 6,
  ) {}

  async run(job: Job): Promise<ConversionReport> {
    const workDir = join(this.workRoot, job.fileId);
    let activeStage: NonNullable<ConversionReport['errorStage']> = 'downloading_source';
    let progressWrites: Promise<void> = Promise.resolve();
    const progress = (stage: ConversionStage, current = 0, total = 0) => {
      activeStage = stage as NonNullable<ConversionReport['errorStage']>;
      if (!job.queueId || !job.queuePosition || !job.queueTotal || !this.reporter.progress)
        return progressWrites;
      const report: ConversionProgressReport = {
        fileId: job.fileId,
        queueId: job.queueId,
        queuePosition: job.queuePosition,
        queueTotal: job.queueTotal,
        stage,
        current,
        total,
      };
      // Keep page-count updates ordered even while R2 writes run concurrently.
      progressWrites = progressWrites.then(() => this.reporter.progress!(report));
      return progressWrites;
    };
    try {
      await progress('downloading_source');
      const source = await this.storage.download(job.sourceKey);
      await progress('validating_source');
      sniff(source, basename(job.sourceKey));
      await progress('rendering_pages');
      const pngs = await this.rasterizer.toPages(source, basename(job.sourceKey), workDir);
      if (pngs.length === 0) throw new Error('No pages produced');
      const pages: ConversionReport['pages'] = [];
      const previewKey = `pages/${job.fileId}/preview.webp`;
      await progress('clearing_previous_pages');
      await this.storage.deletePrefix(`pages/${job.fileId}/`);
      await progress('writing_preview', 0, 1);
      await this.storage.upload(previewKey, await renderPreview(pngs[0]!), 'image/webp');
      await progress('writing_preview', 1, 1);
      await progress('writing_pages', 0, pngs.length);
      // Page writes are network-bound; the serial progress callback reports verified completions.
      let next = 0;
      let written = 0;
      let workerError: unknown;
      const worker = async () => {
        try {
          while (!workerError && next < pngs.length) {
            const i = next++;
            const pageNo = i + 1;
            const seed = tileSeed(this.seedSecret, job.fileId, pageNo);
            const imageKey = `pages/${job.fileId}/${pageNo}.webp`;
            await this.storage.upload(imageKey, await scramblePage(pngs[i]!, seed), 'image/webp');
            pages[i] = { pageNo, imageKey, tileSeed: seed };
            written++;
            if (written === pngs.length || written % 5 === 0) {
              await progress('writing_pages', written, pngs.length);
            }
          }
        } catch (error) {
          workerError ??= error;
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.pageConcurrency, pngs.length) }, worker));
      if (workerError) throw workerError;
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
