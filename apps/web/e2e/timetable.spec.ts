import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, username: string) {
  await page.goto('/sign-in?next=%2Fadmin');
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname !== '/sign-in');
}

test('timetable: add a course, download a real PDF, and import it from a share link', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
  await signIn(page, 'keeper'); // admins can use a tool before it's launched
  await page.goto('/tools/timetable');
  await page.evaluate(() => localStorage.removeItem('ss_tool_timetable_courses'));
  await page.reload();
  // Admin preview before launch, the live tool after: either way the maker is there.
  await expect(page.getByRole('heading', { name: 'Timetable maker' })).toBeVisible();

  await page.getByRole('button', { name: 'Type slots instead' }).click();
  await page.getByLabel('Course name').fill('Operating Systems');
  await page.getByLabel('Course code').fill('CSE3003');
  await page.getByLabel('Room (optional)').fill('AB1-204');
  await page.getByLabel('Slots').fill('B1');
  await page.getByRole('button', { name: 'Add to timetable' }).click();
  await page.getByRole('tab', { name: 'Week' }).click();
  await expect(page.getByRole('button', { name: /B11: Operating Systems/ })).toBeVisible();

  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download PDF' }).click(),
  ]);
  expect(pdf.suggestedFilename()).toBe('timetable.pdf');
  const bytes = await (await pdf.createReadStream()).toArray();
  expect(Buffer.concat(bytes).subarray(0, 8).toString()).toBe('%PDF-1.4');

  const [ics] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Add to calendar' }).click(),
  ]);
  expect(ics.suggestedFilename()).toBe('timetable.ics');

  // A friend opens the share link: offered, never applied without asking.
  const code = await page.evaluate(() => {
    const raw = localStorage.getItem('ss_tool_timetable_courses')!;
    const data = JSON.parse(raw).map((c: { name: string; code: string; slots: string[]; color: string }) => ({
      n: c.name,
      c: c.code,
      s: c.slots,
      k: c.color,
    }));
    return btoa(JSON.stringify(data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  // Opened where the tool is visible: offered next to the existing timetable.
  await page.goto(`/tools/timetable#t=${code}`);
  await expect(page.getByText(/Someone shared a timetable with/)).toBeVisible();
  await page.getByRole('button', { name: 'Add as planned' }).click();
  await expect(page.getByText('PLANNED', { exact: true })).toBeVisible();

  const friend = await (await browser.newContext()).newPage();
  await friend.goto(`/tools/timetable#t=${code}`);
  // Students see "coming soon" until launch; the share link works for the admin preview here.
  const offer = friend.getByRole('button', { name: 'Use this timetable' });
  await expect(friend.getByText('Coming soon').or(offer)).toBeVisible();
  if (!(await offer.isVisible())) return;
  await friend.getByRole('button', { name: 'Use this timetable' }).click();
  await expect(friend.getByRole('listitem').getByText('CSE3003 · Operating Systems')).toBeVisible();
});
