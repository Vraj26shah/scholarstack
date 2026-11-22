import { type Page, expect, test } from '@playwright/test';

/**
 * Student activity through the real UI: a signed-in student opens a course and a tool, a visitor
 * opens the home page, and the admin sees both in Insights and in that student's own Activity.
 */
const SHOTS = process.env.E2E_SHOTS; // folder for review screenshots (optional)
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/activity-${name}.png`, fullPage: true });
};
const unique = (p: string) => `${p}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function signIn(page: Page, username: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next.split('?')[0]);
}

test('what a student opens shows in Insights and in their own Activity', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  test.setTimeout(120_000);

  // A signed-in student: a course page, then a tool.
  const student = await (await browser.newContext()).newPage();
  const hits: string[] = [];
  student.on('request', (r) => {
    if (r.url().includes('/insights/hit')) hits.push(r.postData() ?? '');
  });
  const name = unique('active');
  await signIn(student, name, '/c/dbms-2025-cse-core');
  await expect(student.getByRole('heading', { level: 1, name: 'Database Management Systems' })).toBeVisible();
  await student.goto('/tools/cgpa');
  await expect.poll(() => hits.some((h) => h.includes('/tools/cgpa'))).toBe(true);
  await expect.poll(() => hits.some((h) => h.includes('/c/dbms-2025-cse-core'))).toBe(true);
  // A visitor: counted, but never as a person.
  const visitor = await (await browser.newContext()).newPage();
  const visitorAuth: (string | undefined)[] = [];
  visitor.on('request', (r) => {
    if (r.url().includes('/insights/hit')) visitorAuth.push(r.headers().authorization);
  });
  await visitor.goto('/help');
  await expect.poll(() => visitorAuth.length).toBeGreaterThan(0);
  // Nothing identifies a visitor: no sign-in token is sent.
  expect(visitorAuth.every((a) => a === undefined)).toBe(true);

  const admin = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  await signIn(admin, 'librarian', '/admin');
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: 'Students' }).click();
  await admin.getByRole('tab', { name: 'Insights', exact: true }).click();
  await admin.getByRole('radio', { name: 'Today' }).click();

  const views = admin.getByRole('tablist', { name: 'Insights views' });
  await views.getByRole('tab', { name: 'Pages & tools' }).click();
  const pages = admin.getByRole('region', { name: 'Pages and tools' });
  await expect(pages).toContainText('Tool · cgpa');
  await expect(pages).toContainText('Help');
  await views.getByRole('tab', { name: 'Students', exact: true }).click();
  const active = admin.getByRole('region', { name: 'Active students' });
  const row = active.getByRole('button', { name: new RegExp(name.split('.')[0]!) }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(active).toContainText('Last seen');
  await expect(active.getByRole('link', { name: 'Tool · cgpa' })).toBeVisible();
  await expect(active.getByRole('link', { name: /Course · dbms-2025-cse-core/ })).toBeVisible();
  await shot(admin, 'insights');

  // The same student's row on the Students screen has the same Activity.
  // The Students view (the section tab, and an Insights tab, have the same name: section, view, Insights).
  await admin.getByRole('tab', { name: 'Students', exact: true }).nth(1).click();
  const card = admin.getByRole('button', { name: new RegExp(name) }).first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(admin.getByRole('region', { name: 'Activity' }).first()).toContainText('Tool · cgpa');
  await shot(admin, 'student-row');
  expect(errors).toEqual([]);
});
