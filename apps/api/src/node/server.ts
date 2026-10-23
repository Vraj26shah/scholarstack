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

const { container, db, seeder } = memoryContainer({ seed: true, pageProducer: producePage });
dbRef = db;
seederRef = seeder;

const api = createApp(() => container);
const root = new Hono();
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
      headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream' },
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
