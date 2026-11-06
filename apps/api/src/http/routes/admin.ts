import {
  AccessChangeBody,
  AccessGrantBody,
  AdminSupportReplyBody,
  BoardScopeBody,
  BonusPaidBody,
  BranchSaveBody,
  ClearProblemsBody,
  CompareScopeBody,
  CompleteContributionBody,
  ContributionCourseBody,
  ContributionReviewBody,
  ContributionSettingsBody,
  ContributorBlockBody,
  ConversionJobIdsBody,
  ConversionProgressReport,
  ConversionReport,
  ConvertScopeBody,
  ConvertSelectionBody,
  CourseBookBody,
  CourseBookOrderBody,
  CreateFeatureBody,
  DeleteCourseBody,
  FileContributionBody,
  ImportBody,
  MoveCourseFolderBody,
  MoveYearBody,
  RewardPaidBody,
  RoyaltyPayoutBody,
  SaveAnnouncementBody,
  SaveBundleBody,
  SaveFeatureBody,
  SetHiddenBody,
  SetRoyaltyBody,
  StorageCleanBody,
  StorageDeleteBody,
  StorageMoveBody,
  StoragePathsBody,
  StorageRenameBody,
  SupportBulkBody,
  SupportStatusBody,
  TILE_SEED_HEADER,
  UnitPreviewBody,
  UpdateCourseBody,
  YearBody,
  YearVisibleBody,
} from '@ss/contracts';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { openProblems, todaySummary } from '../../application/admin-today';
import { fail } from '../../application/errors';
import { safeEqual } from '../../infrastructure/crypto';
import { type AppEnv, requireLive } from '../helpers';
import { attachment, readUploadForm } from '../upload-form';

export const adminRoutes = new Hono<AppEnv>();

async function requireAdmin(c: Context<AppEnv>) {
  const live = await requireLive(c);
  if (!(await c.get('container').account.isAdmin(live.principal))) throw fail.forbidden();
  return live;
}

// ── Courses ──

adminRoutes.get('/admin/courses', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.listCourses());
});

// ── Contributions ──

adminRoutes.get('/admin/contributions', async (c) => {
  await requireAdmin(c);
  const status = z
    .enum(['pending', 'approved', 'rejected', 'all'])
    .catch('pending')
    .parse(c.req.query('status'));
  return c.json(await c.get('container').contributionReview.list(status));
});

/** Download one uploaded file. Always as an attachment, never shown inline (no scripts can run). */
adminRoutes.get('/admin/contributions/:id/files/:index', async (c) => {
  await requireAdmin(c);
  return attachment(
    await c.get('container').contributionReview.file(c.req.param('id'), Number(c.req.param('index'))),
  );
});

adminRoutes.post('/admin/contributions/:id/review', async (c) => {
  const { principal } = await requireAdmin(c);
  const body = ContributionReviewBody.parse(await c.req.json());
  return c.json(await c.get('container').contributionReview.review(c.req.param('id'), body, principal.email));
});

/** Show (dryRun) or do the filing of an accepted upload into a course, in our folder layout. */
adminRoutes.post('/admin/contributions/:id/file', async (c) => {
  await requireAdmin(c);
  const body = FileContributionBody.parse(await c.req.json());
  return c.json(await c.get('container').contributionFiling.file(c.req.param('id'), body));
});

/** Create a private draft course for an accepted contribution before filing its notes. */
adminRoutes.post('/admin/contributions/:id/course', async (c) => {
  await requireAdmin(c);
  const body = ContributionCourseBody.parse(await c.req.json());
  return c.json(await c.get('container').contributionFiling.createCourse(c.req.param('id'), body), 201);
});

/** Run the automatic file check on an upload made before checks existed. */
adminRoutes.post('/admin/contributions/:id/check', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').contributionReview.checkNow(c.req.param('id')));
});

/** Tick the whole job off; the student is emailed that their notes are live. */
adminRoutes.post('/admin/contributions/:id/complete', async (c) => {
  await requireAdmin(c);
  const { done, notify } = CompleteContributionBody.parse(await c.req.json());
  return c.json(await c.get('container').contributionReview.complete(c.req.param('id'), done, notify));
});

