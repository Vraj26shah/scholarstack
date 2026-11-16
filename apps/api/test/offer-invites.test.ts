import type { AdminBundleDto } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { offerBatchYears, offerInvite } from '../src/application/offer-invite';
import type { Offer } from '../src/domain/entities';
import { Browser, setup } from './harness';

const DAY = 24 * 60 * 60 * 1000;

async function world() {
  const { env, app, clock } = setup();
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const at = (d: number) => new Date(clock.now().getTime() + d * DAY).toISOString();
  const student = async (email: string) => {
    const b = new Browser(app);
    await b.signIn(email);
    return b;
  };
  const offer = async (body: Record<string, unknown>) =>
    (
      await admin.call('POST', '/admin/offers', {
        title: 'Diwali offer',
        percentOff: 20,
        startsAt: at(-1),
        endsAt: at(5),
        status: 'live',
        ...body,
      })
    ).json;
  return { env, app, clock, admin, at, student, offer };
}

const base: Offer = {
  id: 'o1',
  title: 'Diwali offer',
  percentOff: 20,
  startsAt: new Date('2026-11-16T00:00:00+05:30'),
  endsAt: new Date('2026-11-22T23:59:00+05:30'),
  status: 'live',
  everything: true,
  allCourses: false,
  allBundles: false,
  courseIds: [],
  bundleIds: [],
  drawers: [],
};

describe('offer invitation text', () => {
  it('is written from the offer: name, percentage, what it covers, and the end in India’s time', () => {
    const inv = offerInvite(base, 'launch', null);
    expect(inv.subject).toBe('Diwali offer: 20% off every course and bundle, till Sun, 22 Nov, 11:59 pm');
    expect(inv.heading).toBe('Diwali offer: 20% off.');
    expect(inv.body).toContain(
      'Every course and bundle on Scholars Stack is 20% off until Sun, 22 Nov, 11:59 pm.',
    );
    expect(inv.body).toContain('The Diwali packs (every course in your drawer, together) are 20% off too');
    expect(inv.body).toContain('no code to type');
    expect(inv).toMatchObject({ ctaLabel: 'See the offer prices', ctaUrl: '/#catalogue', batchYears: null });

    const courses = offerInvite({ ...base, everything: false, allCourses: true }, 'launch', null);
    expect(courses.subject).toContain('20% off every course,');
    expect(courses.body).not.toContain('packs');

    const reminder = offerInvite(base, 'reminder', null);
    expect(reminder.subject).toBe('Last day: Diwali offer ends Sun, 22 Nov, 11:59 pm');
    expect(reminder.heading).toBe('Last day for 20% off.');
  });

  it('reaches every student for a whole-shop offer, and only the right batches for a chosen one', () => {
    expect(
      offerBatchYears(
        base,
        () => [],
        () => [],
      ),
    ).toBeNull();
    const chosen: Offer = {
      ...base,
      everything: false,
      drawers: [{ batchYear: 2024, branchSlug: '*' }],
      courseIds: ['c1'],
      bundleIds: ['b1'],
    };
    const years = offerBatchYears(
      chosen,
      (c) => (c === 'c1' ? [{ batchYear: 2025, branchSlug: 'bce' }] : []),
      (b) => (b === 'b1' ? [{ batchYear: 2023, branchSlug: 'bce' }] : []),
    );
    expect(years).toEqual([2025, 2024, 2023]);
  });
});

