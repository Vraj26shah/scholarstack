import type { AdminActivityDto } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { sourceRows, sourceTotals } from '../features/admin/insights-derive';
import { campaignFrom, noteArrival, noteSignIn, shareLink } from '../lib/campaign';

describe('tagged links', () => {
  beforeEach(() => localStorage.clear());

  it('reads utm tags and the short ref form', () => {
    expect(campaignFrom('?utm_source=WhatsApp&utm_campaign=ECE 25')).toEqual({
      source: 'whatsapp',
      campaign: 'ece-25',
    });
    expect(campaignFrom('?ref=insta-reel-1')).toEqual({ source: 'insta', campaign: 'reel-1' });
    expect(campaignFrom('?ref=poster')).toEqual({ source: 'poster' });
    expect(campaignFrom('?x=1')).toBeNull();
  });

  it('credits a sign-in once, to the newest tagged visit, within 30 days', () => {
    const t = 1_800_000_000_000;
    expect(noteSignIn(t)).toBeNull();
    noteArrival('?utm_source=poster', t);
    noteArrival('?utm_source=whatsapp&utm_campaign=ece-25', t + 1000);
    expect(noteSignIn(t + 2000)).toEqual({ source: 'whatsapp', campaign: 'ece-25' });
    expect(noteSignIn(t + 3000)).toBeNull();
    noteArrival('?ref=insta-reel', t);
    expect(noteSignIn(t + 31 * 24 * 3600 * 1000)).toBeNull();
  });

  it('survives a broken saved value', () => {
    localStorage.setItem('ss_campaign', '{"source":5,"at":"x"}');
    expect(noteSignIn()).toBeNull();
    localStorage.setItem('ss_campaign', 'not json');
    expect(noteSignIn()).toBeNull();
  });

  it('builds links to share', () => {
    expect(shareLink('https://s.test', '/tools/timetable', 'whatsapp', 'ECE 25')).toBe(
      'https://s.test/tools/timetable?utm_source=whatsapp&utm_medium=social&utm_campaign=ece-25',
    );
    expect(shareLink('https://s.test', '/', 'poster', '')).toBe(
      'https://s.test/?utm_source=poster&utm_medium=offline',
    );
  });

  it('adds up visits and sign-ins per link and per source', () => {
    const a = {
      actions: [
        { target: 'from:whatsapp/ece-25:/tools/timetable', hits: 30, visitorHits: 30, students: 0 },
        { target: 'from:whatsapp/ece-25:/', hits: 5, visitorHits: 5, students: 0 },
        { target: 'signin_from:whatsapp/ece-25', hits: 6, visitorHits: 0, students: 6 },
        { target: 'from:instagram/-:/', hits: 50, visitorHits: 50, students: 0 },
        { target: 'login', hits: 9, visitorHits: 0, students: 9 },
      ],
    } as unknown as AdminActivityDto;
    const rows = sourceRows(a);
    expect(rows[0]).toEqual({
      source: 'whatsapp',
      campaign: 'ece-25',
      arrived: 35,
      signedIn: 6,
      topPage: '/tools/timetable',
    });
    expect(rows[1]).toMatchObject({ source: 'instagram', campaign: null, arrived: 50, signedIn: 0 });
    expect(sourceTotals(rows).map((t) => t.source)).toEqual(['whatsapp', 'instagram']);
  });
});