/** Every contributor and how they're doing. */
adminRoutes.get('/admin/contributors', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').contributorStats.list());
});

adminRoutes.delete('/admin/contributions/:id', async (c) => {
  await requireAdmin(c);
  await c.get('container').contributionReview.remove(c.req.param('id'));
  return c.json({ ok: true });
});

adminRoutes.post('/admin/contributions-settings', async (c) => {
  await requireAdmin(c);
  const { open } = ContributionSettingsBody.parse(await c.req.json());
  await c.get('container').contributionReview.setOpen(open);
  return c.json({ open });
});

adminRoutes.post('/admin/contributors/block', async (c) => {
  await requireAdmin(c);
  const { userId, blocked } = ContributorBlockBody.parse(await c.req.json());
  await c.get('container').contributionReview.setBlocked(userId, blocked);
  return c.json({ userId, blocked });
});

// ── Earnings & royalties ──

adminRoutes.get('/admin/earnings', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').earnings.overview());
});

adminRoutes.post('/admin/royalties', async (c) => {
  const { principal } = await requireAdmin(c);
  const body = SetRoyaltyBody.parse(await c.req.json());
  await c.get('container').earnings.setRoyalty(body, principal.email);
  return c.json({ ok: true });
});

adminRoutes.delete('/admin/royalties/:courseId', async (c) => {
  await requireAdmin(c);
  await c.get('container').earnings.removeRoyalty(c.req.param('courseId'));
  return c.json({ ok: true });
});

adminRoutes.post('/admin/royalties/payouts', async (c) => {
  const { principal } = await requireAdmin(c);
  const body = RoyaltyPayoutBody.parse(await c.req.json());
  return c.json(await c.get('container').earnings.recordPayout(body, principal.email), 201);
});

/** A cash reward for a contribution has been paid (by UPI, outside the site). */
adminRoutes.post('/admin/contributions/:id/reward-paid', async (c) => {
  await requireAdmin(c);
  const { note } = RewardPaidBody.parse(await c.req.json().catch(() => ({})));
  await c.get('container').earnings.markRewardPaid(c.req.param('id'), note);
  return c.json({ ok: true });
});

/** The yearly top-contributor bonus has been paid. */
adminRoutes.post('/admin/royalties/bonus', async (c) => {
  const { principal } = await requireAdmin(c);
  const body = BonusPaidBody.parse(await c.req.json());
  await c.get('container').earnings.recordBonus(body, principal.email);
  return c.json({ ok: true }, 201);
});

// ── Help desk ──

adminRoutes.get('/admin/support', async (c) => {
  await requireAdmin(c);
  const status = z.enum(['open', 'answered', 'closed', 'all']).catch('open').parse(c.req.query('status'));
  return c.json(await c.get('container').supportDesk.list(status));
});

adminRoutes.get('/admin/support/:id/files/:index', async (c) => {
  await requireAdmin(c);
  return attachment(
    await c.get('container').supportDesk.file(c.req.param('id'), Number(c.req.param('index'))),
  );
});

adminRoutes.post('/admin/support/:id/reply', async (c) => {
  await requireAdmin(c);
  const body = AdminSupportReplyBody.parse(await c.req.json());
  return c.json(await c.get('container').supportDesk.reply(c.req.param('id'), body));
});

adminRoutes.post('/admin/support/:id/status', async (c) => {
  await requireAdmin(c);
  const { status } = SupportStatusBody.parse(await c.req.json());
  await c.get('container').supportDesk.setStatus(c.req.param('id'), status);
  return c.json({ ok: true });
});

adminRoutes.post('/admin/support/bulk', async (c) => {
  await requireAdmin(c);
  const { ids, action } = SupportBulkBody.parse(await c.req.json());
  return c.json(await c.get('container').supportDesk.bulk(ids, action));
});

adminRoutes.delete('/admin/support/:id', async (c) => {
  await requireAdmin(c);
  await c.get('container').supportDesk.remove(c.req.param('id'));
  return c.json({ ok: true });
});

// ── Years & branches ──

adminRoutes.get('/admin/academic', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').academic.overview());
});

adminRoutes.post('/admin/academic/years', async (c) => {
  await requireAdmin(c);
  const { year } = YearBody.parse(await c.req.json());
  return c.json(await c.get('container').academic.addYear(year));
});

