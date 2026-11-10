import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversionProgressReport, ConversionReport } from '@ss/contracts';
import { TILE_GRID, unscrambleMoves } from '@ss/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderDemoPage } from './demo-page';
import { CliRasterizer, ConversionOwnershipLost, ConvertPages, type Storage } from './pipeline';
import { renderPreview } from './preview';
import { scramblePage } from './scramble';
import { tileSeed } from './seed';

class MapStorage implements Storage {
  objects = new Map<string, Buffer>();
  async download(key: string) {
    const b = this.objects.get(key);
    if (!b) throw new Error(`missing ${key}`);
    return b;
  }
  async upload(key: string, body: Buffer, _contentType?: string) {
    this.objects.set(key, body);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) this.objects.delete(key);
  }
}

const hasTool = (cmd: string) => {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [cmd]);
    return true;
  } catch {
    return false;
  }
};

describe('scramblePage', () => {
  it('scrambles and the reader maths restores the original', async () => {
    const page = await renderDemoPage({
      courseTitle: 'DBMS',
      unitTitle: 'Normalisation',
      fileName: 'n.pdf',
      pageNo: 1,
      pageCount: 3,
    });
    const seed = tileSeed('test-secret-123456', 'file-1', 1);
    const scrambled = await scramblePage(page, seed, { maxWidth: 640 });
    const meta = await sharp(scrambled).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width! % TILE_GRID).toBe(0);
    expect(meta.height! % TILE_GRID).toBe(0);

    // Restore with the same moves the browser uses, then compare to a resized original.
    const tileW = meta.width! / TILE_GRID;
    const tileH = meta.height! / TILE_GRID;
    const restored = await sharp({
      create: { width: meta.width!, height: meta.height!, channels: 3, background: '#fff' },
    })
      .composite(
        await Promise.all(
          unscrambleMoves(seed).map(async (m) => ({
            input: await sharp(scrambled)
              .extract({ left: m.fromCol * tileW, top: m.fromRow * tileH, width: tileW, height: tileH })
              .png()
              .toBuffer(),
            left: m.toCol * tileW,
            top: m.toRow * tileH,
          })),
        ),
      )
      .png()
      .toBuffer()
      .then((b) => sharp(b).removeAlpha().raw().toBuffer());
    const original = await sharp(page)
      .flatten({ background: '#fff' })
      .resize(meta.width!, meta.height!, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();
    const scrambledRaw = await sharp(scrambled).removeAlpha().raw().toBuffer();

    const diff = (a: Buffer, b: Buffer) => {
      let d = 0;
      for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
      return d / a.length;
    };
    expect(diff(restored, original)).toBeLessThan(6); // only WebP compression noise
    expect(restored.length).toBe(original.length);
    expect(diff(scrambledRaw, original)).toBeGreaterThan(diff(restored, original) * 3);
  });
});

describe('renderPreview', () => {
  it('makes a smaller, unscrambled, stamped copy of page 1', async () => {
    const page = await renderDemoPage({
      courseTitle: 'DBMS',
      unitTitle: 'Normalisation',
      fileName: 'n.pdf',
      pageNo: 1,
      pageCount: 3,
    });
    const out = await renderPreview(page);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 760 });
    // Close to the original (not scrambled) apart from the stamp.
    const a = await sharp(out).resize(76, 107, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const b = await sharp(page).resize(76, 107, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
    expect(d / a.length).toBeLessThan(30);
  });
});

