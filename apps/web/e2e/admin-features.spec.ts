import { type Browser, type Page, expect, test } from '@playwright/test';

/**
 * Every admin feature, driven through the real UI in one signed-in session.
 * Runs on desktop only; uses the second demo admin so it never competes for devices.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
/** Old section names → [group, view]: the admin is five groups with views inside. */
const PATH: Record<string, [string, string?]> = {
  'Full R2 audit': ['Storage & health', 'Full audit'],
  Bundles: ['Notes & courses', 'Bundles'],
  'Import courses': ['Notes & courses', 'Import'],
  'Courses & publishing': ['Notes & courses', 'Courses'],
  'Features & email': ['Email & tools'],
  'R2 → Website': ['Notes & courses', 'R2 → Website'],
  'Students & access': ['Students & money', 'Access'],
};
const groupTab = (name: string) =>
  page.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name, exact: true });
/** The tab that shows a view as selected: the view's own tab, or its group's when it has one view. */
const tab = (name: string | RegExp) => {
  const [group, view] = PATH[typeof name === 'string' ? name : 'Courses & publishing']!;
  const t = view ? page.getByRole('tab', { name: view, exact: true }) : groupTab(group);
  return {
    click: async () => {
      await groupTab(group).click();
      if (view) await t.click();
    },
    selected: t,
  };
};