adminRoutes.put('/admin/academic/years/:year', async (c) => {
  await requireAdmin(c);
  const { year } = YearBody.parse({ year: Number(c.req.param('year')) });
  const { visible } = YearVisibleBody.parse(await c.req.json());
  return c.json(await c.get('container').academic.setYearVisible(year, visible));
});

adminRoutes.delete('/admin/academic/years/:year', async (c) => {
  await requireAdmin(c);
  const { year } = YearBody.parse({ year: Number(c.req.param('year')) });
  return c.json(await c.get('container').academic.deleteYear(year));
});

adminRoutes.post('/admin/academic/branches', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').academic.saveBranch(BranchSaveBody.parse(await c.req.json())));
});

adminRoutes.post('/admin/academic/move-year', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').academic.moveYear(MoveYearBody.parse(await c.req.json())));
});

// ── Storage tree (every notes file, and complete delete) ──

adminRoutes.get('/admin/storage-tree', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').storageTree.tree());
});

adminRoutes.post('/admin/storage-tree/preview', async (c) => {
  await requireAdmin(c);
  const paths = StoragePathsBody.parse(await c.req.json());
  return c.json(await c.get('container').storageTree.preview(paths));
});

adminRoutes.post('/admin/storage-tree/delete', async (c) => {
  await requireAdmin(c);
  const paths = StorageDeleteBody.parse(await c.req.json());
  return c.json(await c.get('container').storageTree.remove(paths));
});

/** Everything stored that nothing uses, by kind (and folders still waiting to be imported). */
adminRoutes.get('/admin/storage-unused', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').storageMap.unused());
});

/** Move files or folders into another folder; dryRun shows the plan. Pages are kept. */
/** A new, empty folder in storage. */
adminRoutes.post('/admin/storage-tree/folder', async (c) => {
  await requireAdmin(c);
  const { parent, name } = z
    .object({ parent: z.string().min(1).max(500), name: z.string().min(1).max(200) })
    .parse(await c.req.json());
  return c.json(await c.get('container').storageTree.createFolder(parent, name), 201);
});

/**
 * Files straight into a storage folder. Into a course's folder, they are registered on the
 * course and sent to be made into pages at once, so the course shows them without a rescan.
 */
adminRoutes.post('/admin/storage-tree/upload', async (c) => {
  await requireAdmin(c);
  const { meta, files } = await readUploadForm(c, 95 * 1024 * 1024);
  const { folder, replace } = z
    .object({ folder: z.string().min(1).max(500), replace: z.boolean().default(false) })
    .parse(meta);
  const k = c.get('container');
  const done = await k.storageTree.upload(folder, files, replace);
  let queued = 0;
  const problems: string[] = [];
  if (done.courseId)
    for (const key of done.keys) {
      try {
        // The admin put it there, so a new file doesn't take a live course off sale;
        // students see it once its pages are made.
        const r = await k.admin.rescanFile(done.courseId, key, { keepLiveForNewFiles: true });
        queued += r.conversionQueued;
        problems.push(...r.skipped);
      } catch (e) {
        problems.push(`${key.split('/').pop()}: ${(e as Error).message}`);
      }
    }
  return c.json({ ...done, queued, problems }, 201);
});

adminRoutes.post('/admin/storage-tree/move', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').storageTree.move(StorageMoveBody.parse(await c.req.json())));
});

/** Rename one file or folder where it is; dryRun shows the plan. */
adminRoutes.post('/admin/storage-tree/rename', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').storageTree.rename(StorageRenameBody.parse(await c.req.json())));
});

// ── Storage map ──

adminRoutes.get('/admin/storage-map', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').storageMap.map());
});

adminRoutes.post('/admin/storage-map/move-course', async (c) => {
  await requireAdmin(c);
  return c.json(
    await c.get('container').storageMap.moveCourseFolder(MoveCourseFolderBody.parse(await c.req.json())),
  );
});

adminRoutes.post('/admin/storage-map/clean', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').storageMap.clean(StorageCleanBody.parse(await c.req.json())));
});

// ── Problems log ──

adminRoutes.get('/admin/problems', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').problems.list());
});

