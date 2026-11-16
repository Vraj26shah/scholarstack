import { isFestivePackName, offerPackName } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { shownBundleTitle } from '../src/application/offers';
import { Browser, setup } from './harness';

const DAY = 24 * 60 * 60 * 1000;

describe('pack names follow the offers', () => {
  it('names a pack after the offer, dropping words like offer or sale', () => {
    expect(offerPackName('Diwali offer')).toBe('Diwali pack');
    expect(offerPackName('Holi Sale')).toBe('Holi pack');
    expect(offerPackName('Diwali Mega Sale!')).toBe('Diwali pack');
    expect(offerPackName('End of term')).toBe('End of term pack');
    expect(offerPackName('Exam week pack')).toBe('Exam week pack');
    expect(offerPackName('Offer')).toBe('Offer pack');
    const pack = { title: 'Semester pack · 2025 BCE', autoDrawer: '2025:bce' };
    expect(shownBundleTitle(pack, { title: 'Diwali offer' })).toBe('Diwali pack · 2025 BCE');
    expect(shownBundleTitle(pack, null)).toBe('Semester pack · 2025 BCE');
    // A bundle named by hand keeps its name.
    expect(shownBundleTitle({ title: 'DSA + DBMS', autoDrawer: null }, { title: 'Diwali offer' })).toBe(
      'DSA + DBMS',
    );
  });

  it('tells festival names from all-year names', () => {
    for (const n of ['Diwali pack', 'Holi pack', 'New Year pack', 'Festive pack', 'Mega sale pack'])
      expect(isFestivePackName(n)).toBe(true);
    for (const n of ['Semester pack', 'Drawer pack', 'Exam pack', 'Wholesale notes', 'Holiday reading'])
      expect(isFestivePackName(n)).toBe(false);
  });

  it('students see the offer’s name only while it runs; admins always see the pack’s own name', async () => {
    const { app, clock } = setup();
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const student = new Browser(app);
    await student.signIn('buyer@vitbhopal.ac.in');
    await admin.call('POST', '/admin/bundles/packs', { dryRun: false, titlePrefix: 'Semester pack' });

    const packsIn = async () =>
      (
        (await student.call('GET', '/bundles?batch=2025&branch=bce')).json as {
          slug: string;
          title: string;
          forDrawer?: string;
          offer?: { title: string };
        }[]
      ).filter((b) => b.forDrawer);
    const [before] = await packsIn();
    expect(before!.title).toBe('Semester pack · 2025 BCE');
    expect(before!.offer).toBeUndefined();

    const at = (d: number) => new Date(clock.now().getTime() + d * DAY).toISOString();
    await admin.call('POST', '/admin/offers', {
      title: 'Diwali offer',
      percentOff: 20,
      startsAt: at(-1),
      endsAt: at(2),
      status: 'live',
      allBundles: true,
    });
    const [during] = await packsIn();
    expect(during!.title).toBe('Diwali pack · 2025 BCE');
    expect(during!.offer?.title).toBe('Diwali offer');
    // The bundle page and the payment window say the same.
    expect((await student.call('GET', `/bundles/${during!.slug}`)).json.title).toBe('Diwali pack · 2025 BCE');
    const order = await student.call('POST', '/orders', {
      bundleId: (await student.call('GET', `/bundles/${during!.slug}`)).json.id,
    });
    expect(order.json.courseTitle).toBe('Diwali pack · 2025 BCE');
    // The admin list keeps the pack's own name, so editing it never saves a festival name.
    const adminPack = (await admin.call('GET', '/admin/bundles')).json.find(
      (b: { slug: string }) => b.slug === during!.slug,
    );
    expect(adminPack.title).toBe('Semester pack · 2025 BCE');

    clock.advance(3 * DAY);
    const [after] = await packsIn();
    expect(after!.title).toBe('Semester pack · 2025 BCE');
    expect(after!.offer).toBeUndefined();
  });
});