test.beforeAll(async ({ browser }: { browser: Browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  page = await (await browser.newContext()).newPage();
  await page.goto('/sign-in?next=%2Fadmin');
  await page.locator('#email').fill('librarian');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/admin');
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixtures from this destructuring.
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
});

test('sections open in any order and keep old links working', async () => {
  for (const name of [
    'Full R2 audit',
    'Bundles',
    'Import courses',
    /Courses & publishing/,
    'Features & email',
    'R2 → Website',
  ]) {
    await tab(name).click();
    await expect(tab(name).selected).toHaveAttribute('aria-selected', 'true');
  }
  await page.goto('/admin?tab=tools');
  await expect(tab('Features & email').selected).toHaveAttribute('aria-selected', 'true');
  await page.goto('/admin?section=audit');
  await expect(tab('Full R2 audit').selected).toHaveAttribute('aria-selected', 'true');
  await page.goto('/admin');
});

test('health cards report R2, Supabase and the page maker', async () => {
  await expect(page.getByText('File storage (R2)')).toBeVisible();
  await expect(page.getByText('Working').first()).toBeVisible({ timeout: 15_000 });
});

test('compare everything in R2 and see files that are in no course', async () => {
  await page.getByRole('radio', { name: /Everything in R2/ }).click();
  await page.getByRole('button', { name: 'Next: compare with the website' }).click();
  await expect(page.getByText('Not in any course')).toBeVisible({ timeout: 20_000 });
  const stage2 = page.locator('section[aria-labelledby="stage-2"]');
  await expect(stage2.getByRole('button', { name: 'Go to Import courses' })).toBeVisible();
});

test('compare one folder, one file, and a mix', async () => {
  await page.getByRole('radio', { name: /Only some folders or files/ }).click();
  await page.getByRole('button', { name: 'Open all' }).click();
  await page.getByRole('checkbox', { name: 'Select folder Database Management Systems' }).check();
  // A ticked folder covers its children, so they lock.
  await expect(page.getByRole('checkbox', { name: /Select folder Unit 1 - ER/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Next: compare with the website' }).click();
  const stage2 = page.locator('section[aria-labelledby="stage-2"]');
  await expect(stage2.getByText('Database Management Systems')).toBeVisible({ timeout: 20_000 });
  // R2 differences (drift servers) are copied across; otherwise it already matches.
  const fix = stage2.getByRole('button', { name: 'Make website match R2' }).first();
  if (await fix.isVisible()) {
    await fix.click();
    await expect(stage2.getByText(/^Done: /)).toBeVisible({ timeout: 60_000 });
  }
  await expect(stage2.getByText('The website already matches R2 for everything you chose.')).toBeVisible({
    timeout: 20_000,
  });

  // Search, then a single file only.
  await page.getByRole('button', { name: /Remove 25 Batch\/Database Management Systems/ }).click();
  await page.getByLabel('Find a folder or file in R2').fill('SQL-practice');
  await page.getByRole('checkbox', { name: /Select file SQL-practice-queries\.pdf/ }).check();
  await page.getByLabel('Find a folder or file in R2').fill('');
  await page.getByRole('checkbox', { name: 'Select folder Compiler Design' }).check();
  await expect(page.getByText('Chosen: 2 items')).toBeVisible();
  await page.getByRole('button', { name: 'Next: compare with the website' }).click();
  await expect(stage2.getByText('Compiler Design')).toBeVisible({ timeout: 20_000 });
  await expect(stage2.getByText('Database Management Systems')).toBeVisible();
});

test('make pages for the selection with a bar per file', async () => {
  const stage3 = page.locator('section[aria-labelledby="stage-3"]');
  await page.getByRole('button', { name: 'Next: make pages' }).click();
  await expect(stage3.getByRole('progressbar').first()).toBeVisible({ timeout: 15_000 });
  await stage3.getByRole('button', { name: 'Make pages', exact: true }).click();
  await expect(stage3.getByText(/sent to the page maker|Nothing to do|already/)).toBeVisible({
    timeout: 15_000,
  });
  await stage3.getByRole('tab', { name: /Done/ }).click();
  await expect(stage3.getByText(/Done · \d+ pages/).first()).toBeVisible({ timeout: 60_000 });
});

test('import a new course from R2', async () => {
  await tab('Import courses').click();
  const pick = page.getByRole('checkbox', { name: 'Import Big Data Analytics as a course' });
  await expect(pick).toBeVisible({ timeout: 15_000 });
  await pick.check();
  await page
    .getByRole('group', { name: 'Branches for Big Data Analytics' })
    .getByRole('checkbox')
    .first()
    .check();
  await page.getByRole('combobox', { name: 'Semester', exact: true }).selectOption('7');
  await page.getByRole('button', { name: /Import 1 course/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible({ timeout: 30_000 });
});

test('edit, hide, audit, publish and unpublish a course', async () => {
  await tab(/Courses & publishing/).click();
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('Big Data Analytics');
  const row = page
    .locator('#admin-panel')
    .getByRole('listitem')
    .filter({
      has: page.getByRole('link', { name: /Big Data Analytics/ }),
    });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('draft', { exact: true })).toBeVisible();

  // Edit the description.
  await row.getByRole('button', { name: 'Edit' }).click();
  await row.getByLabel('Description').fill('Hadoop, MapReduce and Spark, from seniors.');
  await row.getByRole('button', { name: 'Save changes' }).click();
  await expect(row.getByRole('button', { name: 'Save changes' })).toBeHidden();

  // Hide a unit, then show it again.
  await row.getByRole('button', { name: 'Manage files' }).click();
  const unitSwitch = row.getByRole('switch', { name: /^Hadoop basics: on the site/ });
  await expect(unitSwitch).toBeVisible({ timeout: 15_000 });
  await unitSwitch.click();
  await expect(row.getByRole('switch', { name: /^Hadoop basics: hidden/ })).toBeVisible();
  await row.getByRole('switch', { name: /^Hadoop basics: hidden/ }).click();
  await expect(row.getByRole('switch', { name: /^Hadoop basics: on the site/ })).toBeVisible();
  await row.getByRole('button', { name: 'Close files' }).click();

  // Per-course R2 audit.
  await row.getByRole('button', { name: 'R2 audit' }).click();
  await expect(row.getByText(/R2 files · \d+ registered/)).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Close audit' }).click();

  // Price and publish (pages convert instantly in the e2e demo).
  await row.getByLabel('Price in rupees for Big Data Analytics').fill('59');
  await expect(row.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled({ timeout: 30_000 });
  await row.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(row.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.goto('/?batch=2023#catalogue');
  await expect(page.locator('#catalogue').getByRole('link', { name: /Big Data Analytics/ })).toBeVisible({
    timeout: 15_000,
  });

  // Unpublish takes it off sale again.
  await page.goto('/admin?section=courses');
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('Big Data Analytics');
  await row.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(row.getByText('draft', { exact: true })).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(row.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });
});

test('create a bundle', async () => {
  await tab('Bundles').click();
  await page.getByRole('button', { name: 'New bundle' }).click();
  await page.getByLabel('Bundle title').fill('E2E 2023 starter pack');
  await page.getByLabel('Batch').selectOption('2023');
  const boxes = page.locator('#admin-panel').getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: 'Suggest ~30% off' }).click();
  await expect(page.getByLabel('Bundle price ₹')).not.toHaveValue('', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Create bundle' }).click();
  await expect(page.getByText('E2E 2023 starter pack')).toBeVisible({ timeout: 15_000 });
});

test('add a free tool, then edit and save it', async () => {
  await tab('Features & email').click();
  await expect(page.getByRole('heading', { name: 'Tools on the home page' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a tool' }).click();
  const form = page.locator('form').filter({ has: page.getByLabel('Key (its web address)') });
  await form.getByLabel('Key (its web address)').fill('attendance');
  await form.getByLabel('Name').fill('Attendance tracker');
  await form.getByLabel('One-line description').fill('See how many classes you can still miss.');
  await form.getByRole('button', { name: 'Add tool' }).click();
  const row = page.getByRole('listitem').filter({ hasText: '/tools/attendance' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByLabel('One-line description').fill('Know exactly how many classes you can skip.');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled({ timeout: 10_000 });
});

test('write, preview and test an announcement email', async () => {
  await page.getByRole('button', { name: 'Write an email' }).click();
  await page.getByLabel('Subject line').fill('New notes are up');
  await page.getByLabel('Heading in the email').fill('Fresh notes for 2023');
  await page.getByLabel(/^Message/).fill('Big Data Analytics is now on the shelf.\n\n- Hadoop\n- Spark');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(
    page.frameLocator('iframe[title="Email preview"]').getByText('Fresh notes for 2023'),
  ).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Send me a test' }).click();
  await expect(page.getByRole('button', { name: /Sent to / })).toBeVisible({ timeout: 15_000 });
});

test('run the full R2 audit for one course', async () => {
  await tab('Full R2 audit').click();
  await page.getByLabel('Scan scope').selectOption('course');
  const controls = page.locator('section').filter({ hasText: 'Scan scope' }).first();
  const courseSelect = controls.locator('select').nth(1);
  const value = await courseSelect
    .locator('option')
    .evaluateAll(
      (o) => o.find((x) => x.textContent?.includes('Compiler Design'))?.getAttribute('value') ?? '',
    );
  await courseSelect.selectOption(value);
  await page.getByRole('button', { name: 'Scan this course' }).click();
  await expect(page.getByText(/file page folders were checked/)).toBeVisible({ timeout: 30_000 });
  const pages = page
    .getByRole('region', { name: 'Selected scope totals' })
    .getByText('Generated page assets', { exact: true })
    .locator('..')
    .locator('strong');
  await expect(pages).not.toHaveText('0');
});

test('students & access: every purchase lasts 3 months, then see the student list', async () => {
  await tab('Students & access').click();
  await expect(page.getByText("3 months from the day it's bought")).toBeVisible();
  await expect(page.getByText('Term dates')).toHaveCount(0);
  const students = page.locator('section').filter({ hasText: 'Find a student' }).first();
  await expect(students.getByRole('button', { name: /^All · \d+/ })).toBeVisible();
});