adminRoutes.post('/admin/problems/clear', async (c) => {
  await requireAdmin(c);
  const { fingerprints } = ClearProblemsBody.parse(await c.req.json());
  return c.json({ cleared: await c.get('container').problems.clear(fingerprints) });
});

/** Independent R2, Supabase, and conversion-queue checks for the admin diagnostics card. */
adminRoutes.get('/admin/sync-health', async (c) => {
  await requireAdmin(c);
  const k = c.get('container');
  const [health, mail] = await Promise.all([
    k.admin.syncHealth(),
    k.mailer.check?.() ?? Promise.resolve({ ok: true, message: 'Emails are kept in the demo outbox.' }),
  ]);
  return c.json({
    ...health,
    email: { status: mail.ok ? ('connected' as const) : ('error' as const), message: mail.message },
  });
});

/** Delete an archived course for good (refused if anyone bought it). */
adminRoutes.post('/admin/courses/:id/delete', async (c) => {
  await requireAdmin(c);
  const { deleteNotes } = DeleteCourseBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.deleteCourse(c.req.param('id'), deleteNotes));
});

adminRoutes.patch('/admin/courses/:id', async (c) => {
  await requireAdmin(c);
  const patch = UpdateCourseBody.parse(await c.req.json());
  await c.get('container').admin.updateCourse(c.req.param('id'), patch);
  return c.json({ ok: true });
});

/** Any page of a converted file, for choosing a unit's free preview. */
adminRoutes.get('/admin/files/:id/pages/:page', async (c) => {
  await requireAdmin(c);
  const page = await c.get('container').previews.adminPage(c.req.param('id'), Number(c.req.param('page')));
  return new Response(page.body as BodyInit, {
    headers: {
      'content-type': page.contentType,
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      [TILE_SEED_HEADER]: page.tileSeed,
      'access-control-expose-headers': TILE_SEED_HEADER,
    },
  });
});

/** Choose a unit's free preview: a file of the unit and up to five pages (null file = default). */
adminRoutes.put('/admin/courses/:id/units/:unit/preview', async (c) => {
  await requireAdmin(c);
  const body = UnitPreviewBody.parse(await c.req.json());
  return c.json(await c.get('container').previews.choose(c.req.param('id'), c.req.param('unit'), body));
});

/** Recommended books on a course (names and links), plus titles spotted in its folder. */
adminRoutes.get('/admin/courses/:id/books', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').books.list(c.req.param('id')));
});

adminRoutes.post('/admin/courses/:id/books', async (c) => {
  await requireAdmin(c);
  const body = CourseBookBody.parse(await c.req.json());
  return c.json(await c.get('container').books.add(c.req.param('id'), body));
});

adminRoutes.put('/admin/courses/:id/books/order', async (c) => {
  await requireAdmin(c);
  const { ids } = CourseBookOrderBody.parse(await c.req.json());
  return c.json(await c.get('container').books.reorder(c.req.param('id'), ids));
});

adminRoutes.put('/admin/books/:id', async (c) => {
  await requireAdmin(c);
  const body = CourseBookBody.parse(await c.req.json());
  return c.json(await c.get('container').books.update(c.req.param('id'), body));
});

adminRoutes.delete('/admin/books/:id', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').books.remove(c.req.param('id')));
});

/** Units and files of a course, including those kept off the site. */
adminRoutes.get('/admin/courses/:id/units', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.listUnits(c.req.param('id')));
});

/** The publish checklist: each step, each visible file, and what is left. */
adminRoutes.get('/admin/courses/:id/publish-check', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.publishCheck(c.req.param('id')));
});

adminRoutes.get('/admin/courses/:id/inventory', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.inventory(c.req.param('id')));
});

adminRoutes.post('/admin/courses/:id/sync', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.rescanCourse(c.req.param('id')));
});

adminRoutes.post('/admin/courses/:id/sync-file', async (c) => {
  await requireAdmin(c);
  const { sourceKey } = z.object({ sourceKey: z.string().min(1).max(2048) }).parse(await c.req.json());
  // A new file the admin put in storage doesn't take a live course off sale; it shows once its
  // pages are made. A changed or missing file still does.
  return c.json(
    await c.get('container').admin.rescanFile(c.req.param('id'), sourceKey, { keepLiveForNewFiles: true }),
  );
});

