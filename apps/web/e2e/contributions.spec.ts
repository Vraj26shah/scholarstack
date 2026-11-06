import { type Page, expect, test } from '@playwright/test';

/** A student shares notes; the librarian downloads, accepts with a free course, and the student sees it. */
test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/** A stored (uncompressed) ZIP: students can only send ZIPs. */
function zip(files: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [];
  const dir: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    dir.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const size = dir.reduce((t, b) => t + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...dir, end]);
}

async function signIn(page: Page, username: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Shared demo admins hit the two-device limit across tests: take over the oldest device.
  const takeOver = page.getByRole('button', { name: 'Remove and sign in here' }).first();
  await Promise.race([
    page.waitForURL((u) => u.pathname === next),
    takeOver
      .waitFor({ timeout: 15_000 })
      .then(() => takeOver.click())
      .catch(() => undefined),
  ]);
  await page.waitForURL((u) => u.pathname === next);
}

test('share notes, review them, reward the student', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const student = await (await browser.newContext()).newPage();
  await signIn(student, 'contributor.e2e', '/contribute');
  await expect(student.getByRole('heading', { name: /Let them pay you/ })).toBeVisible();

  // The form explains what's missing instead of sending.
  await student.getByRole('button', { name: 'Send for review' }).click();
  await expect(student.getByRole('alert')).toContainText('Give it a title');

  await student.getByLabel('Title').fill('OS unit 3: scheduling, handwritten');
  await student.getByLabel('Course (code or name)').fill('Operating Systems');
  // Unsupported formats are turned away before sending.
  await student
    .locator('input[type=file]')
    .setInputFiles({ name: 'marks.xlsx', mimeType: 'application/octet-stream', buffer: PDF });
  await student.getByRole('button', { name: 'Send for review' }).click();
  await expect(student.getByRole('alert')).toContainText(
    'choose PDF, Word, PowerPoint, text, image or ZIP files',
  );
  // A new pick replaces the old selection; one submission can contain multiple supported files.
  await student.locator('input[type=file]').setInputFiles({
    name: 'os-unit-3.zip',
    mimeType: 'application/zip',
    buffer: zip([['os-unit-3.pdf', PDF]]),
  });
  await expect(student.getByText('os-unit-3.zip').first()).toBeVisible();
  await expect(student.getByText('marks.xlsx')).toHaveCount(0);
  // The layout is checked at once: a single file is fine, and it says how to make it a whole subject.
  await expect(student.getByRole('list', { name: 'ZIP format check' })).toContainText('30% of every sale');
  await student.getByRole('checkbox').check();
  await student.getByRole('button', { name: 'Send for review' }).click();
  await expect(student.getByText(/is in the review pile/)).toBeVisible({ timeout: 20_000 });
  await expect(student.getByText('In review', { exact: true }).first()).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'reviewer', '/admin');
  await admin.goto('/admin?section=contributions');
  const row = admin.getByRole('listitem').filter({ hasText: 'OS unit 3: scheduling' });
  await expect(row).toBeVisible();
  const download = admin.waitForEvent('download');
  await row.getByRole('button', { name: 'Download os-unit-3.zip' }).click();
  expect((await download).suggestedFilename()).toBe('os-unit-3.zip');

  // 1. Checked on upload.
  await expect(row.getByText(/ZIP · 1 file/).first()).toBeVisible();
  // 2. Decide.
  await row.getByRole('button', { name: 'Accept', exact: true }).click();
  await admin.getByRole('button', { name: 'In progress' }).click();
  const card = admin.getByRole('listitem').filter({ hasText: 'OS unit 3: scheduling' });
  // 3. File it into a course, in our layout (the course is guessed from what the student typed).
  await expect(card.getByLabel('Course', { exact: true })).not.toHaveValue('');
  // A module that doesn't exist yet: picked from the dropdown, named, and shown before filing.
  await card.getByLabel('Module', { exact: true }).selectOption('__new__');
  await card.getByLabel('New module name').fill('Unit 3 - Scheduling');
  await expect(card.getByText(/A new module “Unit 3 · Scheduling” is made in/)).toBeVisible();
  // Rename it on the way in.
  await card.getByLabel('Name for os-unit-3.zip › os-unit-3.pdf').fill('Scheduling notes.pdf');
  await expect(card.getByText('When you press File:')).toBeVisible();
  await card.getByRole('button', { name: /File 1 file and open Page jobs/ }).click();
  // Filing opens Page jobs; back in Uploads, the card waits on its pages, then the reward.
  await admin.waitForURL(/section=page-jobs/);
  await admin.goto('/admin?section=contributions&filter=progress');
  // 4. Reward.
  await card.getByRole('button', { name: 'A free course' }).click();
  await card.getByLabel('Course to give, free').selectOption({ index: 1 });
  await card.getByLabel('Note to the student (optional)').fill('Very clear, thank you!');
  await card.getByRole('button', { name: 'Give reward and email them' }).click();
  // 5–6. Pages are made, then mark it done.
  await expect(card.getByRole('button', { name: 'Mark done' })).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Mark done' }).click();
  await admin.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(
    admin
      .getByRole('listitem')
      .filter({ hasText: 'OS unit 3: scheduling' })
      .getByText(/Done on/),
  ).toBeVisible();

  await student.reload();
  await expect(student.getByText('Accepted', { exact: true }).first()).toBeVisible();
  await expect(student.getByText('Students are reading it in')).toBeVisible();
  await expect(student.getByText(/Free course:/)).toBeVisible();
});