describe('ConvertPages', () => {
  it('removes stale outputs and verifies every new R2 page before saving the manifest', async () => {
    const storage = new MapStorage();
    const page = await renderDemoPage({
      courseTitle: 'T',
      unitTitle: 'Module 1',
      fileName: 'scan.png',
      pageNo: 1,
      pageCount: 1,
    });
    storage.objects.set('drive-imports/course/scan.png', page);
    storage.objects.set('pages/file-ordered/preview.webp', Buffer.from('stale preview'));
    storage.objects.set('pages/file-ordered/9.webp', Buffer.from('stale page'));
    const reports: ConversionReport[] = [];
    const convert = new ConvertPages(
      storage,
      { toPages: async () => [page] },
      { report: async (report) => void reports.push(report) },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-ordered-convert-')),
    );

    const result = await convert.run({
      fileId: 'file-ordered',
      sourceKey: 'drive-imports/course/scan.png',
      queueId: '8f05b90a-221e-47cf-a2de-110d50f2aa53',
      queuePosition: 1,
      queueTotal: 1,
    });

    expect(result.status).toBe('ready');
    expect(await storage.exists('pages/file-ordered/preview.webp')).toBe(true);
    expect(await storage.exists('pages/file-ordered/1.webp')).toBe(true);
    expect(await storage.exists('pages/file-ordered/9.webp')).toBe(false);
    expect(reports).toEqual([result]);
  });

  it('marks an R2 object verification failure at the correct stage and removes partial page objects', async () => {
    const storage = new MapStorage();
    const page = await renderDemoPage({
      courseTitle: 'T',
      unitTitle: 'Module 1',
      fileName: 'scan.png',
      pageNo: 1,
      pageCount: 1,
    });
    storage.objects.set('drive-imports/course/scan.png', page);
    const exists = storage.exists.bind(storage);
    storage.exists = async (key) => (key.endsWith('/1.webp') ? false : exists(key));
    const reports: ConversionReport[] = [];
    const convert = new ConvertPages(
      storage,
      { toPages: async () => [page] },
      { report: async (report) => void reports.push(report) },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-r2-check-')),
    );

    const result = await convert.run({ fileId: 'missing-page', sourceKey: 'drive-imports/course/scan.png' });

    expect(result).toMatchObject({ status: 'failed', errorStage: 'verifying_r2' });
    expect(result.error).toContain('R2 verification failed');
    expect([...storage.objects.keys()].some((key) => key.startsWith('pages/missing-page/'))).toBe(false);
    expect(reports).toEqual([result]);
  });

  it.skipIf(!hasTool('pdftoppm') || !hasTool('pdfinfo') || !hasTool('soffice'))(
    'converts a real PDF into scrambled pages and reports them',
    async () => {
      const work = mkdtempSync(join(tmpdir(), 'ss-conv-'));
      // Build a real PDF with LibreOffice from a rendered page, then convert it back.
      const storage = new MapStorage();
      const png = await renderDemoPage({
        courseTitle: 'T',
        unitTitle: 'Normalisation',
        fileName: 'x',
        pageNo: 1,
        pageCount: 1,
      });
      const src = mkdtempSync(join(tmpdir(), 'ss-src-'));
      writeFileSync(join(src, 'scan.png'), png);
      execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', src, join(src, 'scan.png')], {
        timeout: 120_000,
      });
      storage.objects.set('drive-imports/25 Batch/DBMS/Unit 1/scan.pdf', readFileSync(join(src, 'scan.pdf')));
      const reports: ConversionReport[] = [];
      const progressReports: ConversionProgressReport[] = [];
      const convert = new ConvertPages(
        storage,
        new CliRasterizer(60),
        {
          report: async (r) => void reports.push(r),
          progress: async (r) => void progressReports.push(r),
        },
        'secret-secret-secret',
        work,
      );
      const r = await convert.run({
        fileId: 'f1',
        sourceKey: 'drive-imports/25 Batch/DBMS/Unit 1/scan.pdf',
        queueId: '8f05b90a-221e-47cf-a2de-110d50f2aa53',
        queuePosition: 1,
        queueTotal: 1,
      });
      expect(r.status).toBe('ready');
      expect(r.queueId).toBe('8f05b90a-221e-47cf-a2de-110d50f2aa53');
      expect(r.pages).toHaveLength(1);
      expect(storage.objects.has('pages/f1/1.webp')).toBe(true);
      expect(r.previewKey).toBe('pages/f1/preview.webp');
      const preview = await sharp(storage.objects.get('pages/f1/preview.webp')!).metadata();
      expect(preview).toMatchObject({ format: 'webp', width: 760 });
      expect(r.pages[0]!.tileSeed).toBe(tileSeed('secret-secret-secret', 'f1', 1));
      expect(reports).toHaveLength(1);
      expect(progressReports.map((report) => report.stage)).toEqual(
        expect.arrayContaining([
          'downloading_source',
          'validating_source',
          'rendering_pages',
          'writing_preview',
          'writing_pages',
          'verifying_r2',
          'saving_manifest',
        ]),
      );
      expect([...progressReports].reverse().find((report) => report.stage === 'writing_pages')).toMatchObject(
        {
          current: 1,
          total: 1,
        },
      );
    },
    180_000,
  );

  it('renders long documents in small chunks and reports every written page', async () => {
    const storage = new MapStorage();
    const page = await renderDemoPage({
      courseTitle: 'T',
      unitTitle: 'Module 1',
      fileName: 'long.pdf',
      pageNo: 1,
      pageCount: 20,
    });
    storage.objects.set('drive-imports/course/long.pdf', Buffer.from('%PDF-1.7 fake'));
    const ranges: [number, number][] = [];
    const progressReports: ConversionProgressReport[] = [];
    const convert = new ConvertPages(
      storage,
      {
        open: async () => ({
          pageCount: 20,
          renderRange: async (from, to) => {
            ranges.push([from, to]);
            return Array.from({ length: to - from + 1 }, () => page);
          },
        }),
      },
      { report: async () => {}, progress: async (r) => void progressReports.push(r) },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-chunks-')),
      2,
      8,
      0,
    );
    const result = await convert.run({
      fileId: 'long-file',
      sourceKey: 'drive-imports/course/long.pdf',
      queueId: '8f05b90a-221e-47cf-a2de-110d50f2aa53',
      queuePosition: 1,
      queueTotal: 1,
    });
    expect(result.status).toBe('ready');
    expect(result.pages.map((p) => p.pageNo)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(ranges).toEqual([
      [1, 8],
      [9, 16],
      [17, 20],
    ]);
    const written = progressReports.filter((r) => r.stage === 'writing_pages').map((r) => r.current);
    expect(written).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(progressReports.every((r) => r.stage !== 'writing_pages' || r.total === 20)).toBe(true);
  }, 30_000);

  it('writes generated page objects in page-number order', async () => {
    const storage = new MapStorage();
    const page = await renderDemoPage({
      courseTitle: 'T',
      unitTitle: 'Module 1',
      fileName: 'ordered.pdf',
      pageNo: 1,
      pageCount: 3,
    });
    storage.objects.set('drive-imports/course/ordered.pdf', Buffer.from('%PDF-1.7 fake'));
    const written: string[] = [];
    const upload = storage.upload.bind(storage);
    storage.upload = async (key, body, contentType) => {
      const match = /^pages\/ordered\/(\d+)\.webp$/.exec(key);
      if (match) {
        await new Promise((resolve) => setTimeout(resolve, 4 - Number(match[1])));
        written.push(key);
      }
      await upload(key, body, contentType);
    };
    const convert = new ConvertPages(
      storage,
      {
        open: async () => ({
          pageCount: 3,
          renderRange: async (from, to) => Array.from({ length: to - from + 1 }, () => page),
        }),
      },
      { report: async () => {} },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-page-order-')),
    );

    const result = await convert.run({ fileId: 'ordered', sourceKey: 'drive-imports/course/ordered.pdf' });

    expect(result.status).toBe('ready');
    expect(written).toEqual(['pages/ordered/1.webp', 'pages/ordered/2.webp', 'pages/ordered/3.webp']);
  });

  it('aborts an active render promptly when its file is paused', async () => {
    const storage = new MapStorage();
    storage.objects.set('drive-imports/course/paused.pdf', Buffer.from('%PDF-1.7 fake'));
    let current = true;
    let opened = false;
    let aborted = false;
    let signalOpen!: () => void;
    const openStarted = new Promise<void>((resolve) => {
      signalOpen = resolve;
    });
    const convert = new ConvertPages(
      storage,
      {
        open: async (_source, _fileName, _workDir, signal) => {
          opened = true;
          signalOpen();
          await new Promise<never>((_resolve, reject) => {
            signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(new Error('Render was cancelled.'));
              },
              { once: true },
            );
          });
          return { pageCount: 1, renderRange: async () => [] };
        },
      },
      { report: async () => {}, isCurrent: async () => current },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-pause-render-')),
    );
    const running = convert.run({
      fileId: 'paused-file',
      sourceKey: 'drive-imports/course/paused.pdf',
      queueId: '8f05b90a-221e-47cf-a2de-110d50f2aa53',
      queuePosition: 1,
      queueTotal: 2,
    });

    await openStarted;
    current = false;
    await expect(running).rejects.toBeInstanceOf(ConversionOwnershipLost);
    expect(opened).toBe(true);
    expect(aborted).toBe(true);
  }, 10_000);

  it('keeps converting when a progress callback fails', async () => {
    const storage = new MapStorage();
    const page = await renderDemoPage({
      courseTitle: 'T',
      unitTitle: 'Module 1',
      fileName: 'scan.png',
      pageNo: 1,
      pageCount: 1,
    });
    storage.objects.set('drive-imports/course/scan.png', page);
    const convert = new ConvertPages(
      storage,
      { toPages: async () => [page] },
      {
        report: async () => {},
        progress: async () => {
          throw new Error('API asleep');
        },
      },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-progress-fail-')),
    );
    const result = await convert.run({
      fileId: 'resilient',
      sourceKey: 'drive-imports/course/scan.png',
      queueId: '8f05b90a-221e-47cf-a2de-110d50f2aa53',
      queuePosition: 1,
      queueTotal: 1,
    });
    expect(result.status).toBe('ready');
  });

  it('stops between page chunks when a job is paused or superseded', async () => {
    const storage = new MapStorage();
    const page = Buffer.from('%PDF-1.7 fake');
    storage.objects.set('drive-imports/course/large.pdf', page);
    const reports: ConversionReport[] = [];
    let ownershipChecks = 0;
    const convert = new ConvertPages(
      storage,
      {
        open: async () => ({
          pageCount: 20,
          renderRange: async (from, to) => Array.from({ length: to - from + 1 }, () => page),
        }),
      },
      {
        report: async (r) => void reports.push(r),
        isCurrent: async () => ++ownershipChecks < 5,
      },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-conversion-paused-')),
    );

    await expect(
      convert.run({
        fileId: 'paused-large-file',
        sourceKey: 'drive-imports/course/large.pdf',
        queueId: '8f05b90a-221e-47cf-a2de-110d50f2aa53',
        queuePosition: 1,
        queueTotal: 1,
      }),
    ).rejects.toBeInstanceOf(ConversionOwnershipLost);
    expect([...storage.objects.keys()].some((key) => key.startsWith('pages/paused-large-file/'))).toBe(false);
    expect(reports).toEqual([]);
  });

  it('reports a failure instead of crashing on unsupported files', async () => {
    const storage = new MapStorage();
    storage.objects.set('a/b.heic', Buffer.from('x'));
    const reports: ConversionReport[] = [];
    const convert = new ConvertPages(
      storage,
      new CliRasterizer(),
      { report: async (r) => void reports.push(r) },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-')),
    );
    const r = await convert.run({ fileId: 'f2', sourceKey: 'a/b.heic' });
    expect(r.status).toBe('failed');
    expect(reports[0]!.error).toMatch(/Unsupported/);
  });
});

