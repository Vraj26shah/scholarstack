import { type BundleDetailDto, type CourseDetailDto, formatRupees } from '@ss/contracts';

/**
 * Link previews for shared course and bundle links. WhatsApp, LinkedIn, X, Telegram, Slack and the
 * like read the page's Open Graph tags without running any JavaScript, so a single-page app shows
 * every link as the same home-page card. For those crawlers only, the Worker fills in the course's
 * (or bundle's) own title, price and description. People get the page exactly as before.
 */

/** Link-preview and search crawlers. People's browsers never match. */
const SHARE_BOT =
  /bot\b|bot\/|crawler|spider|facebookexternalhit|facebot|linkedin|whatsapp|telegram|slack|discord|twitter|embedly|pinterest|skype|vkshare|redditbot|applebot|quora link preview|preview/i;

export const isShareBot = (userAgent: string | null | undefined) => !!userAgent && SHARE_BOT.test(userAgent);

/** "/c/dbms-2025-cse-core" → a course; "/b/pack-2026-bcy" → a bundle; anything else → null. */
export function sharedItem(pathname: string): { kind: 'course' | 'bundle'; slug: string } | null {
  const m = /^\/(c|b)\/([a-z0-9][a-z0-9-]{0,120})\/?$/i.exec(pathname);
  if (!m) return null;
  return { kind: m[1] === 'c' ? 'course' : 'bundle', slug: m[2]!.toLowerCase() };
}

export interface ShareMeta {
  title: string;
  description: string;
  url: string;
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;

const price = (pricePaise: number, offer?: { title: string; percentOff: number; fullPricePaise: number }) =>
  offer
    ? `${formatRupees(pricePaise)} (was ${formatRupees(offer.fullPricePaise)}, ${offer.title}: ${offer.percentOff}% off)`
    : formatRupees(pricePaise);

export function courseMeta(c: CourseDetailDto, url: string): ShareMeta {
  const what = c.blurb?.trim() || c.description?.trim() || '';
  const facts = `${c.fileCount} ${c.fileCount === 1 ? 'file' : 'files'} · ${c.pageCount} pages · ${c.branchName} ${c.batchYear}`;
  return {
    title: clip(`${c.title} · notes on Scholars Stack`, 90),
    description: clip(
      `${what ? `${what} ` : ''}${facts}. ${price(c.pricePaise, c.offer)}. Peek inside free before you buy.`,
      200,
    ),
    url,
  };
}

export function bundleMeta(b: BundleDetailDto, url: string): ShareMeta {
  const courses = b.courseTitles?.length ? `${b.courseTitles.join(', ')}. ` : '';
  return {
    title: clip(`${b.title} · ${b.courseCount} courses on Scholars Stack`, 90),
    description: clip(
      `${courses}${b.courseCount} courses, ${b.pageCount} pages for ${price(b.pricePaise, b.offer)}${
        b.savePercent > 0 ? `, ${b.savePercent}% less than one by one` : ''
      }.`,
      200,
    ),
    url,
  };
}

const attr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The site's index.html with this page's title, description and address in every tag a preview
 * reads (Open Graph, Twitter, the plain description and <title>). The image stays the site's card.
 */
export function withShareMeta(html: string, meta: ShareMeta): string {
  const setMeta = (out: string, key: 'property' | 'name', name: string, value: string) =>
    out.replace(
      new RegExp(`(<meta\\s+${key}="${name.replace(':', '\\:')}"\\s+content=")[^"]*(")`, 'i'),
      (_m, a: string, b: string) => `${a}${attr(value)}${b}`,
    );
  let out = html;
  out = setMeta(out, 'property', 'og:title', meta.title);
  out = setMeta(out, 'property', 'og:description', meta.description);
  out = setMeta(out, 'property', 'og:url', meta.url);
  out = setMeta(out, 'name', 'twitter:title', meta.title);
  out = setMeta(out, 'name', 'twitter:description', meta.description);
  out = setMeta(out, 'name', 'description', meta.description);
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${attr(meta.title)}</title>`);
  return out;
}
