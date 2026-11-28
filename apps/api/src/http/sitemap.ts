/**
 * sitemap.xml for search engines: the public pages worth finding (home, the free tools, the app
 * page, contribute, help) and every live course, bundle and restaurant page. Nothing private
 * (reading, checkout, accounts, admin) is ever listed; robots.txt points here.
 */

/** Public pages that are always there, most important first. */
export const STATIC_PAGES = [
  '/',
  '/tools/timetable',
  '/tools/attendance',
  '/tools/cgpa',
  '/tools/mess-menu',
  '/get-app',
  '/contribute',
  '/help',
] as const;

const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function sitemapXml(
  origin: string,
  live: { courses: string[]; bundles: string[]; messes: string[] },
): string {
  const clean = (slugs: string[]) =>
    [...new Set(slugs.map((s) => s.toLowerCase()))].filter((s) => SLUG.test(s));
  const paths = [
    ...STATIC_PAGES,
    ...clean(live.courses).map((s) => `/c/${s}`),
    ...clean(live.bundles).map((s) => `/b/${s}`),
    ...clean(live.messes).map((s) => `/m/${s}`),
  ];
  const urls = paths.map((p) => `  <url><loc>${escapeXml(`${origin}${p}`)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
