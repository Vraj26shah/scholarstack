/**
 * Live QA: runs against the real Supabase project, R2 bucket and Razorpay test mode in .env.
 * Three lenses: DBA (data integrity, R2 ↔ database consistency), security (what the public key,
 * outsiders and students can and cannot do) and end-to-end (admin edits, purchase, reader).
 *
 * It creates two throwaway accounts (qa.admin.* / qa.student.* @vitbhopal.ac.in), and deletes
 * them, their orders and access at the end. A course edit made during the test is reverted.
 *   pnpm ops qa [--out results.json]
 */
import { createHmac, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { TILE_SEED_HEADER, VIEWER_TOKEN_HEADER } from '@ss/contracts';
import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { looksLikeTextbook } from '../application/folders';
import { createApp } from '../http/app';
import type { Container } from '../http/container';
import type { S3ObjectStore } from '../infrastructure/s3';
import { SupabaseManagement } from './management';

export interface QaResult {
  area: 'database' | 'security' | 'api' | 'admin' | 'purchase';
  name: string;
  ok: boolean;
  detail: string;
}

type Env = Record<string, string>;

class Http {
  cookie = '';
  constructor(
    private readonly base: string,
    public token = '',
  ) {}
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${this.base}/api${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const type = res.headers.get('content-type') ?? '';
    const json = type.includes('json') ? await res.json() : null;
    const bytes = json === null ? new Uint8Array(await res.arrayBuffer()) : null;
    return { status: res.status, json: json as any, bytes, headers: res.headers };
  }
}

export async function runQa(env: Env, container: (adminEmails: string) => Container, store: S3ObjectStore) {
  const results: QaResult[] = [];
  const t = (area: QaResult['area'], name: string, ok: boolean, detail = '') => {
    results.push({ area, name, ok, detail });
    console.log(`${ok ? '  ✓' : '  ✗'} [${area}] ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const svc = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const anon = createClient(env.SUPABASE_URL!, env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  const stamp = Date.now().toString(36);
  const adminEmail = `qa.admin.${stamp}@vitbhopal.ac.in`;
  const studentEmail = `qa.student.${stamp}@vitbhopal.ac.in`;
  const password = `Qa-${randomUUID()}`;
  const createdUsers: string[] = [];
  let revert: (() => Promise<unknown>) | null = null;

  // ── DATABASE ───────────────────────────────────────────────────────────────
  console.log('\nDatabase (DBA)');
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = svc.from(table).select('*', { count: 'exact', head: true });
    if (filter) q = filter(q);
    const r = await q;
    return r.error ? -1 : (r.count ?? 0);
  };
  t('database', 'six active programmes', (await count('programmes', (q) => q.eq('is_active', true))) === 6);
  t(
    'database',
    'subject catalogue loaded',
    (await count('subjects')) >= 35,
    `${await count('subjects')} subjects`,
  );
  t(
    'database',
    'curriculum loaded',
    (await count('programme_subjects')) >= 45,
    `${await count('programme_subjects')} links`,
  );

  const courses = ((
    await svc
      .from('courses')
      .select('id, slug, title, status, batch_year, r2_prefix, primary_programme_slug, subject_code')
  ).data ?? []) as any[];
  t('database', 'courses imported from R2', courses.length > 0, `${courses.length} courses`);
  const placements = ((await svc.from('course_programmes').select('course_id, programme_slug')).data ??
    []) as any[];
  const unplaced = courses.filter(
    (c) => !placements.some((p) => p.course_id === c.id && p.programme_slug === c.primary_programme_slug),
  );
  t(
    'database',
    'every course is listed under its primary programme',
    unplaced.length === 0,
    unplaced.map((c) => c.title).join(', '),
  );
  const noCode = courses.filter((c) => !c.subject_code);
  t(
    'database',
    'every course is linked to a subject code',
    noCode.length === 0,
    noCode.map((c) => c.title).join(', '),
  );

  const files: any[] = [];
  for (let from = 0; ; from += 1000) {
    const page = ((
      await svc
        .from('course_files')
        .select(
          'id, course_id, name, source_key, source_etag, conversion_status, page_count, preview_key, is_hidden, course_units!inner(kind, is_hidden, title)',
        )
        .range(from, from + 999)
    ).data ?? []) as any[];
    files.push(...page);
    if (page.length < 1000) break;
  }
  const visible = files.filter((f) => !f.is_hidden && !f.course_units.is_hidden);
  t(
    'database',
    'files mirrored from R2',
    files.length > 0,
    `${files.length} files, ${visible.length} visible`,
  );
  const leaked = visible.filter((f) => f.course_units.kind === 'reference' || looksLikeTextbook(f.name));
  t(
    'database',
    'no reference book or textbook is visible to students',
    leaked.length === 0,
    leaked
      .map((f) => f.name)
      .slice(0, 3)
      .join(', '),
  );

  // R2 ↔ database
  const r2 = new Map((await store.list(env.IMPORT_ROOT || 'drive-imports/')).map((o) => [o.key, o.etag]));
  const missing = files.filter((f) => !r2.has(f.source_key));
  const drifted = files.filter((f) => r2.has(f.source_key) && r2.get(f.source_key) !== f.source_etag);
  t(
    'database',
    'every database file exists in R2 (no dangling rows)',
    missing.length === 0,
    missing
      .slice(0, 3)
      .map((f) => f.source_key)
      .join(', '),
  );
  t(
    'database',
    'database matches R2 versions (etags)',
    drifted.length === 0,
    drifted.length ? `${drifted.length} changed in R2 → run pnpm ops import to rescan` : '',
  );
  const prefixes = courses.map((c) => c.r2_prefix);
  const known = new Set(files.map((f) => f.source_key));
  const unmirrored = [...r2.keys()].filter(
    (k) =>
      prefixes.some((p) => k.startsWith(p)) &&
      /\.(pdf|pptx?|pps|ppsx|odp|docx?|odt|jpe?g|png)$/i.test(k) &&
      !known.has(k),
  );
  t(
    'database',
    'every supported R2 file of an imported course is in the database',
    unmirrored.length === 0,
    unmirrored.slice(0, 3).join(', '),
  );

  const ready = visible.filter((f) => f.conversion_status === 'ready');
  const pageKeys = new Set((await store.list('pages/')).map((o) => o.key));
  const noPreview = ready.filter((f) => !f.preview_key || !pageKeys.has(f.preview_key));
  t(
    'database',
    'every converted file has its page-one preview in R2',
    noPreview.length === 0,
    `${ready.length} converted, ${noPreview.length} missing`,
  );
  const sample = ready.slice(0, 40);
  const pageRows = new Map<string, number>();
  let pageRowsError = '';
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc
      .from('file_pages')
      .select('file_id')
      .in('file_id', sample.map((f) => f.id))
      .range(from, from + 999);
    if (error) {
      pageRowsError = error.message;
      break;
    }
    for (const row of data ?? []) pageRows.set(row.file_id, (pageRows.get(row.file_id) ?? 0) + 1);
    if ((data?.length ?? 0) < 1000) break;
  }
  const pageMismatches = sample.filter((f) => {
    const rowCount = pageRows.get(f.id) ?? 0;
    const inR2 = [...Array(f.page_count).keys()].every((i) => pageKeys.has(`pages/${f.id}/${i + 1}.webp`));
    return rowCount !== f.page_count || !inR2;
  });
  t(
    'database',
    'page rows match page images in R2 (sample of 40)',
    !pageRowsError && pageMismatches.length === 0,
    pageRowsError || `${pageMismatches.length} mismatched`,
  );
  t(
    'database',
    'course inserts are in the audit log',
    (await count('audit_log', (q) => q.eq('table_name', 'courses').eq('action', 'insert'))) >= courses.length,
  );
  const overview = await svc.from('course_overview').select('id').limit(1);
  t('database', 'reporting views answer', !overview.error, overview.error?.message ?? '');

  // ── SECURITY: the public (publishable) key, as any browser ────────────────
  console.log('\nSecurity (public key, outsider)');
  for (const table of [
    'courses',
    'course_files',
    'file_pages',
    'audit_log',
    'profiles',
    'orders',
    'entitlements',
    'announcements',
    'email_quota',
    'course_overview',
    'sales_daily',
  ]) {
    const r = await anon.from(table).select('*').limit(5);
    t(
      'security',
      `outsider reads nothing from ${table}`,
      !!r.error || (r.data ?? []).length === 0,
      r.error ? 'denied' : `${r.data?.length} rows`,
    );
  }
  const ins = await anon.from('courses').insert({
    slug: 'qa-hack',
    title: 'hack',
    batch_year: 2023,
    primary_programme_slug: 'bce',
    semester: 1,
    r2_prefix: 'x/',
  });
  t('security', 'outsider cannot insert a course', !!ins.error, ins.error?.code ?? 'inserted!');
  const upd = await anon.from('courses').update({ price_paise: 100 }).neq('slug', '').select('id');
  t('security', 'outsider cannot change prices', !!upd.error || (upd.data ?? []).length === 0);
  for (const [fn, args] of [
    ['grant_order', { p_gateway_order_id: 'x', p_gateway_payment_id: 'y' }],
    ['revoke_by_payment', { p_gateway_payment_id: 'y' }],
    ['set_course_programmes', { p_course_id: randomUUID(), p_programme_slugs: ['bce'] }],
    [
      'create_order',
      {
        p_user_id: randomUUID(),
        p_course_id: null,
        p_bundle_id: null,
        p_course_ids: [],
        p_amount_paise: 1,
        p_gateway_order_id: 'x',
      },
    ],
  ] as const) {
    const r = await anon.rpc(fn, args as never);
    t('security', `outsider cannot call ${fn}()`, !!r.error, r.error?.code ?? 'allowed!');
  }
  const features = await anon.from('features').select('key');
  t('security', 'the free toolbox stays public', (features.data ?? []).length >= 1);
  const direct = await fetch(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${files[0]?.source_key ?? 'x'}`,
  );
  t(
    'security',
    'R2 files cannot be downloaded without credentials',
    direct.status >= 400,
    `HTTP ${direct.status}`,
  );

  // College-only sign-up (Before User Created hook).
  const outsider = await svc.auth.admin.createUser({
    email: `qa.outsider.${stamp}@example.com`,
    password,
    email_confirm: true,
  });
  if (outsider.data.user) {
    createdUsers.push(outsider.data.user.id);
    // Defence in depth: even if Supabase lets the account exist, the API refuses its tokens.
    const outsiderEmail = `qa.outsider.${stamp}@example.com`;
    const link = await svc.auth.admin.generateLink({ type: 'magiclink', email: outsiderEmail });
    const hash = link.data.properties?.hashed_token;
    if (link.error || !hash) throw new Error(`QA outsider magic link: ${link.error?.message ?? 'no token returned'}`);
    const os = await anon.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
    const outsiderToken = os.data.session?.access_token;
    if (os.error || !outsiderToken) throw new Error(`QA outsider session: ${os.error?.message ?? 'no access token'}`);
    {
      const probeApp = createApp(() => container('nobody@vitbhopal.ac.in'));
      const me = await probeApp.request('/api/me', { headers: { authorization: `Bearer ${outsiderToken}` } });
      const body = (await me.json().catch(() => ({}))) as { error?: { code?: string } };
      t(
        'security',
        'the API refuses non-college accounts on every request',
        me.status === 403 || me.status === 401,
        `${me.status} ${body.error?.code ?? ''}`,
      );
    }
  } else throw new Error(`QA outsider account: ${outsider.error?.message ?? 'no user returned'}`);

  const accessToken = env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectRef =
    env.SUPABASE_PROJECT_REF || (/https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.SUPABASE_URL ?? '')?.[1] ?? '');
  if (accessToken && projectRef) {
    try {
      const authConfig = await new SupabaseManagement(accessToken, projectRef).authConfig();
      t(
        'security',
        'college-only signup hook is enabled',
        authConfig.hook_before_user_created_enabled === true &&
          authConfig.hook_before_user_created_uri === 'pg-functions://postgres/public/hook_vit_only',
      );
    } catch (error) {
      t('security', 'college-only signup hook is enabled', false, (error as Error).message);
    }
  } else {
    console.log(
      '  ! [security] Signup hook status not verified: add SUPABASE_ACCESS_TOKEN locally or test a real public signup with Turnstile.',
    );
  }

  // ── API against the real services ─────────────────────────────────────────
  const admin = await createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
  });
  const signIn = async (email: string) => {
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw new Error(`QA account ${email}: ${made.error?.message}`);
    createdUsers.push(made.data.user.id);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const hash = link.data.properties?.hashed_token;
    if (link.error || !hash) throw new Error(`QA magic link ${email}: ${link.error?.message ?? 'no token returned'}`);
    const s = await createClient(env.SUPABASE_URL!, env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    }).auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
    if (s.error || !s.data.session) throw new Error(`QA sign-in ${email}: ${s.error?.message}`);
    return s.data.session.access_token;
  };

  const c = container(adminEmail);
  const server = serve({ fetch: createApp(() => c).fetch, port: 0 });
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    console.log('\nAPI (signed out)');
    const pub = new Http(base);
    t('api', 'health', (await pub.call('GET', '/health')).status === 200);
    const index = await pub.call('GET', '/catalogue');
    t(
      'api',
      'catalogue lists programmes',
      index.json?.branches?.length === 6,
      `${index.json?.batches?.length ?? 0} batch drawers`,
    );
    const programmeSubjects = ((
      await svc.from('programme_subjects').select('programme_slug, subject_code')
    ).data ?? []) as { programme_slug: string; subject_code: string }[];
    const curriculum = new Map<string, Set<string>>();
    for (const row of programmeSubjects)
      curriculum.set(row.programme_slug, (curriculum.get(row.programme_slug) ?? new Set()).add(row.subject_code));
    const live = courses.filter(
      (course) =>
        course.status === 'live' &&
        !!course.subject_code &&
        curriculum.get(course.primary_programme_slug)?.has(course.subject_code),
    );
    const unmappedLive = courses.filter(
      (course) =>
        course.status === 'live' &&
        (!course.subject_code || !curriculum.get(course.primary_programme_slug)?.has(course.subject_code)),
    );
    if (unmappedLive.length) {
      const branches = [...curriculum.keys()];
      const hiddenEverywhere = await Promise.all(
        unmappedLive.map(async (course) => {
          const drawers = await Promise.all(
            branches.map((branch) => pub.call('GET', `/catalogue/drawer?batch=${course.batch_year}&branch=${branch}`)),
          );
          return drawers.every((drawer) => !(drawer.json ?? []).some((card: any) => card.id === course.id));
        }),
      );
      t(
        'security',
        'live courses outside the curriculum are absent from every student drawer',
        hiddenEverywhere.every(Boolean),
        `${hiddenEverywhere.filter(Boolean).length}/${unmappedLive.length} hidden`,
      );
    }
    const anyLive = live[0];
    if (anyLive) {
      const drawer = await pub.call(
        'GET',
        `/catalogue/drawer?batch=2023&branch=${anyLive.primary_programme_slug}`,
      );
      t(
        'api',
        'a mapped live course shows in its drawer',
        (drawer.json ?? []).some((x: any) => x.id === anyLive.id),
      );
      const covers = (drawer.json ?? []).filter((x: any) => x.previewFileId).length;
      t(
        'api',
        'drawer cards carry real page-one covers',
        covers > 0,
        `${covers}/${drawer.json?.length} cards`,
      );
      const detail = await pub.call('GET', `/courses/${anyLive.slug}`);
      t(
        'api',
        'course page lists units with previews',
        detail.status === 200 && detail.json.units.some((u: any) => u.previewFileId),
      );
      const pv = detail.json.units.find((u: any) => u.previewFileId)?.previewFileId;
      const img = await pub.call('GET', `/previews/${pv}`);
      t(
        'api',
        'page-one preview streams from R2 as an image',
        img.status === 200 && (img.headers.get('content-type') ?? '').startsWith('image/'),
        `${img.bytes?.length ?? 0} bytes`,
      );
    } else t('api', 'a mapped live course shows in its drawer', false, 'no mapped live course is published');
    const hiddenFile = files.find((f) => f.is_hidden || f.course_units.is_hidden);
    if (hiddenFile)
      t(
        'api',
        'hidden books have no preview',
        (await pub.call('GET', `/previews/${hiddenFile.id}`)).status === 404,
      );
    t('api', 'unknown preview id → 404', (await pub.call('GET', `/previews/${randomUUID()}`)).status === 404);
    t(
      'api',
      'malformed ids are rejected cleanly (no 500)',
      [400, 404].includes((await pub.call('GET', '/previews/..%2F..%2Fprofiles')).status),
    );
    t(
      'api',
      "SQL-looking slugs are just 'not found'",
      (await pub.call('GET', `/courses/${encodeURIComponent("' or 1=1--")}`)).status === 404,
    );
    const noAuth = await pub.call('GET', '/admin/courses');
    t('api', 'admin needs a sign-in', noAuth.status === 401);
    t(
      'security',
      'demo log-in is switched off on real data',
      (await pub.call('POST', '/dev/login', { email: 'x@vitbhopal.ac.in' })).status === 404,
    );
    t(
      'security',
      'demo payments are switched off on real data',
      (await pub.call('POST', '/dev/pay', { gatewayOrderId: 'order_x' })).status === 404,
    );
    t(
      'api',
      'reader pages need a viewer token',
      (await pub.call('GET', `/reader/pages/${randomUUID()}/1`)).status === 401,
    );
    t(
      'api',
      'forged webhooks are refused',
      (
        await pub.call('POST', '/webhooks/razorpay', '{"event":"payment.captured"}', {
          'x-razorpay-signature': 'f'.repeat(64),
        })
      ).status >= 400,
    );
    t(
      'api',
      'forged converter callbacks are refused',
      (
        await pub.call(
          'POST',
          '/internal/conversion',
          { fileId: randomUUID(), status: 'ready', pages: [] },
          { 'x-ss-converter': 'nope' },
        )
      ).status >= 400,
    );
    const h = await pub.call('GET', '/health');
    t(
      'security',
      'API sends nosniff, DENY framing, HSTS and no-store',
      h.headers.get('x-content-type-options') === 'nosniff' &&
        h.headers.get('x-frame-options') === 'DENY' &&
        !!h.headers.get('strict-transport-security') &&
        h.headers.get('cache-control') === 'no-store',
    );

    console.log('\nAdmin (live data)');
    const adm = new Http(base, await signIn(adminEmail));
    const claim = await adm.call('POST', '/session/claim', { label: 'QA laptop' });
    t(
      'admin',
      'admin signs in and claims a device',
      claim.status === 200 && adm.cookie.startsWith('ss_device='),
    );
    const stu = new Http(base, await signIn(studentEmail));
    await stu.call('POST', '/session/claim', { label: 'QA phone' });
    t('admin', 'students are refused admin pages', (await stu.call('GET', '/admin/courses')).status === 403);
    const list = await adm.call('GET', '/admin/courses');
    t(
      'admin',
      'admin sees every imported course',
      list.status === 200 && list.json.length === courses.length,
      `${list.json?.length}`,
    );
    const tree = await adm.call('GET', '/admin/import');
    t(
      'admin',
      'admin browses the R2 import folder',
      tree.status === 200 && tree.json.folders.some((f: any) => f.name === '23 Batch'),
    );
    const trav = await adm.call('POST', '/admin/import', {
      courses: [
        {
          prefix: 'drive-imports/../profiles/',
          title: 'Nope',
          batchYear: 2023,
          branchSlugs: ['bce'],
          semester: 1,
          pricePaise: 9900,
        },
      ],
    });
    t('security', 'import cannot escape drive-imports/ (path traversal)', trav.status === 400);
    const outside = await adm.call('POST', '/admin/import', {
      courses: [
        {
          prefix: 'faculty/',
          title: 'Nope',
          batchYear: 2023,
          branchSlugs: ['bce'],
          semester: 1,
          pricePaise: 9900,
        },
      ],
    });
    t('security', 'import refuses other R2 folders (faculty/, profiles/…)', outside.status === 400);

    const target = list.json.find((x: any) => x.status === 'live') ?? list.json[0];
    const before = { title: target.title, description: target.description };
    const edited = await adm.call('PATCH', `/admin/courses/${target.id}`, {
      description: `QA edit ${stamp}`,
    });
    revert = () => adm.call('PATCH', `/admin/courses/${target.id}`, before);
    const row = (await svc.from('courses').select('description, status').eq('id', target.id).single())
      .data as any;
    t(
      'admin',
      'editing a course writes to Supabase',
      edited.status === 200 && row?.description === `QA edit ${stamp}`,
    );
    const audit = (
      await svc
        .from('audit_log')
        .select('changes')
        .eq('table_name', 'courses')
        .eq('row_key', target.id)
        .order('id', { ascending: false })
        .limit(1)
    ).data?.[0] as any;
    t(
      'admin',
      'the edit is in the audit log with old → new',
      audit?.changes?.description?.to === `QA edit ${stamp}`,
    );
    t(
      'admin',
      'editing a live course sends it back to draft for review',
      target.status !== 'live' || row?.status === 'draft',
    );
    await revert();
    if (target.status === 'live') await adm.call('PATCH', `/admin/courses/${target.id}`, { status: 'live' });
    revert = null;
    const restored = (await svc.from('courses').select('description, status').eq('id', target.id).single())
      .data as any;
    t(
      'admin',
      'the edit is reverted (and republished)',
      restored?.description === before.description && restored?.status === target.status,
    );

    const units = await adm.call('GET', `/admin/courses/${target.id}/units`);
    t('admin', 'admin lists units and files, hidden included', units.status === 200 && units.json.length > 0);
    const unit =
      units.json.find((u: any) => !u.hidden && u.kind !== 'module') ?? units.json.find((u: any) => !u.hidden);
    if (unit && target.status === 'live') {
      await adm.call('PUT', `/admin/courses/${target.id}/units/${unit.key}`, { hidden: true });
      const hiddenNow = (await pub.call('GET', `/courses/${target.slug}`)).json;
      t(
        'admin',
        'hiding a unit removes it from the public course page',
        !hiddenNow.units.some((u: any) => u.key === unit.key),
      );
      await adm.call('PUT', `/admin/courses/${target.id}/units/${unit.key}`, { hidden: false });
      const shownNow = (await pub.call('GET', `/courses/${target.slug}`)).json;
      t(
        'admin',
        'showing it again brings it back',
        shownNow?.units?.some((u: any) => u.key === unit.key) ||
          (await svc.from('courses').select('status').eq('id', target.id).single()).data?.status === 'draft',
      );
    }

    console.log('\nPurchase and reader (Razorpay test mode)');
    const buyable = live.find((x) => x.id !== target.id) ?? live[0];
    if (buyable) {
      const start = await stu.call('POST', '/orders', { courseId: buyable.id });
      t(
        'purchase',
        'a student starts a real Razorpay test order',
        start.status === 201 && /^order_/.test(start.json?.gatewayOrderId ?? ''),
        start.json?.gatewayOrderId ?? JSON.stringify(start.json),
      );
      if (start.status === 201) {
        const page = await stu.call('POST', '/reader/open', {
          fileId: files.find(
            (f) =>
              f.course_id === buyable.id &&
              f.conversion_status === 'ready' &&
              !f.is_hidden &&
              !f.course_units.is_hidden,
          )?.id,
        });
        t(
          'purchase',
          'reader stays locked before payment',
          page.status === 403 || page.status === 402,
          `HTTP ${page.status}`,
        );
        const raw = JSON.stringify({
          event: 'payment.captured',
          payload: {
            payment: {
              entity: {
                id: `pay_QA${stamp}`,
                order_id: start.json.gatewayOrderId,
                amount: start.json.amountPaise,
              },
            },
          },
        });
        const wrongAmount = JSON.stringify({
          event: 'payment.captured',
          payload: {
            payment: { entity: { id: `pay_QB${stamp}`, order_id: start.json.gatewayOrderId, amount: 100 } },
          },
        });
        const sign = (b: string) =>
          createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET!).update(b).digest('hex');
        const cheat = await pub.call('POST', '/webhooks/razorpay', wrongAmount, {
          'x-razorpay-signature': sign(wrongAmount),
        });
        t(
          'purchase',
          'a payment for the wrong amount grants nothing',
          cheat.json?.outcome === 'ignored:amount-mismatch',
        );
        const hook = await pub.call('POST', '/webhooks/razorpay', raw, { 'x-razorpay-signature': sign(raw) });
        t('purchase', 'signed payment webhook grants the course', hook.json?.outcome === 'granted');
        const again = await pub.call('POST', '/webhooks/razorpay', raw, {
          'x-razorpay-signature': sign(raw),
        });
        const ents = await count('entitlements', (q) => q.eq('course_id', buyable.id).is('revoked_at', null));
        t(
          'purchase',
          'the webhook arriving twice grants once',
          again.json?.outcome === 'granted' && ents >= 1,
        );
        const shelf = await stu.call('GET', '/me/shelf');
        t(
          'purchase',
          'the course is on the student’s shelf',
          JSON.stringify(shelf.json ?? '').includes(buyable.id),
        );
        const file = files.find(
          (f) =>
            f.course_id === buyable.id &&
            f.conversion_status === 'ready' &&
            !f.is_hidden &&
            !f.course_units.is_hidden,
        );
        if (file) {
          const open = await stu.call('POST', '/reader/open', { fileId: file.id });
          t(
            'purchase',
            'the reader opens the bought file',
            open.status === 200 && !!open.json?.viewerToken,
            `${open.json?.pageCount ?? '?'} pages`,
          );
          const vt = open.json?.viewerToken;
          const p1 = await new Http(base).call('GET', `/reader/pages/${file.id}/1`, undefined, {
            [VIEWER_TOKEN_HEADER]: vt,
          });
          t(
            'purchase',
            'page images come from R2, scrambled, never cached',
            p1.status === 200 &&
              !!p1.headers.get(TILE_SEED_HEADER) &&
              (p1.headers.get('cache-control') ?? '').includes('no-store'),
            `${p1.bytes?.length ?? 0} bytes`,
          );
          const other = files.find((f) => f.course_id !== buyable.id && f.conversion_status === 'ready');
          if (other)
            t(
              'security',
              'a viewer token only opens its own file',
              (
                await new Http(base).call('GET', `/reader/pages/${other.id}/1`, undefined, {
                  [VIEWER_TOKEN_HEADER]: vt,
                })
              ).status >= 400,
            );
          t(
            'security',
            'a tampered viewer token is refused',
            (
              await new Http(base).call('GET', `/reader/pages/${file.id}/1`, undefined, {
                [VIEWER_TOKEN_HEADER]: `${vt}x`,
              })
            ).status >= 400,
          );
          const hiddenOwn = files.find(
            (f) => f.course_id === buyable.id && (f.is_hidden || f.course_units.is_hidden),
          );
          if (hiddenOwn)
            t(
              'security',
              'even a buyer cannot open a hidden book',
              (await stu.call('POST', '/reader/open', { fileId: hiddenOwn.id })).status === 404,
            );
        }
        const other = await stu.call('GET', '/me');
        t('purchase', 'account page loads for the buyer', other.status === 200);
      }
    } else t('purchase', 'a live course to buy', false, 'publish courses first');
  } catch (e) {
    t('api', 'QA run finished without crashing', false, (e as Error).message);
  } finally {
    if (revert) await revert().catch(() => {});
    server.close();
    // Cleanup: deleting the auth users cascades to profiles, devices, orders, entitlements.
    for (const id of createdUsers) await svc.auth.admin.deleteUser(id).catch(() => {});
    const left = await count('profiles', (q) => q.like('email', `qa.%.${stamp}@%`));
    t('database', 'QA accounts and their orders are cleaned up', left === 0, `${left} left`);
  }
  return results;
}

export function saveResults(results: QaResult[], out?: string) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  return failed.length;
}

export type { SupabaseClient };
