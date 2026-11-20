import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleMeta, courseMeta, isShareBot, sharedItem, withShareMeta } from '../src/http/share-preview';
import { Browser, setup } from './harness';

const INDEX = readFileSync(join(__dirname, '../../web/index.html'), 'utf8');
const tag = (html: string, key: string) =>
  new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`).exec(html)?.[1];

describe('link previews for shared course and bundle links', () => {
  it('knows the crawlers that draw link previews, and never a person’s browser', () => {
    for (const ua of [
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'TelegramBot (like TwitterBot)',
      'Twitterbot/1.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    ])
      expect(isShareBot(ua), ua).toBe(true);
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      '',
    ])
      expect(isShareBot(ua), ua).toBe(false);
  });

  it('only course and bundle pages are rewritten', () => {
    expect(sharedItem('/c/dbms-2025-cse-core')).toEqual({ kind: 'course', slug: 'dbms-2025-cse-core' });
    expect(sharedItem('/b/pack-2026-bcy/')).toEqual({ kind: 'bundle', slug: 'pack-2026-bcy' });
    for (const p of ['/', '/shelf', '/c/', '/c/x/y', '/read/abc', '/c/<script>'])
      expect(sharedItem(p)).toBeNull();
  });

  it('a shared course shows its own title, price and description; a bundle its courses and saving', async () => {
    const { app, env } = setup();
    const visitor = new Browser(app);
    const course = (await visitor.call('GET', '/courses/dbms-2025-cse-core')).json;
    const html = withShareMeta(INDEX, courseMeta(course, 'https://example.test/c/dbms-2025-cse-core'));
    expect(tag(html, 'og:title')).toBe('Database Management Systems · notes on Scholars Stack');
    expect(tag(html, 'og:url')).toBe('https://example.test/c/dbms-2025-cse-core');
    const description = tag(html, 'og:description')!;
    expect(description).toContain(`${course.fileCount} files`);
    expect(description).toContain('₹');
    expect(description.length).toBeLessThanOrEqual(200);
    // Every tag a preview might read agrees, and the site's card image is kept.
    expect(tag(html, 'twitter:title')).toBe(tag(html, 'og:title'));
    expect(tag(html, 'description')).toBe(description);
    expect(html).toContain('<title>Database Management Systems · notes on Scholars Stack</title>');
    expect(tag(html, 'og:image')).toBe(tag(INDEX, 'og:image'));

    const slug = [...env.db.bundles.values()].find((b) => b.status === 'live')!.slug;
    const bundle = (await visitor.call('GET', `/bundles/${slug}`)).json;
    const b = withShareMeta(INDEX, bundleMeta(bundle, `https://example.test/b/${slug}`));
    expect(tag(b, 'og:title')).toContain(`${bundle.courseCount} courses`);
    expect(tag(b, 'og:description')).toContain('₹');
  });

  it('text from the catalogue can never break out of a tag', () => {
    const html = withShareMeta(INDEX, {
      title: 'A "quoted" <b>title</b> & more',
      description: '"><script>alert(1)</script>',
      url: 'https://example.test/c/x',
    });
    expect(html).not.toContain('<script>alert');
    expect(tag(html, 'og:title')).toBe('A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt; &amp; more');
  });
});
