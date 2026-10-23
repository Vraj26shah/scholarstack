/**
 * Supabase adapters. The Worker uses the secret key (bypasses RLS), so every query
 * here filters by user explicitly. One small class per port.
 *
 * Table names follow the database design (DATABASE.md): programmes are the app's
 * "branches", subjects hold course codes, units are their own table. The domain
 * model stays the same; the mapping lives only here.
 */
import type { ConversionReport } from '@ss/contracts';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { DeviceLimitReached } from '../domain/entities';
import type {
  ActiveSession,
  Announcement,
  Branch,
  Bundle,
  Course,
  CourseFile,
  Device,
  Feature,
  FileUpsert,
  Order,
  Principal,
  Profile,
  ReadingProgress,
  ViewerLease,
} from '../domain/entities';
import type {
  AccessLog,
  AnnouncementRepository,
  BundleRepository,
  CatalogueReader,
  CatalogueWriter,
  DeviceRepository,
  EmailQuota,
  EntitlementRepository,
  FeatureRepository,
  LeaseRepository,
  OrderRepository,
  ProfileRepository,
  ProgressRepository,
  RecipientSource,
  SessionRegistry,
} from '../domain/ports';

export function supabaseClient(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function must<T>(res: { data: T; error: { message: string } | null }): T {
  // Upstream errors can be whole HTML pages (e.g. a firewall page): keep logs short.
  if (res.error) throw new Error(`Supabase: ${res.error.message.replace(/\s+/g, ' ').slice(0, 300)}`);
  return res.data;
}

type Row = Record<string, unknown>;

const toCourse = (r: Row): Course => ({
  id: r.id as string,
  slug: r.slug as string,
  title: r.title as string,
  courseCode: (r.subject_code as string | null) ?? null,
  description: (r.description as string) ?? '',
  batchYear: r.batch_year as number,
  branchSlug: r.primary_programme_slug as string,
  semester: r.semester as number,
  seq: r.seq as number,
  r2Prefix: r.r2_prefix as string,
  pricePaise: r.price_paise as number,
  status: r.status as Course['status'],
});

/** Files are always read with their unit (course_units) embedded. */
const FILE_SELECT = '*, course_units!inner(key, title, kind, sort, is_hidden)';

const toFile = (r: Row): CourseFile => {
  const u = (r.course_units ?? {}) as Row;
  return {
    id: r.id as string,
    courseId: r.course_id as string,
    unitKey: u.key as string,
    unitTitle: u.title as string,
    unitKind: (u.kind as CourseFile['unitKind']) ?? 'other',
    unitSort: (u.sort as number) ?? 0,
    unitHidden: u.is_hidden === true,
    hidden: r.is_hidden === true,
    name: r.name as string,
    format: r.format as CourseFile['format'],
    sizeBytes: Number(r.size_bytes),
    pageCount: r.page_count as number,
    sourceKey: r.source_key as string,
    sourceEtag: r.source_etag as string,
    sourceMissingAt: (r.source_missing_at as string | null) ?? null,
    conversionStatus: r.conversion_status as CourseFile['conversionStatus'],
    conversionError: (r.conversion_error as string | null) ?? null,
    conversionErrorStage: (r.conversion_error_stage as CourseFile['conversionErrorStage']) ?? null,
    conversionStage: (r.conversion_stage as CourseFile['conversionStage']) ?? null,
    conversionProgressCurrent: (r.conversion_progress_current as number) ?? 0,
    conversionProgressTotal: (r.conversion_progress_total as number) ?? 0,
    conversionQueueId: (r.conversion_queue_id as string | null) ?? null,
    conversionQueuePosition: (r.conversion_queue_position as number) ?? 0,
    conversionQueueTotal: (r.conversion_queue_total as number) ?? 0,
    conversionUpdatedAt: (r.conversion_updated_at as string | null) ?? null,
    sort: r.sort as number,
    previewKey: (r.preview_key as string | null) ?? null,
  };
};

const toDevice = (r: Row): Device => ({
  id: r.id as string,
  userId: r.user_id as string,
  label: r.label as string,
  createdAt: new Date(r.created_at as string),
  lastSeenAt: new Date(r.last_seen_at as string),
  revokedAt: r.revoked_at ? new Date(r.revoked_at as string) : null,
});

const toOrder = (r: Row): Order => ({
  id: r.id as string,
  userId: r.user_id as string,
  courseId: (r.course_id as string | null) ?? null,
  bundleId: (r.bundle_id as string | null) ?? null,
  courseIds:
    (r.course_ids as string[] | undefined) ??
    ((r.order_items as Row[] | undefined) ?? []).map((i) => i.course_id as string),
  amountPaise: r.amount_paise as number,
  gatewayOrderId: r.gateway_order_id as string,
  gatewayPaymentId: (r.gateway_payment_id as string | null) ?? null,
  status: r.status as Order['status'],
});

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
/** Only well-formed slugs ever reach the database (input validation, not just escaping). */
const isSlug = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 120;

export class SupabaseCatalogue implements CatalogueReader, CatalogueWriter {
  constructor(private readonly db: SupabaseClient) {}

  async listBatches() {
    const [batchRows, liveRows] = await Promise.all([
      this.db.from('batches').select('year').order('year', { ascending: false }),
      this.db.from('courses').select('batch_year').eq('status', 'live'),
    ]);
    const years = new Set((must(liveRows) as Row[]).map((row) => row.batch_year as number));
    return (must(batchRows) as { year: number }[]).filter((batch) => years.has(batch.year));
  }

  async listBranches(): Promise<Branch[]> {
    const rows = must(
      await this.db
        .from('programmes')
        .select('*, programme_subjects(subject_code)')
        .eq('is_active', true)
        .order('sort'),
    ) as Row[];
    return rows.map((r) => ({
      slug: r.slug as string,
      name: r.name as string,
      code: r.code as string,
      isCommon: r.is_common as boolean,
      sort: r.sort as number,
      shortName: r.short_name as string,
      tagline: r.tagline as string,
      description: r.description as string,
      courseCodes: ((r.programme_subjects as Row[] | null) ?? []).map((x) => x.subject_code as string).sort(),
      isActive: r.is_active as boolean,
    }));
  }

  async listLiveCourses(batchYear: number, branchSlug: string) {
    const rows = must(
      await this.db
        .from('courses')
        .select('*, course_programmes!inner(programme_slug)')
        .eq('course_programmes.programme_slug', branchSlug)
        .eq('batch_year', batchYear)
        .eq('status', 'live'),
    ) as Row[];
    return rows.map(toCourse);
  }

  async findCourse(idOrSlug: string) {
    const q = this.db.from('courses').select('*');
    if (!isUuid(idOrSlug) && !isSlug(idOrSlug)) return null;
    const res = await (isUuid(idOrSlug) ? q.eq('id', idOrSlug) : q.eq('slug', idOrSlug)).maybeSingle();
    const row = must(res) as Row | null;
    return row ? toCourse(row) : null;
  }

  async coursesByIds(ids: string[]) {
    const valid = [...new Set(ids)].filter(isUuid);
    if (valid.length === 0) return [];
    return (must(await this.db.from('courses').select('*').in('id', valid)) as Row[]).map(toCourse);
  }

  async ensureBatch(year: number) {
    must(await this.db.from('batches').upsert({ year }, { onConflict: 'year', ignoreDuplicates: true }));
  }

  /** Makes sure a course code exists in the subject catalogue, filling in a missing title. */
  private async ensureSubject(code: string | null | undefined, title: string | undefined) {
    if (!code) return;
    const row = must(
      await this.db.from('subjects').select('code, title').eq('code', code).maybeSingle(),
    ) as Row | null;
    if (!row) must(await this.db.from('subjects').insert({ code, title: title ?? '' }));
    else if (!row.title && title) must(await this.db.from('subjects').update({ title }).eq('code', code));
  }

  async listCourseBranchSlugs(courseIds: string[]) {
    const assignments = new Map<string, string[]>();
    const valid = courseIds.filter(isUuid);
    if (!valid.length) return assignments;
    const rows = must(
      await this.db.from('course_programmes').select('course_id, programme_slug').in('course_id', valid),
    ) as Row[];
    for (const row of rows) {
      const id = row.course_id as string;
      assignments.set(id, [...(assignments.get(id) ?? []), row.programme_slug as string]);
    }
    return assignments;
  }

  async setCourseBranches(courseId: string, branchSlugs: string[]) {
    must(
      await this.db.rpc('set_course_programmes', { p_course_id: courseId, p_programme_slugs: branchSlugs }),
    );
  }

  async updateCourse(courseId: string, patch: Partial<Omit<Course, 'id' | 'r2Prefix'>>) {
    if (!isUuid(courseId)) return null;
    if (patch.courseCode) await this.ensureSubject(patch.courseCode, patch.title);
    const cols: Record<string, unknown> = {};
    const map: Record<string, string> = {
      slug: 'slug',
      title: 'title',
      courseCode: 'subject_code',
      description: 'description',
      batchYear: 'batch_year',
      branchSlug: 'primary_programme_slug',
      semester: 'semester',
      seq: 'seq',
      pricePaise: 'price_paise',
      status: 'status',
    };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && map[k]) cols[map[k]] = v;
    if (Object.keys(cols).length === 0) return this.findCourse(courseId);
    const row = must(
      await this.db.from('courses').update(cols).eq('id', courseId).select('*').maybeSingle(),
    ) as Row | null;
    return row ? toCourse(row) : null;
  }

  async listFiles(courseIds: string[]) {
    const valid = courseIds.filter(isUuid);
    if (valid.length === 0) return [];
    const rows = must(
      await this.db
        .from('course_files')
        .select(FILE_SELECT)
        .in('course_id', valid)
        .eq('is_hidden', false)
        .eq('course_units.is_hidden', false),
    ) as Row[];
    return rows.map(toFile);
  }

  async listAllFiles(courseIds: string[]) {
    const valid = [...new Set(courseIds.filter(isUuid))];
    if (valid.length === 0) return [];
    const allRows: Row[] = [];
    // Keep each request below PostgREST's row cap; never silently audit only the first 1,000 files.
    for (let idOffset = 0; idOffset < valid.length; idOffset += 100) {
      const ids = valid.slice(idOffset, idOffset + 100);
      for (let from = 0; ; from += 1000) {
        const rows = must(
          await this.db
            .from('course_files')
            .select(FILE_SELECT)
            .in('course_id', ids)
            .order('id')
            .range(from, from + 999),
        ) as Row[];
        allRows.push(...rows);
        if (rows.length < 1000) break;
      }
    }
    return allRows.map(toFile);
  }

  async listPageManifests(fileIds: string[]) {
    const valid = [...new Set(fileIds.filter(isUuid))];
    const result = new Map<string, Array<{ pageNo: number; imageKey: string }>>(
      valid.map((fileId) => [fileId, []]),
    );
    for (let idOffset = 0; idOffset < valid.length; idOffset += 100) {
      const ids = valid.slice(idOffset, idOffset + 100);
      for (let from = 0; ; from += 1000) {
        const rows = must(
          await this.db
            .from('file_pages')
            .select('file_id,page_no,image_key')
            .in('file_id', ids)
            .order('file_id')
            .order('page_no')
            .range(from, from + 999),
        ) as Row[];
        for (const row of rows) {
          const fileId = row.file_id as string;
          const pages = result.get(fileId);
          if (pages) pages.push({ pageNo: row.page_no as number, imageKey: row.image_key as string });
        }
        if (rows.length < 1000) break;
      }
    }
    return result;
  }

  async listHiddenFiles(courseIds: string[]) {
    return (await this.listAllFiles(courseIds)).filter((f) => f.hidden || f.unitHidden);
  }

  async findAnyFile(fileId: string) {
    if (!isUuid(fileId)) return null;
    const row = must(
      await this.db.from('course_files').select(FILE_SELECT).eq('id', fileId).maybeSingle(),
    ) as Row | null;
    return row ? toFile(row) : null;
  }

  async findFile(fileId: string) {
    const file = await this.findAnyFile(fileId);
    return file && !file.hidden && !file.unitHidden ? file : null;
  }

  async setUnitHidden(courseId: string, unitKey: string, hidden: boolean) {
    if (!isUuid(courseId) || !isSlug(unitKey)) return false;
    const rows = must(
      await this.db
        .from('course_units')
        .update({ is_hidden: hidden })
        .eq('course_id', courseId)
        .eq('key', unitKey)
        .select('id'),
    ) as Row[];
    return rows.length > 0;
  }

  async setFileHidden(fileId: string, hidden: boolean) {
    if (!isUuid(fileId)) return false;
    const rows = must(
      await this.db.from('course_files').update({ is_hidden: hidden }).eq('id', fileId).select('id'),
    ) as Row[];
    return rows.length > 0;
  }

  async markFileSourceMissing(fileId: string) {
    if (!isUuid(fileId)) return false;
    const rows = must(
      await this.db
        .from('course_files')
        .update({
          source_missing_at: new Date().toISOString(),
          is_hidden: true,
          conversion_status: 'failed',
          conversion_error: 'R2 source missing. This file is offline until its source is restored.',
          conversion_error_stage: 'downloading_source',
          conversion_stage: 'failed',
          conversion_progress_current: 0,
          conversion_progress_total: 0,
          page_count: 0,
          preview_key: null,
          converted_at: new Date().toISOString(),
        })
        .eq('id', fileId)
        .select('id'),
    ) as Row[];
    if (!rows.length) return false;
    must(await this.db.from('file_pages').delete().eq('file_id', fileId));
    return true;
  }

  async markConversionPending(fileId: string) {
    if (!isUuid(fileId)) return false;
    must(await this.db.from('file_pages').delete().eq('file_id', fileId));
    const rows = must(
      await this.db
        .from('course_files')
        .update({
          conversion_status: 'pending',
          conversion_error: null,
          conversion_error_stage: null,
          conversion_stage: null,
          conversion_progress_current: 0,
          conversion_progress_total: 0,
          conversion_queue_id: null,
          conversion_queue_position: 0,
          conversion_queue_total: 0,
          conversion_updated_at: new Date().toISOString(),
          page_count: 0,
          preview_key: null,
          converted_at: null,
        })
        .eq('id', fileId)
        .select('id'),
    ) as Row[];
    return rows.length > 0;
  }

  async listAllCourses() {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const page = must(
        await this.db
          .from('courses')
          .select('*')
          .order('id')
          .range(from, from + 999),
      ) as Row[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows.map(toCourse);
  }

  async upsertCourseByPrefix(c: Omit<Course, 'id' | 'status'>) {
    const existing = must(
      await this.db.from('courses').select('*').eq('r2_prefix', c.r2Prefix).maybeSingle(),
    ) as Row | null;
    if (existing) return { course: toCourse(existing), created: false };
    await this.ensureSubject(c.courseCode, c.title);
    const row = must(
      await this.db
        .from('courses')
        .insert({
          slug: c.slug,
          title: c.title,
          subject_code: c.courseCode,
          description: c.description,
          batch_year: c.batchYear,
          primary_programme_slug: c.branchSlug,
          semester: c.semester,
          seq: c.seq,
          r2_prefix: c.r2Prefix,
          price_paise: c.pricePaise,
          status: 'draft',
        })
        .select('*')
        .single(),
    ) as Row;
    return { course: toCourse(row), created: true };
  }

  /** Finds or creates the unit; title, kind and order follow R2, visibility stays the admin's. */
  private async ensureUnit(f: FileUpsert): Promise<string> {
    const row = must(
      await this.db
        .from('course_units')
        .select('id, title, kind, sort')
        .eq('course_id', f.courseId)
        .eq('key', f.unitKey)
        .maybeSingle(),
    ) as Row | null;
    if (!row) {
      return (
        must(
          await this.db
            .from('course_units')
            .insert({
              course_id: f.courseId,
              key: f.unitKey,
              title: f.unitTitle,
              kind: f.unitKind,
              sort: f.unitSort,
              is_hidden: f.unitHiddenIfNew,
            })
            .select('id')
            .single(),
        ) as Row
      ).id as string;
    }
    if (row.title !== f.unitTitle || row.kind !== f.unitKind || row.sort !== f.unitSort) {
      must(
        await this.db
          .from('course_units')
          .update({ title: f.unitTitle, kind: f.unitKind, sort: f.unitSort })
          .eq('id', row.id as string),
      );
    }
    return row.id as string;
  }

  async upsertFileBySourceKey(f: FileUpsert) {
    const unitId = await this.ensureUnit(f);
    const existing = must(
      await this.db.from('course_files').select(FILE_SELECT).eq('source_key', f.sourceKey).maybeSingle(),
    ) as Row | null;
    if (
      existing &&
      existing.source_etag === f.sourceEtag &&
      Number(existing.size_bytes) === f.sizeBytes &&
      existing.unit_id === unitId
    ) {
      if (existing.source_missing_at) {
        const restored = must(
          await this.db
            .from('course_files')
            .update({ source_missing_at: null })
            .eq('id', existing.id as string)
            .select(FILE_SELECT)
            .single(),
        ) as Row;
        return { file: toFile(restored), change: 'same' as const };
      }
      return { file: toFile(existing), change: 'same' as const };
    }
    const values = {
      course_id: f.courseId,
      unit_id: unitId,
      name: f.name,
      format: f.format,
      size_bytes: f.sizeBytes,
      source_key: f.sourceKey,
      source_etag: f.sourceEtag,
      source_missing_at: null,
      sort: f.sort,
      conversion_status: 'pending',
      conversion_error: null,
      conversion_error_stage: null,
      conversion_stage: null,
      conversion_progress_current: 0,
      conversion_progress_total: 0,
      conversion_queue_id: null,
      conversion_queue_position: 0,
      conversion_queue_total: 0,
      conversion_updated_at: new Date().toISOString(),
      page_count: 0,
      preview_key: null,
      converted_at: null,
    };
    if (existing) {
      // A source revision invalidates its old page map before the new conversion begins.
      must(
        await this.db
          .from('file_pages')
          .delete()
          .eq('file_id', existing.id as string),
      );
    }
    const row = existing
      ? (must(
          await this.db
            .from('course_files')
            .update(values)
            .eq('id', existing.id as string)
            .select(FILE_SELECT)
            .single(),
        ) as Row)
      : (must(
          await this.db
            .from('course_files')
            .insert({ ...values, is_hidden: f.hiddenIfNew })
            .select(FILE_SELECT)
            .single(),
        ) as Row);
    return { file: toFile(row), change: existing ? ('changed' as const) : ('added' as const) };
  }

  async updateConversionProgress(
    progress: import('@ss/contracts').ConversionProgressReport & { error?: string; errorStage?: 'dispatch' },
  ) {
    if (progress.stage === 'queued') {
      must(await this.db.from('file_pages').delete().eq('file_id', progress.fileId));
    }
    const queued = progress.stage === 'queued';
    const failed = progress.stage === 'failed';
    must(
      await this.db
        .from('course_files')
        .update({
          conversion_stage: progress.stage,
          conversion_progress_current: progress.current,
          conversion_progress_total: progress.total,
          conversion_queue_id: progress.queueId,
          conversion_queue_position: progress.queuePosition,
          conversion_queue_total: progress.queueTotal,
          conversion_updated_at: new Date().toISOString(),
          ...(queued
            ? {
                conversion_status: 'pending',
                conversion_error: null,
                conversion_error_stage: null,
                page_count: 0,
                preview_key: null,
                converted_at: null,
              }
            : {}),
          ...(failed
            ? {
                conversion_status: 'failed',
                conversion_error: progress.error ?? 'The converter could not start this file.',
                conversion_error_stage: progress.errorStage ?? null,
                converted_at: new Date().toISOString(),
              }
            : {}),
          ...(!queued && !failed ? { conversion_error_stage: null } : {}),
        })
        .eq('id', progress.fileId),
    );
  }

  async applyConversion(report: ConversionReport) {
    // Clear the old manifest for both success and failure. A failed reconversion must never
    // leave Supabase pointing at stale pages from a previous source revision.
    must(await this.db.from('file_pages').delete().eq('file_id', report.fileId));
    if (report.status === 'ready') {
      // Insert in chunks: large textbooks can have hundreds of pages.
      for (let i = 0; i < report.pages.length; i += 500) {
        must(
          await this.db.from('file_pages').insert(
            report.pages.slice(i, i + 500).map((p) => ({
              file_id: report.fileId,
              page_no: p.pageNo,
              image_key: p.imageKey,
              tile_seed: p.tileSeed,
            })),
          ),
        );
      }
    }
    must(
      await this.db
        .from('course_files')
        .update({
          conversion_status: report.status,
          conversion_error: report.error ?? null,
          conversion_error_stage: report.status === 'failed' ? (report.errorStage ?? null) : null,
          conversion_stage: report.status === 'ready' ? 'complete' : 'failed',
          conversion_progress_current: report.status === 'ready' ? report.pages.length : 0,
          conversion_progress_total: report.status === 'ready' ? report.pages.length : 0,
          ...(report.queueId ? { conversion_queue_id: report.queueId } : {}),
          ...(report.queuePosition ? { conversion_queue_position: report.queuePosition } : {}),
          ...(report.queueTotal ? { conversion_queue_total: report.queueTotal } : {}),
          conversion_updated_at: new Date().toISOString(),
          page_count: report.status === 'ready' ? report.pages.length : 0,
          preview_key: report.status === 'ready' ? (report.previewKey ?? null) : null,
          converted_at: new Date().toISOString(),
        })
        .eq('id', report.fileId),
    );
  }

  async publishCourse(courseId: string, pricePaise: number) {
    const row = must(
      await this.db
        .from('courses')
        .update({ status: 'live', price_paise: pricePaise })
        .eq('id', courseId)
        .select('*')
        .maybeSingle(),
    ) as Row | null;
    return row ? toCourse(row) : null;
  }
}

export class SupabaseProfiles implements ProfileRepository {
  constructor(private readonly db: SupabaseClient) {}
  async ensure(p: Principal): Promise<Profile> {
    const row = must(
      await this.db.from('profiles').select('*').eq('id', p.userId).maybeSingle(),
    ) as Row | null;
    if (row)
      return {
        id: row.id as string,
        email: row.email as string,
        fullName: (row.full_name as string) ?? null,
        emailOptIn: row.email_opt_in !== false,
      };
    // The auth trigger normally creates this row; this is a safety net.
    const created = must(
      await this.db.from('profiles').upsert({ id: p.userId, email: p.email }).select('*').single(),
    ) as Row;
    return { id: created.id as string, email: created.email as string, fullName: null, emailOptIn: true };
  }
  async setEmailOptIn(userId: string, optIn: boolean) {
    must(
      await this.db
        .from('profiles')
        .update({ email_opt_in: optIn, unsubscribed_at: optIn ? null : new Date().toISOString() })
        .eq('id', userId),
    );
  }
  async updateName(userId: string, fullName: string) {
    must(await this.db.from('profiles').update({ full_name: fullName }).eq('id', userId));
  }
}

export class SupabaseDevices implements DeviceRepository {
  constructor(private readonly db: SupabaseClient) {}
  async listActive(userId: string) {
    const rows = must(
      await this.db
        .from('devices')
        .select('*')
        .eq('user_id', userId)
        .is('revoked_at', null)
        .order('created_at'),
    ) as Row[];
    return rows.map(toDevice);
  }
  async find(deviceId: string) {
    if (!isUuid(deviceId)) return null;
    const row = must(
      await this.db.from('devices').select('*').eq('id', deviceId).maybeSingle(),
    ) as Row | null;
    return row ? toDevice(row) : null;
  }
  async create(userId: string, label: string) {
    try {
      return toDevice(
        must(await this.db.from('devices').insert({ user_id: userId, label }).select('*').single()) as Row,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('SS_DEVICE_LIMIT')) throw new DeviceLimitReached();
      throw error;
    }
  }
  async touch(deviceId: string) {
    must(await this.db.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', deviceId));
  }
  async revoke(deviceId: string) {
    must(await this.db.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', deviceId));
  }
}

export class SupabaseSessions implements SessionRegistry {
  constructor(private readonly db: SupabaseClient) {}
  async list(userId: string): Promise<ActiveSession[]> {
    const rows = must(await this.db.from('active_sessions').select('*').eq('user_id', userId)) as Row[];
    return rows.map((row) => ({
      userId,
      sessionId: row.session_id as string,
      deviceId: row.device_id as string,
    }));
  }
  async set(s: ActiveSession) {
    must(
      await this.db.from('active_sessions').upsert(
        {
          user_id: s.userId,
          session_id: s.sessionId,
          device_id: s.deviceId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,device_id' },
      ),
    );
  }
}

/**
 * Leases live in Postgres; the lease id is kept inside the viewer token, and the row stores
 * which device and file currently hold it.
 */
export class SupabaseLeases implements LeaseRepository {
  constructor(private readonly db: SupabaseClient) {}
  async get(userId: string): Promise<ViewerLease | null> {
    const row = must(
      await this.db.from('viewer_leases').select('*').eq('user_id', userId).maybeSingle(),
    ) as Row | null;
    if (!row) return null;
    return {
      userId,
      leaseId: (row.lease_id as string) ?? '',
      deviceId: row.device_id as string,
      fileId: row.file_id as string,
      expiresAt: new Date(row.expires_at as string),
    };
  }
  async put(l: ViewerLease) {
    must(
      await this.db.from('viewer_leases').upsert({
        user_id: l.userId,
        lease_id: l.leaseId,
        device_id: l.deviceId,
        file_id: l.fileId,
        expires_at: l.expiresAt.toISOString(),
      }),
    );
  }
}

export class SupabaseOrders implements OrderRepository, EntitlementRepository {
  constructor(private readonly db: SupabaseClient) {}
  async create(o: Omit<Order, 'id' | 'status' | 'gatewayPaymentId'>) {
    // One transaction: the order and what it grants (order_items) are written together.
    const row = must(
      await this.db.rpc('create_order', {
        p_user_id: o.userId,
        p_course_id: o.courseId,
        p_bundle_id: o.bundleId,
        p_course_ids: o.courseIds,
        p_amount_paise: o.amountPaise,
        p_gateway_order_id: o.gatewayOrderId,
      }),
    ) as Row;
    return toOrder(row);
  }
  async findById(id: string) {
    if (!isUuid(id)) return null;
    const row = must(
      await this.db.from('orders').select('*, order_items(course_id)').eq('id', id).maybeSingle(),
    ) as Row | null;
    return row ? toOrder(row) : null;
  }
  async findByGatewayOrderId(gatewayOrderId: string) {
    const row = must(
      await this.db
        .from('orders')
        .select('*, order_items(course_id)')
        .eq('gateway_order_id', gatewayOrderId)
        .maybeSingle(),
    ) as Row | null;
    return row ? toOrder(row) : null;
  }
  async markFailed(gatewayOrderId: string) {
    must(
      await this.db
        .from('orders')
        .update({ status: 'failed' })
        .eq('gateway_order_id', gatewayOrderId)
        .eq('status', 'created'),
    );
  }
  async grant(gatewayOrderId: string, gatewayPaymentId: string) {
    must(
      await this.db.rpc('grant_order', {
        p_gateway_order_id: gatewayOrderId,
        p_gateway_payment_id: gatewayPaymentId,
      }),
    );
  }
  async revokeByPayment(gatewayPaymentId: string) {
    must(await this.db.rpc('revoke_by_payment', { p_gateway_payment_id: gatewayPaymentId }));
  }
  async has(userId: string, courseId: string) {
    const row = must(
      await this.db
        .from('entitlements')
        .select('course_id')
        .eq('user_id', userId)
        .eq('course_id', courseId)
        .is('revoked_at', null)
        .maybeSingle(),
    );
    return row !== null;
  }
  async listCourseIds(userId: string) {
    const rows = must(
      await this.db.from('entitlements').select('course_id').eq('user_id', userId).is('revoked_at', null),
    ) as Row[];
    return rows.map((r) => r.course_id as string);
  }
}

export class SupabaseReading implements ProgressRepository, AccessLog {
  constructor(private readonly db: SupabaseClient) {}
  async get(userId: string, fileId: string): Promise<ReadingProgress | null> {
    const row = must(
      await this.db
        .from('reading_progress')
        .select('*')
        .eq('user_id', userId)
        .eq('file_id', fileId)
        .maybeSingle(),
    ) as Row | null;
    return row
      ? { userId, fileId, page: row.page as number, updatedAt: new Date(row.updated_at as string) }
      : null;
  }
  async set(userId: string, fileId: string, page: number) {
    must(
      await this.db
        .from('reading_progress')
        .upsert({ user_id: userId, file_id: fileId, page, updated_at: new Date().toISOString() }),
    );
  }
  async latest(userId: string, limit: number) {
    const rows = must(
      await this.db
        .from('reading_progress')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(limit),
    ) as Row[];
    return rows.map((r) => ({
      userId,
      fileId: r.file_id as string,
      page: r.page as number,
      updatedAt: new Date(r.updated_at as string),
    }));
  }
  async addPages(userId: string, fileId: string, pages: number, ipHash: string, userAgent: string) {
    return must(
      await this.db.rpc('log_pages', {
        p_user: userId,
        p_file: fileId,
        p_pages: pages,
        p_ip_hash: ipHash,
        p_ua: userAgent,
      }),
    ) as number;
  }
  async pagesToday(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = must(
      await this.db.from('access_logs').select('pages_viewed').eq('user_id', userId).eq('day', today),
    ) as Row[];
    return rows.reduce((s, r) => s + (r.pages_viewed as number), 0);
  }
}

const toBundle = (r: Row): Bundle => ({
  id: r.id as string,
  slug: r.slug as string,
  title: r.title as string,
  description: (r.description as string) ?? '',
  batchYear: (r.batch_year as number | null) ?? null,
  pricePaise: r.price_paise as number,
  status: r.status as Bundle['status'],
  courseIds: ((r.bundle_courses as Row[] | null) ?? [])
    .sort((a, b) => ((a.sort as number) ?? 0) - ((b.sort as number) ?? 0))
    .map((x) => x.course_id as string),
});

export class SupabaseBundles implements BundleRepository {
  constructor(private readonly db: SupabaseClient) {}
  private query() {
    return this.db.from('bundles').select('*, bundle_courses(course_id, sort)');
  }
  async listLive() {
    return (must(await this.query().eq('status', 'live')) as Row[]).map(toBundle);
  }
  async listAll() {
    return (must(await this.query()) as Row[]).map(toBundle);
  }
  async find(idOrSlug: string) {
    if (!isUuid(idOrSlug) && !isSlug(idOrSlug)) return null;
    const q = this.query();
    const row = must(
      await (isUuid(idOrSlug) ? q.eq('id', idOrSlug) : q.eq('slug', idOrSlug)).maybeSingle(),
    ) as Row | null;
    return row ? toBundle(row) : null;
  }
  async save(b: Omit<Bundle, 'id'> & { id?: string }) {
    const values = {
      slug: b.slug,
      title: b.title,
      description: b.description,
      batch_year: b.batchYear,
      price_paise: b.pricePaise,
      status: b.status,
    };
    const row = (
      b.id
        ? must(await this.db.from('bundles').update(values).eq('id', b.id).select('id').single())
        : must(await this.db.from('bundles').insert(values).select('id').single())
    ) as Row;
    const id = row.id as string;
    must(await this.db.from('bundle_courses').delete().eq('bundle_id', id));
    const ids = [...new Set(b.courseIds)];
    if (ids.length > 0) {
      must(
        await this.db
          .from('bundle_courses')
          .insert(ids.map((course_id, sort) => ({ bundle_id: id, course_id, sort }))),
      );
    }
    return (await this.find(id))!;
  }
}

const toFeature = (r: Row): Feature => ({
  key: r.key as string,
  title: r.title as string,
  blurb: (r.blurb as string) ?? '',
  status: r.status as Feature['status'],
  sort: (r.sort as number) ?? 0,
});

export class SupabaseFeatures implements FeatureRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list() {
    return (must(await this.db.from('features').select('*')) as Row[]).map(toFeature);
  }
  async find(key: string) {
    const row = must(await this.db.from('features').select('*').eq('key', key).maybeSingle()) as Row | null;
    return row ? toFeature(row) : null;
  }
  async save(f: Feature) {
    const row = must(
      await this.db
        .from('features')
        .upsert({
          key: f.key,
          title: f.title,
          blurb: f.blurb,
          status: f.status,
          sort: f.sort,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single(),
    ) as Row;
    return toFeature(row);
  }
}

const toAnnouncement = (r: Row): Announcement => ({
  id: r.id as string,
  subject: r.subject as string,
  heading: r.heading as string,
  body: r.body as string,
  ctaLabel: (r.cta_label as string) ?? '',
  ctaUrl: (r.cta_url as string) ?? '',
  featureKey: (r.feature_key as string | null) ?? null,
  status: r.status as Announcement['status'],
  recipients: r.recipients as number,
  sent: r.sent as number,
  cursorId: (r.cursor_id as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  createdAt: new Date(r.created_at as string),
  sentAt: r.sent_at ? new Date(r.sent_at as string) : null,
});

export class SupabaseAnnouncements implements AnnouncementRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list() {
    return (
      must(
        await this.db.from('announcements').select('*').order('created_at', { ascending: false }).limit(100),
      ) as Row[]
    ).map(toAnnouncement);
  }
  async find(id: string) {
    if (!isUuid(id)) return null;
    const row = must(
      await this.db.from('announcements').select('*').eq('id', id).maybeSingle(),
    ) as Row | null;
    return row ? toAnnouncement(row) : null;
  }
  async create(a: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'featureKey'>) {
    const row = must(
      await this.db
        .from('announcements')
        .insert({
          subject: a.subject,
          heading: a.heading,
          body: a.body,
          cta_label: a.ctaLabel,
          cta_url: a.ctaUrl,
          feature_key: a.featureKey,
        })
        .select('*')
        .single(),
    ) as Row;
    return toAnnouncement(row);
  }
  async update(id: string, patch: Partial<Omit<Announcement, 'id' | 'createdAt'>>) {
    const map: Record<string, string> = {
      subject: 'subject',
      heading: 'heading',
      body: 'body',
      ctaLabel: 'cta_label',
      ctaUrl: 'cta_url',
      featureKey: 'feature_key',
      status: 'status',
      recipients: 'recipients',
      sent: 'sent',
      cursorId: 'cursor_id',
      error: 'error',
      sentAt: 'sent_at',
    };
    const cols: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !map[k]) continue;
      cols[map[k]] = v instanceof Date ? v.toISOString() : v;
    }
    const row = must(
      await this.db.from('announcements').update(cols).eq('id', id).select('*').single(),
    ) as Row;
    return toAnnouncement(row);
  }
  async listSending() {
    return (must(await this.db.from('announcements').select('*').eq('status', 'sending')) as Row[]).map(
      toAnnouncement,
    );
  }
}

export class SupabaseRecipients implements RecipientSource {
  constructor(private readonly db: SupabaseClient) {}
  async count() {
    const res = await this.db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('email_opt_in', true);
    if (res.error) throw new Error(`Supabase: ${res.error.message}`);
    return res.count ?? 0;
  }
  async after(cursorId: string | null, limit: number) {
    let q = this.db
      .from('profiles')
      .select('id, email, full_name')
      .eq('email_opt_in', true)
      .order('id')
      .limit(limit);
    if (cursorId) q = q.gt('id', cursorId);
    return (must(await q) as Row[]).map((r) => ({
      id: r.id as string,
      email: r.email as string,
      fullName: (r.full_name as string | null) ?? null,
    }));
  }
}

export class SupabaseQuota implements EmailQuota {
  constructor(private readonly db: SupabaseClient) {}
  async usedOn(day: string) {
    const row = must(
      await this.db.from('email_quota').select('sent').eq('day', day).maybeSingle(),
    ) as Row | null;
    return (row?.sent as number) ?? 0;
  }
  async add(day: string, count: number) {
    return must(await this.db.rpc('add_email_quota', { p_day: day, p_count: count })) as number;
  }
}
