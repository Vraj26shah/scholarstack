import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { campaignTag } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { activityTarget } from '../src/application/activity';
import { pagePreview, withShareMeta } from '../src/http/share-preview';
import { Browser, setup } from './harness';

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36' };
const INDEX = readFileSync(join(__dirname, '../../web/index.html'), 'utf8');
const tag = (html: string, key: string) =>
  new RegExp(`<meta\\s+(?:property|name)="${key}"\\s+content="([^"]*)"`).exec(html)?.[1];

describe('tool pages get their own link preview', () => {
  it('a shared timetable link talks about class reminders, not notes', () => {
    const meta = pagePreview('/tools/timetable/', 'https://example.test')!;
    const html = withShareMeta(INDEX, meta);
    expect(tag(html, 'og:title')).toContain('class reminders');
    expect(tag(html, 'og:url')).toBe('https://example.test/tools/timetable');
    expect(tag(html, 'og:image')).toBe(tag(INDEX, 'og:image'));
    for (const p of ['/tools/attendance', '/tools/cgpa', '/get-app', '/contribute'])
      expect(pagePreview(p, 'https://example.test'), p).not.toBeNull();
    for (const p of ['/', '/shelf', '/tools/unknown', '/c/x'])
      expect(pagePreview(p, 'https://x.test')).toBeNull();
  });
});

describe('where people come from', () => {
  it('cleans campaign tags typed by hand', () => {
    expect(campaignTag('ECE 25 Batch!')).toBe('ece-25-batch');
    expect(campaignTag('  WhatsApp ')).toBe('whatsapp');
    expect(campaignTag('---')).toBeNull();
    expect(campaignTag('')).toBeNull();
    expect(campaignTag('x'.repeat(60))).toHaveLength(40);
  });

  it('records arrivals with the page, and sign-ins, as safe targets', () => {
    expect(
      activityTarget({
        kind: 'source',
        step: 'arrived',
        source: 'whatsapp',
        campaign: 'ece-25',
        path: '/tools/timetable?utm_source=whatsapp',
      }),
    ).toEqual({ kind: 'action', target: 'from:whatsapp/ece-25:/tools/timetable' });
    expect(activityTarget({ kind: 'source', step: 'signed_in', source: 'poster', path: '/' })).toEqual({
      kind: 'action',
      target: 'signin_from:poster/-',
    });
  });

  it('the hit endpoint accepts tagged arrivals and refuses made-up tags', async () => {
    const { app } = setup();
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const visitor = new Browser(app);
    const student = new Browser(app);
    await student.signIn('active.23bce10001@vitbhopal.ac.in');
    const body = {
      kind: 'source',
      step: 'arrived',
      source: 'whatsapp',
      campaign: 'ece-25',
      path: '/tools/timetable',
    };
    expect((await visitor.call('POST', '/insights/hit', body, UA)).status).toBe(204);
    await student.call('POST', '/insights/hit', { ...body, step: 'signed_in' }, UA);
    await visitor.call('POST', '/insights/hit', { ...body, source: '<script>' }, UA);
    const r = (await admin.call('GET', '/admin/activity?days=7')).json;
    const targets = r.actions.map((a: { target: string }) => a.target);
    expect(targets).toContain('from:whatsapp/ece-25:/tools/timetable');
    expect(targets).toContain('signin_from:whatsapp/ece-25');
    expect(targets.some((t: string) => t.includes('script'))).toBe(false);
  });
});