adminRoutes.put('/admin/courses/:id/units/:key', async (c) => {
  await requireAdmin(c);
  const { hidden } = SetHiddenBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.setUnitHidden(c.req.param('id'), c.req.param('key'), hidden));
});

adminRoutes.put('/admin/files/:id', async (c) => {
  await requireAdmin(c);
  const { hidden } = SetHiddenBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.setFileHidden(c.req.param('id'), hidden));
});

adminRoutes.post('/admin/files/:id/retry-conversion', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.retryConversion(c.req.param('id')));
});

// ── Page jobs board: start, pause, resume, cancel, across every course ──

adminRoutes.post('/admin/conversions/pause', async (c) => {
  await requireAdmin(c);
  const { fileIds } = ConversionJobIdsBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.pauseConversion(fileIds));
});

adminRoutes.post('/admin/conversions/resume', async (c) => {
  await requireAdmin(c);
  const { fileIds } = ConversionJobIdsBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.resumeConversion(fileIds));
});

adminRoutes.post('/admin/conversions/cancel', async (c) => {
  await requireAdmin(c);
  const { fileIds } = ConversionJobIdsBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.cancelConversion(fileIds));
});

// ── Step-by-step workflow ──

/** Everything that needs the admin now, in one call (the first admin screen). */
adminRoutes.get('/admin/today', async (c) => {
  await requireAdmin(c);
  const k = c.get('container');
  // Two lines read the overview; ask for it once.
  let overview: ReturnType<typeof k.admin.overview> | undefined;
  const view = () => {
    overview ??= k.admin.overview();
    return overview;
  };
  return c.json(
    await todaySummary({
      questions: async () => (await k.supportDesk.list('open')).counts.open,
      uploads: async () => {
        const [pending, accepted] = await Promise.all([
          k.contributionReview.list('pending'),
          k.contributionReview.list('approved'),
        ]);
        // New ones, plus accepted ones waiting for the admin's next step (not for pages).
        const waiting = accepted.items.filter((x) => ['file', 'reward', 'finish'].includes(x.pipeline.step));
        return pending.items.length + waiting.length;
      },
      publish: async () => (await view()).courses.readyToPublish,
      files: async () => {
        const f = (await view()).files;
        return f.failed + f.waiting;
      },
      rewards: async () => {
        const e = await k.earnings.overview();
        return {
          count:
            e.cashRewards.filter((r) => !r.paidAt).length +
            e.courses.filter((x) => (x.royalty?.owedPaise ?? 0) > 0).length,
          amountPaise: e.totals.cashOwedPaise + e.totals.royaltyOwedPaise,
        };
      },
      emails: async () => (await k.announcements.list()).filter((a) => a.status === 'sending').length,
      problems: async () => openProblems(await k.problems.list()),
    }),
  );
});

adminRoutes.get('/admin/overview', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.overview());
});

adminRoutes.post('/admin/storage-compare', async (c) => {
  await requireAdmin(c);
  const { scopes } = CompareScopeBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.compareStorage(scopes));
});

adminRoutes.post('/admin/conversions/query', async (c) => {
  await requireAdmin(c);
  const { scopes } = BoardScopeBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.conversionBoard(undefined, scopes));
});

adminRoutes.post('/admin/convert-selection', async (c) => {
  await requireAdmin(c);
  const body = ConvertSelectionBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.convertSelection(body));
});

adminRoutes.post('/admin/convert', async (c) => {
  await requireAdmin(c);
  const body = ConvertScopeBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.convertScope(body));
});

// ── Import from R2 ──

adminRoutes.get('/admin/import', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.browse());
});

adminRoutes.post('/admin/import', async (c) => {
  await requireAdmin(c);
  const { courses } = ImportBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.importFolders(courses));
});

// ── Students & access ──

/** Every student with a course, their courses, dates, states and the last reason given. */
adminRoutes.get('/admin/students', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.students());
});

adminRoutes.post('/admin/access/change', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.changeAccess(AccessChangeBody.parse(await c.req.json())));
});

adminRoutes.post('/admin/access/grant', async (c) => {
  const live = await requireAdmin(c);
  return c.json(
    await c
      .get('container')
      .admin.grantAccess(AccessGrantBody.parse(await c.req.json()), live.principal.email),
  );
});

