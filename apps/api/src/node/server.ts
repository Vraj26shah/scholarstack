/**
 * Demo server: the real API (same routes, same use cases) on Node with in-memory adapters,
 * sample courses, a stand-in login and a stand-in payment gateway. No accounts needed.
 *   pnpm dev:demo            → API on :8787 (the web dev server proxies /api here)
 *   WEB_DIST=../web/dist     → also serves the built website (used by end-to-end tests)
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { renderDemoPage } from '@ss/converter/demo-page';
import { renderPreview } from '@ss/converter/preview';
import { scramblePage } from '@ss/converter/scramble';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { memoryContainer } from '../composition/memory';
import { createApp } from '../http/app';
import type { MemoryDb } from '../infrastructure/memory';

let dbRef: MemoryDb | null = null;
let seederRef: { seedFor(f: string, n: number): Promise<string> } | null = null;
const pageCache = new Map<string, Uint8Array>();

async function producePage(key: string): Promise<Uint8Array | null> {
  const m = /^pages\/([^/]+)\/(\d+|preview)\.webp$/.exec(key);
  if (!m || !dbRef || !seederRef) return null;
  const cached = pageCache.get(key);
  if (cached) return cached;
  const file = dbRef.files.get(m[1]!);
  const isPreview = m[2] === 'preview';
  const pageNo = isPreview ? 1 : Number(m[2]);
  if (!file || pageNo < 1 || pageNo > Math.max(file.pageCount, 1)) return null;
  const course = dbRef.courses.get(file.courseId);
  const png = await renderDemoPage({
    courseTitle: course?.title ?? '',
    unitTitle: file.unitTitle,
    fileName: file.name,
    pageNo,
    pageCount: Math.max(file.pageCount, 1),
  });
  const webp = new Uint8Array(
    isPreview
      ? await renderPreview(png, { width: 640 })
      : await scramblePage(png, await seederRef.seedFor(file.id, pageNo), { maxWidth: 1000 }),
  );
  pageCache.set(key, webp);
  return webp;
}

const { container, db, seeder, sources } = memoryContainer({
  seed: true,
  pageProducer: producePage,
  conversionPageMs: Number(process.env.DEMO_CONVERT_PAGE_MS ?? 0),
});
dbRef = db;
seederRef = seeder;

// DEMO_DRIFT=1: make R2 differ from the database (one new, one edited, one deleted file in
// DBMS) so the admin "Check storage" step has something to show. Demo server only.
if (process.env.DEMO_DRIFT === '1') {
  const dbms = [...db.courses.values()].find((course) => course.slug === 'dbms-2025-cse-core');
  const files = [...db.files.values()].filter((file) => file.courseId === dbms?.id && !file.hidden);
  if (dbms && files.length >= 3) {
    const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.7\n${text}\n`);
    sources.put(
      `${dbms.r2Prefix}Unit 6 - NoSQL/NoSQL-overview.pdf`,
      pdf('new upload'),
      'application/pdf',
      'demo-new',
    );
    sources.put(files[1]!.sourceKey, pdf('re-uploaded with fixes'), 'application/pdf', 'demo-edited');
    void sources.delete(files[2]!.sourceKey);
  }
}

// DEMO_BULK=N: add N extra files to R2 (half new inside DBMS, half in folders no course owns)
// to see how the admin panel copes with a big library. Demo server only.
const bulk = Number(process.env.DEMO_BULK ?? 0);
if (bulk > 0) {
  const dbms = [...db.courses.values()].find((course) => course.slug === 'dbms-2025-cse-core');
  const body = new TextEncoder().encode('%PDF-1.7\nbulk\n');
  for (let i = 0; i < bulk; i++) {
    const key =
      i % 2 === 0 && dbms
        ? `${dbms.r2Prefix}Unit ${(i % 5) + 1} - Extra/extra-notes-${i}.pdf`
        : `2024/ECE/Course ${i % 40}/Unit ${(i % 6) + 1}/lecture-${i}.pdf`;
    sources.put(key, body, 'application/pdf', `bulk-${i}`);
  }
}

const api = createApp(() => container);
const root = new Hono();
// Like Cloudflare in production: compress text responses.
root.use('*', compress());
root.route('/', api);

const webDist = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : null;
if (webDist && existsSync(webDist)) {
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
  };
  root.get('*', (c) => {
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    const candidate = join(webDist, path);
    const file =
      candidate.startsWith(webDist) && existsSync(candidate) && extname(candidate)
        ? candidate
        : join(webDist, 'index.html');
    return new Response(readFileSync(file), {
      headers: {
        'content-type': types[extname(file)] ?? 'application/octet-stream',
        // Same caching as production (_headers): hashed build files forever, pages always fresh.
        'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    });
  });
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port }, () => {
  console.log(
    `Scholars Stack demo API on http://localhost:${port}/api  (sign in with any @vitbhopal.ac.in email)`,
  );
  console.log('Admin in demo: admin@vitbhopal.ac.in');
  if (webDist) console.log(`Serving website from ${webDist}`);
});
