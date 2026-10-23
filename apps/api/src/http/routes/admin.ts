import {
  ConversionProgressReport,
  ConversionReport,
  CreateFeatureBody,
  ImportBody,
  PublishBody,
  SaveAnnouncementBody,
  SaveBundleBody,
  SaveFeatureBody,
  SetHiddenBody,
  UpdateCourseBody,
} from '@ss/contracts';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { fail } from '../../application/errors';
import { safeEqual } from '../../infrastructure/crypto';
import { type AppEnv, requireLive } from '../helpers';

export const adminRoutes = new Hono<AppEnv>();

async function requireAdmin(c: Context<AppEnv>) {
  const live = await requireLive(c);
  if (!c.get('container').account.isAdmin(live.principal)) throw fail.forbidden();
  return live;
}

// ── Courses ──

adminRoutes.get('/admin/courses', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').admin.listCourses());
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