test('a whole subject in the right layout is filed unit by unit and earns the 30% royalty', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const student = await (await browser.newContext()).newPage();
  await signIn(student, 'contributor.e2e', '/contribute');
  await student.getByLabel('Title').fill('Compiler Design, whole subject');
  await student.getByLabel('Course (code or name)').fill('Compiler Design');
  await student.locator('input[type=file]').setInputFiles({
    name: 'Compiler Design.zip',
    mimeType: 'application/zip',
    buffer: zip([
      ['Compiler Design/Syllabus/syllabus.pdf', PDF],
      ['Compiler Design/Unit 1 - Lexing/lexing.pdf', PDF],
      ['Compiler Design/Unit 2 - Parsing/parsing.pdf', PDF],
      ['Compiler Design/PYQs/2025.pdf', PDF],
    ]),
  });
  await expect(student.getByRole('list', { name: 'ZIP format check' })).toContainText(/whole subject/i);
  await student.getByRole('checkbox').check();
  await student.getByRole('button', { name: 'Send for review' }).click();
  await expect(student.getByText(/is in the review pile/)).toBeVisible({ timeout: 20_000 });

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'reviewer', '/admin');
  await admin.goto('/admin?section=contributions');
  const row = admin.getByRole('listitem').filter({ hasText: 'Compiler Design, whole subject' });
  await row.getByRole('button', { name: 'Accept', exact: true }).click();
  await admin.getByRole('button', { name: 'In progress' }).click();
  const card = admin.getByRole('listitem').filter({ hasText: 'Compiler Design, whole subject' });
  await expect(card.getByLabel('Course', { exact: true })).not.toHaveValue('');
  // No module to pick: the ZIP's own folders become the course's modules.
  await expect(card.getByText(/This ZIP is a whole subject/)).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: /File 4 files and open Page jobs/ }).click();
  await admin.waitForURL(/section=page-jobs/);
  await admin.goto('/admin?section=contributions&filter=progress');
  // The reward starts on the promised royalty.
  await expect(card.getByRole('button', { name: /Royalty · 30% of sales/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await card.getByRole('button', { name: 'Give reward and email them' }).click();
  await expect(card.getByRole('button', { name: 'Mark done' })).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Mark done' }).click();
  await student.reload();
  await expect(student.getByText(/30%/).first()).toBeVisible();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test('a student reports a problem with a screenshot; the admin answers from Queries', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const student = await (await browser.newContext()).newPage();
  await signIn(student, 'asker.e2e', '/shelf');
  await student.goto('/c/dbms-2025-cse-core');
  await expect(student.getByText(/check these units against your current syllabus/i)).toBeVisible();
  await student.getByRole('link', { name: 'Report a problem with these notes' }).click();
  await student.waitForURL((u) => u.pathname === '/help');
  await expect(student.getByRole('radio', { name: 'Notes' })).toBeChecked();
  await expect(student.getByText('From page · /c/dbms-2025-cse-core')).toBeVisible();
  await student.getByLabel('Subject').fill('Unit 3 preview is blurry');
  await student.getByLabel('What happened?').fill('The page-one preview of unit 3 is hard to read.');
  await student
    .locator('input[type=file]')
    .setInputFiles({ name: 'unit3.png', mimeType: 'image/png', buffer: PNG });
  await student.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(student.getByText(/We'll email you when we answer/)).toBeVisible({ timeout: 20_000 });

  const admin = await (await browser.newContext()).newPage();
  // Its own admin: each demo admin may only use two devices across the run.
  await signIn(admin, 'owner.demo@gmail.com', '/admin');
  await admin.goto('/admin?section=queries');
  const row = admin.getByRole('listitem').filter({ hasText: 'Unit 3 preview is blurry' });
  await expect(row).toContainText('asker.e2e@vitbhopal.ac.in');
  await expect(row).toContainText('/c/dbms-2025-cse-core');
  await row.getByLabel('Your answer').fill('Thanks! Fixed now, please try again.');
  await row.getByRole('button', { name: 'Send answer' }).click();
  await admin.getByRole('button', { name: /Answered/ }).click();
  await expect(admin.getByText('Thanks! Fixed now, please try again.')).toBeVisible();

  await student.reload();
  await expect(student.getByText('Thanks! Fixed now, please try again.')).toBeVisible();
  await student.getByRole('button', { name: "It's sorted, close it" }).click();
  await expect(student.getByText('Closed', { exact: true }).first()).toBeVisible();
});

test('admin deletes a folder completely from Storage', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'keeper', '/admin');
  await admin.goto('/admin?section=folders');
  await admin.getByRole('searchbox', { name: 'Find a folder or file' }).fill('Cloud Computing');
  await admin
    .getByRole('list', { name: 'Search results' })
    .getByRole('checkbox', { name: /^Tick .*Cloud Computing\/$/ })
    .first()
    .check({ timeout: 20_000 });
  await admin.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(admin.getByText(/This removes/)).toBeVisible();
  await admin.getByLabel('Type DELETE to confirm').fill('DELETE');
  await admin.getByRole('button', { name: 'Delete for good' }).click();
  await expect(admin.getByText(/Removed \d+ files?/)).toBeVisible({ timeout: 20_000 });
  await admin.getByRole('button', { name: 'Done' }).click();
});

test('admin adds a year and a branch', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'registrar', '/admin');
  await admin.goto('/admin?section=years');
  // Only the four current batches (and the next intake) can be added: a dropdown, not a free box.
  const pick = admin.getByRole('combobox', { name: 'Add a year' });
  await pick.selectOption({ index: 0 });
  const next = await pick.inputValue();
  await admin.getByRole('button', { name: 'Add year' }).click();
  await expect(admin.getByText(next, { exact: true })).toBeVisible();
  const add = admin.getByRole('listitem').last();
  await add.getByLabel('Code', { exact: true }).fill('IOT');
  await add.getByLabel('Name', { exact: true }).fill('B.Tech IoT');
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(admin.locator('input[value="B.Tech IoT"]')).toBeVisible();
});