// ── Bundles ──

adminRoutes.get('/admin/bundles', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.listBundles());
});

adminRoutes.post('/admin/bundles', async (c) => {
  await requireAdmin(c);
  const body = SaveBundleBody.parse(await c.req.json());
  return c.json(await c.get('container').admin.saveBundle(body));
});

adminRoutes.delete('/admin/bundles/:id', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.deleteBundle(c.req.param('id')));
});

adminRoutes.post('/admin/bundles/suggest-price', async (c) => {
  await requireAdmin(c);
  const { courseIds } = z.object({ courseIds: z.array(z.string()).max(60) }).parse(await c.req.json());
  return c.json({ pricePaise: await c.get('container').admin.suggestPrice(courseIds) });
});

// ── Toolbox ──

adminRoutes.get('/admin/features', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.allFeatures());
});

adminRoutes.post('/admin/features', async (c) => {
  await requireAdmin(c);
  const body = CreateFeatureBody.parse(await c.req.json());
  return c.json(await c.get('container').announcements.createFeature(body), 201);
});

adminRoutes.put('/admin/features/:key', async (c) => {
  await requireAdmin(c);
  const body = SaveFeatureBody.parse(await c.req.json());
  return c.json(await c.get('container').announcements.saveFeature(c.req.param('key'), body));
});

/** Makes the tool live and drafts its announcement email. */
adminRoutes.delete('/admin/features/:key', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.deleteFeature(c.req.param('key')));
});

adminRoutes.delete('/admin/announcements/:id', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.deleteAnnouncement(c.req.param('id')));
});

adminRoutes.post('/admin/features/:key/launch', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.launchFeature(c.req.param('key')));
});

// ── Announcements ──

adminRoutes.get('/admin/email', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.status());
});

adminRoutes.get('/admin/announcements', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.list());
});

adminRoutes.post('/admin/announcements', async (c) => {
  await requireAdmin(c);
  const body = SaveAnnouncementBody.parse(await c.req.json());
  return c.json(await c.get('container').announcements.save(body));
});

adminRoutes.get('/admin/announcements/:id/preview', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.preview(c.req.param('id')));
});

adminRoutes.post('/admin/announcements/:id/test', async (c) => {
  const { principal } = await requireAdmin(c);
  await c.get('container').announcements.sendTest(c.req.param('id'), principal.email);
  return c.json({ ok: true, to: principal.email });
});

/** Who has this announcement and who is still waiting, with the day it should finish. */
adminRoutes.get('/admin/announcements/:id/deliveries', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.delivery(c.req.param('id')));
});

adminRoutes.post('/admin/announcements/:id/send', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.send(c.req.param('id')));
});

/** The runner discards a manifest entry if the app has superseded, paused, or removed it. */
adminRoutes.post('/internal/conversion-claim', async (c) => {
  const secret = c.req.header('x-ss-converter') ?? '';
  if (!safeEqual(secret, c.get('container').converterSecret)) throw fail.forbidden();
  const body = z
    .object({ fileId: z.string().min(1), queueId: z.string().uuid().optional() })
    .parse(await c.req.json());
  return c.json({ current: await c.get('container').admin.isCurrentConversion(body.fileId, body.queueId) });
});

/** Private converter service callback, authenticated by a shared secret. */
adminRoutes.post('/internal/conversion-progress', async (c) => {
  const secret = c.req.header('x-ss-converter') ?? '';
  if (!safeEqual(secret, c.get('container').converterSecret)) throw fail.forbidden();
  const progress = ConversionProgressReport.parse(await c.req.json());
  await c.get('container').admin.recordConversionProgress(progress);
  const current = await c.get('container').admin.isCurrentConversion(progress.fileId, progress.queueId);
  return c.json({ ok: true, current });
});

adminRoutes.post('/internal/conversion', async (c) => {
  const secret = c.req.header('x-ss-converter') ?? '';
  if (!safeEqual(secret, c.get('container').converterSecret)) throw fail.forbidden();
  const report = ConversionReport.parse(await c.req.json());
  await c.get('container').admin.applyConversion(report);
  return c.json({ ok: true });
});
