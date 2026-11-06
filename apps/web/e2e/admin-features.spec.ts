import { type Browser, type Page, expect, test } from '@playwright/test';

/**
 * Every admin feature, driven through the real UI in one signed-in session.
 * Runs on desktop only; uses the second demo admin so it never competes for devices.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
/** Old section names → [group, view]: the admin is six groups with views inside. */
const PATH: Record<string, [string, string?]> = {
  'Clean-up': ['Storage', 'Clean-up'],
  Bundles: ['Courses', 'Bundles'],
  'Import courses': ['Courses', 'Folders'],
  'Courses & publishing': ['Courses', 'All courses'],
  'Features & email': ['Emails'],
  Students: ['Students'],
  Today: ['Today'],
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

/** Publishing goes through the checklist: open it from the row, wait for every step, publish. */
async function publishFromRow(row: ReturnType<Page['locator']>) {
  await row.getByRole('button', { name: /Check & publish|Steps to publish/ }).click();
  const steps = page.getByRole('list', { name: 'Steps to publish' });
  await expect(steps).toBeVisible({ timeout: 30_000 });
  const publish = steps.getByRole('button', { name: 'Publish', exact: true });
  await expect(publish).toBeEnabled({ timeout: 60_000 });
  await publish.click();
  await expect(steps.getByText('Live on the site')).toBeVisible({ timeout: 15_000 });
  await page.locator('#admin-panel').getByRole('button', { name: 'All courses' }).click();
}

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
    'Clean-up',
    'Bundles',
    'Import courses',
    /Courses & publishing/,
    'Features & email',
    'Students',
  ]) {
    await tab(name).click();
    await expect(tab(name).selected).toHaveAttribute('aria-selected', 'true');
  }
  await page.goto('/admin?tab=tools');
  await expect(tab('Features & email').selected).toHaveAttribute('aria-selected', 'true');
  // Views that were merged keep their old links: the full check is Clean-up, Make pages is Folders.
  await page.goto('/admin?section=audit');
  await expect(tab('Clean-up').selected).toHaveAttribute('aria-selected', 'true');
  await page.goto('/admin?section=sync');
  await expect(tab('Import courses').selected).toHaveAttribute('aria-selected', 'true');
  await page.goto('/admin?section=access');
  await expect(tab('Students').selected).toHaveAttribute('aria-selected', 'true');
  await page.goto('/admin');
  await expect(tab('Today').selected).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: /needs? you/ })).toBeVisible();
});

test('one line says storage, website, page maker and payments are working', async () => {
  await expect(
    page.getByText(/Storage, website, page maker, payments.* and email are all working/),
  ).toBeVisible({
    timeout: 15_000,
  });
});