describe('offer invitations', () => {
  it('drafts the invitation once, shows it on the offer, and sends it to every student who keeps emails on', async () => {
    const { env, admin, student, offer } = await world();
    const a = await student('asha.25bce10001@vitbhopal.ac.in');
    await student('ben.24bai10002@vitbhopal.ac.in');
    const off = await student('chen.25bce10003@vitbhopal.ac.in');
    await off.call('PUT', '/me/email', { emailOptIn: false });
    void a;
    const o = await offer({ everything: true });

    const draft = (await admin.call('POST', `/admin/offers/${o.id}/invite`, { kind: 'launch' })).json;
    expect(draft).toMatchObject({ status: 'draft', offerId: o.id, batchYears: null, ctaUrl: '/#catalogue' });
    expect(draft.subject).toMatch(/^Diwali offer: 20% off every course and bundle, till /);
    // Clicking again refreshes the same draft instead of making a second one.
    const again = (await admin.call('POST', `/admin/offers/${o.id}/invite`, { kind: 'launch' })).json;
    expect(again.id).toBe(draft.id);

    const listed = (await admin.call('GET', '/admin/offers')).json[0];
    expect(listed.invitations).toEqual([expect.objectContaining({ id: draft.id, status: 'draft' })]);

    await admin.call('POST', `/admin/announcements/${draft.id}/send`);
    const to = env.db.outbox.map((m) => m.to.email).sort();
    expect(to).toEqual([
      'admin@vitbhopal.ac.in',
      'asha.25bce10001@vitbhopal.ac.in',
      'ben.24bai10002@vitbhopal.ac.in',
    ]);
    expect(env.db.outbox[0]!.html).toContain('http://localhost:5173/#catalogue');
    expect((await admin.call('GET', '/admin/offers')).json[0].invitations[0]).toMatchObject({
      status: 'sent',
      sent: 3,
    });
  });

  it('an offer on chosen batches only emails those batches', async () => {
    const { env, admin, student, offer } = await world();
    await student('asha.25bce10001@vitbhopal.ac.in');
    await student('ben.24bai10002@vitbhopal.ac.in');
    const o = await offer({ drawers: [{ batchYear: 2024, branchSlug: '*' }] });
    const draft = (await admin.call('POST', `/admin/offers/${o.id}/invite`, {})).json;
    expect(draft.batchYears).toEqual([2024]);
    expect(draft.subject).toContain('the notes for your batch');
    await admin.call('POST', `/admin/announcements/${draft.id}/send`);
    expect(env.db.outbox.map((m) => m.to.email)).toEqual(['ben.24bai10002@vitbhopal.ac.in']);
  });

  it('refuses to invite to a draft or finished offer', async () => {
    const { admin, offer, at } = await world();
    const draft = await offer({ everything: true, status: 'draft' });
    expect((await admin.call('POST', `/admin/offers/${draft.id}/invite`, {})).status).toBe(400);
    const ended = await offer({ everything: true, startsAt: at(-5), endsAt: at(-1) });
    expect((await admin.call('POST', `/admin/offers/${ended.id}/invite`, {})).status).toBe(400);
  });
});

describe('what the site shows during an offer', () => {
  it('the catalogue banner lists running offers only, whole-shop ones first', async () => {
    const { app, offer, at, clock } = await world();
    const visitor = new Browser(app);
    expect((await visitor.call('GET', '/offers/running')).json).toEqual([]);
    await offer({ title: 'Small', percentOff: 30, drawers: [{ batchYear: 2024, branchSlug: '*' }] });
    await offer({ everything: true });
    await offer({ title: 'Later', everything: true, startsAt: at(2), endsAt: at(4) });
    const running = (await visitor.call('GET', '/offers/running')).json;
    expect(running.map((o: { title: string; scope: string }) => [o.title, o.scope])).toEqual([
      ['Diwali offer', 'everything'],
      ['Small', 'some'],
    ]);
    clock.advance(6 * DAY);
    expect((await visitor.call('GET', '/offers/running')).json).toEqual([]);
  });

  it('the admin bundle list shows what students pay now and the name they see', async () => {
    const { admin, offer } = await world();
    await admin.call('POST', '/admin/bundles/packs', { dryRun: false, titlePrefix: 'Semester pack' });
    const before = (await admin.call('GET', '/admin/bundles')).json as AdminBundleDto[];
    expect(before.every((b) => b.today === null)).toBe(true);
    await offer({ everything: true });
    const during = (await admin.call('GET', '/admin/bundles')).json as AdminBundleDto[];
    const pack = during.find((b) => b.autoDrawer === '2025:bce')!;
    expect(pack.title).toBe('Semester pack · 2025 BCE');
    expect(pack.today).toMatchObject({ offerTitle: 'Diwali offer', shownTitle: 'Diwali pack · 2025 BCE' });
    expect(pack.today!.pricePaise).toBeLessThan(pack.basePricePaise);
  });
});
