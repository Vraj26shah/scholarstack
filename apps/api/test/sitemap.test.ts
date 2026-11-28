import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATIC_PAGES, sitemapXml } from '../src/http/sitemap';
import { Browser, setup } from './harness';

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

describe('sitemap.xml', () => {
  it('lists the public pages and every live course, never drafts or private pages', async () => {
    const { env, app } = setup();
    const v = new Browser(app);
    const live = [...env.db.courses.values()].filter((c) => c.status === 'live');
    const draft = live[0]!;
    draft.status = 'draft';
    const r = await v.call('GET', '/sitemap.xml');
    expect(r.status).toBe(200);
    expect(r.res.headers.get('content-type')).toContain('application/xml');
    const urls = locs(await r.res.text());
    const paths = urls.map((u) => new URL(u).pathname);
    for (const p of STATIC_PAGES) expect(paths).toContain(p);
    expect(paths).not.toContain(`/c/${draft.slug}`);
    expect(paths.some((p) => p.startsWith('/c/'))).toBe(true);
    for (const p of paths) expect(p).not.toMatch(/^\/(admin|read|checkout|account|shelf|auth|api)\b/);
  });

  it('escapes and skips anything that is not a clean slug', () => {
    const xml = sitemapXml('https://x.test', {
      courses: ['dbms-2025', 'Bad Slug', '../etc'],
      bundles: ['pack-2026'],
      messes: ['radha', 'radha'],
    });
    const paths = locs(xml).map((u) => new URL(u).pathname);
    expect(paths).toContain('/c/dbms-2025');
    expect(paths).toContain('/b/pack-2026');
    expect(paths.filter((p) => p === '/m/radha')).toHaveLength(1);
    expect(paths.some((p) => p.includes('etc') || p.includes(' '))).toBe(false);
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('every page with its own link preview is routed to the Worker first', () => {
    const wrangler = readFileSync(join(__dirname, '../wrangler.jsonc'), 'utf8');
    const first = /"run_worker_first":\s*\[([^\]]*)\]/.exec(wrangler)![1]!;
    for (const p of ['/c/*', '/b/*', '/m/*', '/tools/*', '/get-app', '/contribute', '/sitemap.xml'])
      expect(first).toContain(`"${p}"`);
  });
});