test('Folders: pick up storage changes for a course and watch its pages', async () => {
  await tab('Import courses').click();
  await page.getByRole('searchbox', { name: 'Find a folder or file' }).fill('Database Management Systems');
  await page
    .getByRole('list', { name: 'Search results' })
    .getByRole('button', { name: /^Database Management Systems/ })
    .first()
    .click();
  await expect(page.getByText(/This folder is the course/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Pick up changes' }).click();
  await expect(page.getByText(/Already up to date|Picked up:/)).toBeVisible({ timeout: 60_000 });
  const pages = page.getByRole('region', { name: 'Pages for this folder' });
  await expect(pages).toBeVisible();
  await expect(pages.getByText(/\d+ of \d+ ready/)).toBeVisible({ timeout: 15_000 });
  await pages.getByRole('button', { name: 'Close' }).click();
});

test('import a new course from storage', async () => {
  await tab('Import courses').click();
  await page.getByRole('button', { name: 'Make several courses at once' }).click();
  const pick = page.getByRole('checkbox', { name: 'Import Big Data Analytics as a course' });
  await expect(pick).toBeVisible({ timeout: 15_000 });
  await pick.check();
  await page.getByRole('button', { name: /^Branches for Big Data Analytics/ }).click();
  await page
    .getByRole('group', { name: 'Branches for Big Data Analytics' })
    .getByRole('checkbox')
    .first()
    .check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Import 1 course/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible({ timeout: 30_000 });
});

test('edit, hide, check, preview, publish and unpublish a course', async () => {
  await tab(/Courses & publishing/).click();
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('Big Data Analytics');
  const row = page.locator('#admin-panel').getByRole('listitem').filter({ hasText: 'Big Data Analytics' });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('draft', { exact: true })).toBeVisible();

  // Everything about the course opens in one workspace.
  await row.getByRole('button', { name: 'Open', exact: true }).click();
  const panel = page.locator('#admin-panel');
  await expect(panel.getByRole('heading', { name: 'Big Data Analytics' })).toBeVisible();

  // Details: edit the description.
  await panel.getByRole('tab', { name: 'Details' }).click();
  await panel
    .getByLabel('Description for Big Data Analytics')
    .fill('Hadoop, MapReduce and Spark, from seniors.');
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByText('Saved. The site shows it now.')).toBeVisible({ timeout: 15_000 });

  // Files & pages: every file with its state; hide a unit, then show it again.
  await panel.getByRole('tab', { name: 'Files & pages' }).click();
  await expect(panel.getByText(/\d+ ready · \d+ being made/)).toBeVisible({ timeout: 20_000 });
  const unit = panel.getByRole('region', { name: /Hadoop basics/ });
  await unit.getByRole('button', { name: 'Hide unit' }).click();
  await expect(unit.getByRole('button', { name: 'Show unit' })).toBeVisible({ timeout: 15_000 });
  await unit.getByRole('button', { name: 'Show unit' }).click();
  await expect(unit.getByRole('button', { name: 'Hide unit' })).toBeVisible({ timeout: 15_000 });

  // Free preview: each unit says what students see free.
  await panel.getByRole('tab', { name: 'Free preview' }).click();
  await expect(panel.getByText(/Students see/).first()).toBeVisible({ timeout: 15_000 });

  // Back to the list: price and publish (pages convert instantly in the e2e demo).
  await panel.getByRole('button', { name: 'All courses' }).click();
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('Big Data Analytics');
  await row.getByLabel('Price in rupees for Big Data Analytics').fill('59');
  await row.getByRole('button', { name: 'Save price' }).click();
  await expect(row.getByRole('button', { name: 'Save price' })).toBeHidden({ timeout: 15_000 });
  // Nothing goes live from the list: the checklist opens, and Publish waits for every step.
  await publishFromRow(row);
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('Big Data Analytics');
  await expect(row.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Changing the price of a live course keeps it on sale.
  await row.getByLabel('Price in rupees for Big Data Analytics').fill('69');
  await row.getByRole('button', { name: 'Save price' }).click();
  await expect(row.getByRole('button', { name: 'Save price' })).toBeHidden({ timeout: 15_000 });
  await expect(row.getByText('live', { exact: true })).toBeVisible();
  // It was filed under the first programme in the picker: look in that drawer.
  const first = await page.evaluate(
    async () => (await (await fetch('/api/catalogue')).json()).branches[0].slug,
  );
  await page.goto(`/?batch=2023&branch=${first}#catalogue`);
  await expect(page.locator('#catalogue').getByRole('link', { name: /Big Data Analytics/ })).toBeVisible({
    timeout: 15_000,
  });

  // Unpublish takes it off sale again.
  await page.goto('/admin?section=courses');
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('Big Data Analytics');
  await row.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(row.getByText('draft', { exact: true })).toBeVisible({ timeout: 15_000 });
  await publishFromRow(row);
  await page.getByRole('searchbox', { name: 'Search courses' }).fill('Big Data Analytics');
  await expect(row.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });
});

test('create a bundle', async () => {
  await tab('Bundles').click();
  await page.getByRole('button', { name: 'New bundle' }).click();
  await page.getByLabel('Bundle title').fill('E2E 2023 starter pack');
  await page.getByLabel('Batch').selectOption('2023');
  await page.getByRole('searchbox', { name: 'Search courses for the bundle' }).fill('');
  const boxes = page.locator('#admin-panel').getByRole('checkbox');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: 'Suggest ~30% off' }).click();
  await expect(page.getByLabel('Bundle price ₹')).not.toHaveValue('', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Create as draft' }).click();
  const row = page.locator('#admin-panel').getByRole('listitem').filter({ hasText: 'E2E 2023 starter pack' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  // Publish, unpublish, then delete it (nobody ordered it).
  await row.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(row.getByText('live', { exact: true })).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(row.getByText('draft', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('searchbox', { name: 'Search bundles' }).fill('E2E 2023');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete bundle' }).click();
  await expect(row).toHaveCount(0, { timeout: 15_000 });
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

test('students: give access by email from the Students list', async () => {
  await tab('Students').click();
  await expect(page.getByRole('searchbox', { name: 'Find a student' })).toBeVisible();
  await page.getByRole('button', { name: 'Give access', exact: true }).click();
  const give = page.getByRole('region', { name: 'Give access' });
  await expect(give.getByRole('option', { name: /3 months from today/ })).toBeAttached();
  await give.getByLabel(/Student emails/).fill('someone.25bce10999@vitbhopal.ac.in');
  await give.getByRole('button', { name: 'Give to 1 student' }).click();
  await expect(give.getByText(/Not signed up yet|can read this course now/)).toBeVisible({ timeout: 15_000 });
  await give.getByRole('button', { name: 'Close' }).click();
});
