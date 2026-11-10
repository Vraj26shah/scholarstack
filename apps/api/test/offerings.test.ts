import { beforeEach, describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

/** One set of notes, many drawers: a course is offered to every batch and programme that takes it. */
describe('course offerings', () => {
  let env: ReturnType<typeof setup>['env'];
  let app: ReturnType<typeof setup>['app'];
  beforeEach(() => {
    ({ env, app } = setup());
  });
  const dbms = () => [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
  const drawer = async (batch: number, branch: string) =>
    (
      (await new Browser(app).call('GET', `/catalogue/drawer?batch=${batch}&branch=${branch}`)).json as any[]
    ).map((c) => c.slug);

  it('follows the course list by code: CSE3001 reaches 2025 BCY, shown as that batch', async () => {
    dbms().courseCode = 'CSE3001';
    const bcy = await new Browser(app).call('GET', '/catalogue/drawer?batch=2025&branch=bcy');
    const card = (bcy.json as any[]).find((c) => c.slug === 'dbms-2025-cse-core');
    expect(card).toMatchObject({ batchYear: 2025, branchSlug: 'bcy' });
    // Not offered to a batch whose list doesn't have it.
    expect(await drawer(2024, 'bcy')).not.toContain('dbms-2025-cse-core');
  });

  it('an admin can offer the same course to other batches and programmes, then go back to the list', async () => {
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const set = await a.call('PATCH', `/admin/courses/${dbms().id}`, {
      offeredTo: [
        { batchYear: 2024, branchSlug: 'bai' },
        { batchYear: 2023, branchSlug: 'bce' },
      ],
    });
    expect(set.status).toBe(200);
    // Still live: choosing drawers doesn't unpublish.
    expect(dbms().status).toBe('live');
    expect(await drawer(2024, 'bai')).toContain('dbms-2025-cse-core');
    expect(await drawer(2023, 'bce')).toContain('dbms-2025-cse-core');
    expect(await drawer(2025, 'bce')).not.toContain('dbms-2025-cse-core');

    const listed = (await a.call('GET', '/admin/courses')).json as any[];
    const row = listed.find((c) => c.slug === 'dbms-2025-cse-core');
    expect(row.offeredTo).toHaveLength(2);
    expect(row.offerings.every((o: any) => o.source === 'admin')).toBe(true);

    await a.call('PATCH', `/admin/courses/${dbms().id}`, { offeredTo: null });
    expect(await drawer(2025, 'bce')).toContain('dbms-2025-cse-core');
    expect(await drawer(2024, 'bai')).not.toContain('dbms-2025-cse-core');
  });

  it('shows one card per subject when two courses with one code reach a drawer', async () => {
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    dbms().courseCode = 'CSE3003';
    os.courseCode = 'CSE3003';
    const slugs = await drawer(2024, 'bce');
    expect(slugs.filter((s) => s === 'dbms-2025-cse-core' || s === 'os-2025-cse-core')).toHaveLength(1);
  });

  it('shows students only live notes: a course taken off sale leaves the drawer, search and shelf', async () => {
    const s = new Browser(app);
    await s.signIn('rahul@vitbhopal.ac.in');
    const start = await s.call('POST', '/orders', { courseId: dbms().id });
    const pay = await s.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
    await s.call('POST', '/orders/verify', {
      orderId: start.json.orderId,
      gatewayOrderId: start.json.gatewayOrderId,
      gatewayPaymentId: pay.json.gatewayPaymentId,
      signature: pay.json.signature,
    });
    const onShelf = async () =>
      ((await s.call('GET', '/me/shelf')).json as any[]).some((i) => i.course.slug === 'dbms-2025-cse-core');
    expect(await onShelf()).toBe(true);
    dbms().status = 'archived';
    expect(await drawer(2025, 'bce')).not.toContain('dbms-2025-cse-core');
    const search = await s.call('GET', '/catalogue/search?q=Database');
    expect(search.json.courses.some((c: any) => c.slug === 'dbms-2025-cse-core')).toBe(false);
    expect(await onShelf()).toBe(false);
    expect((await s.call('GET', '/courses/dbms-2025-cse-core')).status).toBe(404);
    // Back on sale: back on the shelf.
    dbms().status = 'live';
    expect(await onShelf()).toBe(true);
  });
});
