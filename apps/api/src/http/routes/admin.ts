import {
  AccessChangeBody,
  AccessGrantBody,
  AdminSupportReplyBody,
  BoardScopeBody,
  BonusPaidBody,
  BranchSaveBody,
  ClearProblemsBody,
  CompareScopeBody,
  ContributionCopyBody,
  ContributionReviewBody,
  ContributionSettingsBody,
  ContributorBlockBody,
  ConversionProgressReport,
  ConversionReport,
  ConvertScopeBody,
  ConvertSelectionBody,
  CreateFeatureBody,
  DeleteCourseBody,
  ImportBody,
  MoveCourseFolderBody,
  MoveYearBody,
  PublishBody,
  RewardPaidBody,
  RoyaltyPayoutBody,
  SaveAnnouncementBody,
  SaveBundleBody,
  SaveFeatureBody,
  SetHiddenBody,
  SetRoyaltyBody,
  StorageCleanBody,
  StorageDeleteBody,
  StoragePathBody,
  SupportStatusBody,
  UpdateCourseBody,
  YearBody,
  YearVisibleBody,
} from '@ss/contracts';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { fail } from '../../application/errors';
import { safeEqual } from '../../infrastructure/crypto';
import { type AppEnv, requireLive } from '../helpers';
import { attachment } from '../upload-form';

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

adminRoutes.post('/admin/contributions/:id/copy', async (c) => {
  await requireAdmin(c);
  const { folder } = ContributionCopyBody.parse(await c.req.json());
  return c.json(await c.get('container').contributionReview.copyToFolder(c.req.param('id'), folder));
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
  const { path } = StoragePathBody.parse(await c.req.json());
  return c.json(await c.get('container').storageTree.preview(path));
});

adminRoutes.post('/admin/storage-tree/delete', async (c) => {
  await requireAdmin(c);
  const { path } = StorageDeleteBody.parse(await c.req.json());
  return c.json(await c.get('container').storageTree.remove(path));
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
  return c.json(await c.get('container').admin.syncHealth());
});

/** Selected-course R2, catalogue and converted-page reconciliation. Admin-only. */
adminRoutes.get('/admin/storage-audit', async (c) => {
  await requireAdmin(c);
  const courseId = z.string().uuid().parse(c.req.query('courseId'));
  return c.json(await c.get('container').admin.storageAuditCourse(courseId));
});

/** A page at a time, so a large R2 bucket never exhausts a Worker request. */
adminRoutes.get('/admin/storage-audit/bucket', async (c) => {
  await requireAdmin(c);
  const cursor = z.string().max(4096).optional().parse(c.req.query('cursor'));
  const prefix = z.string().max(1024).optional().parse(c.req.query('prefix')) ?? '';
  return c.json(await c.get('container').admin.storageInventoryPage(cursor, prefix));
});

/** Apply a completed source inventory to only the selected R2 source scope. */
adminRoutes.post('/admin/storage-audit/sync-scope', async (c) => {
  await requireAdmin(c);
  const { prefix } = z.object({ prefix: z.string().max(1024) }).parse(await c.req.json());
  return c.json(await c.get('container').admin.syncStorageScope(prefix));
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

adminRoutes.post('/admin/courses/:id/publish', async (c) => {
  await requireAdmin(c);
  const { pricePaise } = PublishBody.parse(await c.req.json());
  await c.get('container').admin.publish(c.req.param('id'), pricePaise);
  return c.json({ ok: true });
});

/** Units and files of a course, including those kept off the site. */
adminRoutes.get('/admin/courses/:id/units', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.listUnits(c.req.param('id')));
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
  return c.json(await c.get('container').admin.rescanFile(c.req.param('id'), sourceKey));
});

adminRoutes.post('/admin/courses/:id/sync-folder', async (c) => {
  await requireAdmin(c);
  const { prefix } = z.object({ prefix: z.string().min(1).max(2048) }).parse(await c.req.json());
  return c.json(await c.get('container').admin.rescanFolder(c.req.param('id'), prefix));
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

// ── Step-by-step workflow ──

adminRoutes.get('/admin/overview', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.overview());
});

adminRoutes.get('/admin/storage-compare', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.compareStorage());
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

adminRoutes.get('/admin/conversions', async (c) => {
  await requireAdmin(c);
  const courseId = c.req.query('courseId') || undefined;
  return c.json(await c.get('container').admin.conversionBoard(courseId));
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

/** The browser now fans this work out by source key to keep Worker subrequests bounded. */
adminRoutes.post('/admin/sync', async (c) => {
  await requireAdmin(c);
  throw fail.notReady(
    'Whole-catalogue sync is split into file-scoped requests to stay within Cloudflare limits. Use the Admin R2 sync controls and retry the specific file or folder.',
  );
});

// ── Students & access ──

adminRoutes.get('/admin/access', async (c) => {
  await requireAdmin(c);
  const courseId = z.string().min(1).max(64).parse(c.req.query('courseId'));
  return c.json(await c.get('container').admin.courseAccess(courseId));
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

/** The admin list the live site uses (managed from GitHub's ADMIN_EMAILS). */
adminRoutes.get('/admin/admins', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admins.list());
});

adminRoutes.post('/admin/announcements/:id/send', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').announcements.send(c.req.param('id')));
});

/** Private converter service callback, authenticated by a shared secret. */
adminRoutes.post('/internal/conversion-progress', async (c) => {
  const secret = c.req.header('x-ss-converter') ?? '';
  if (!safeEqual(secret, c.get('container').converterSecret)) throw fail.forbidden();
  const progress = ConversionProgressReport.parse(await c.req.json());
  await c.get('container').admin.recordConversionProgress(progress);
  return c.json({ ok: true });
});

adminRoutes.post('/internal/conversion', async (c) => {
  const secret = c.req.header('x-ss-converter') ?? '';
  if (!safeEqual(secret, c.get('container').converterSecret)) throw fail.forbidden();
  const report = ConversionReport.parse(await c.req.json());
  await c.get('container').admin.applyConversion(report);
  return c.json({ ok: true });
});