describe('source check', () => {
  it('spots Google sign-in pages saved as PDFs, and empty or mislabelled files', async () => {
    const { sniff, BROKEN_SOURCE } = await import('./pipeline');
    const html = Buffer.from(
      '<!doctype html><html><head><base href="https://accounts.google.com/v3/signin/">',
    );
    expect(() => sniff(html, 'DBMS Tee(1).pdf')).toThrow(BROKEN_SOURCE);
    expect(() => sniff(Buffer.alloc(0), 'a.pdf')).toThrow(/empty/);
    expect(() => sniff(Buffer.from('hello world'), 'a.pdf')).toThrow(/not a PDF/);
    expect(() => sniff(Buffer.from('%PDF-1.7\n...'), 'a.pdf')).not.toThrow();
    expect(() => sniff(Buffer.from('%PDF-1.7\n...'), 'Syllabus')).not.toThrow();
    expect(() => sniff(Buffer.from('PK\u0003\u0004....'), 'a.pptx')).not.toThrow();
  });

  it('never publishes a Google sign-in response mislabeled as a PowerPoint', async () => {
    const storage = new MapStorage();
    storage.objects.set(
      'drive-imports/23 Batch/Physics/Module 2/mod2.pptx',
      Buffer.from('<!doctype html><html><base href="https://accounts.google.com/">'),
    );
    const reports: ConversionReport[] = [];
    const convert = new ConvertPages(
      storage,
      new CliRasterizer(),
      { report: async (report) => void reports.push(report) },
      'secret-secret-secret',
      mkdtempSync(join(tmpdir(), 'ss-invalid-pptx-')),
    );

    const result = await convert.run({
      fileId: 'bad-pptx',
      sourceKey: 'drive-imports/23 Batch/Physics/Module 2/mod2.pptx',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Google sign-in page');
    expect(result.errorStage).toBe('validating_source');
    expect(result.pages).toEqual([]);
    expect(reports).toEqual([result]);
    expect(storage.objects.has('pages/bad-pptx/preview.webp')).toBe(false);
  });
});
