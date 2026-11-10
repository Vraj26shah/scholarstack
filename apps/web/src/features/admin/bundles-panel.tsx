import type { AdminBundleDto, AdminCourseDto, DrawerRef } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button, LinkButton } from '../../shared/ui/button';
import { ErrorState, Sheet, Skeleton } from '../../shared/ui/feedback';
import { DrawerPicker, DrawerSummary, drawerKey, fromKey } from './drawer-picker';
import { PacksCard } from './packs-card';
import { Field, Panel, StatusPill, input, plural, rupeesToPaise } from './ui';

interface Form {
  id?: string;
  title: string;
  description: string;
  /** Older bundles were kept to one batch; new ones leave this empty. */
  batchYear: number | null;
  courseIds: string[];
  rupees: string;
  status: 'draft' | 'live' | 'archived';
  /** Automatic: every drawer showing two or more of its courses. Choose: exactly the drawers picked. */
  mode: 'auto' | 'choose';
  drawers: Set<string>;
}

const empty: Form = {
  title: '',
  description: '',
  batchYear: null,
  courseIds: [],
  rupees: '',
  status: 'draft',
  mode: 'auto',
  drawers: new Set(),
};

function useBundleRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['admin-bundles', 'bundles', 'bundle', 'course', 'admin-offers'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** The drawers that show two or more of these courses (what "Automatic" will pick). */
function autoDrawers(chosen: AdminCourseDto[], programmes: string[], common: Set<string>): DrawerRef[] {
  const count = new Map<string, number>();
  let reaching = 0;
  for (const c of chosen) {
    const keys = new Set<string>();
    for (const o of c.offerings)
      for (const slug of common.has(o.branchSlug) ? programmes : [o.branchSlug])
        keys.add(`${o.batchYear}:${slug}`);
    if (keys.size) reaching++;
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const need = Math.max(1, Math.min(2, reaching));
  return [...count].filter(([, n]) => n >= need).map(([k]) => fromKey(k));
}

/**
 * A bundle: a title, the courses in it (from any batch: one course is often shared by several
 * years and programmes), who sees it, and its price.
 */
function BundleForm({
  initial,
  courses,
  onDone,
}: { initial: Form; courses: AdminCourseDto[]; onDone: () => void }) {
  const refresh = useBundleRefresh();
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const branches = index.data?.branches ?? [];
  const programmes = branches.filter((b) => !b.isCommon);
  const common = new Set(branches.filter((b) => b.isCommon).map((b) => b.slug));
  const years = [
    ...new Set(courses.flatMap((c) => [c.batchYear, ...c.offerings.map((o) => o.batchYear)])),
  ].sort((a, b) => b - a);
  const [f, setF] = useState<Form>(initial);
  const [q, setQ] = useState('');
  const [year, setYear] = useState('');
  const [branch, setBranch] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Find courses by the drawers they show in (not only the batch they were filed under).
  const showsIn = (c: AdminCourseDto) =>
    (!year && !branch) ||
    c.offerings.some(
      (o) =>
        (!year || o.batchYear === Number(year)) &&
        (!branch || o.branchSlug === branch || common.has(o.branchSlug)),
    ) ||
    ((!year || c.batchYear === Number(year)) && (!branch || c.branchSlugs.includes(branch)));
  const shown = courses
    .filter((c) => c.status !== 'archived' && showsIn(c))
    .filter((c) =>
      words.every((w) =>
        [c.title, c.courseCode ?? '', `sem ${c.semester}`, String(c.batchYear), ...c.branchSlugs]
          .join(' ')
          .toLowerCase()
          .includes(w),
      ),
    )
    .sort((a, b) => b.batchYear - a.batchYear || a.semester - b.semester || a.title.localeCompare(b.title));
  const chosen = courses.filter((c) => f.courseIds.includes(c.id));
  const list = chosen.reduce((s, c) => s + c.pricePaise, 0);
  const price = rupeesToPaise(f.rupees);
  const savePaise = Math.max(0, list - price);
  const savePct = list > 0 && price > 0 ? Math.round((savePaise / list) * 100) : 0;
  const auto = autoDrawers(
    chosen,
    programmes.map((b) => b.slug),
    common,
  ).filter((d) => f.batchYear === null || d.batchYear === f.batchYear);
  const audience = f.mode === 'auto' ? auto : [...f.drawers].map(fromKey);

  const suggest = useMutation({
    mutationFn: () => api.adminSuggestPrice(chosen.map((c) => c.id)),
    onSuccess: (r) => setF((x) => ({ ...x, rupees: String(r.pricePaise / 100) })),
  });
  const submit = useMutation({
    mutationFn: () =>
      api.adminSaveBundle({
        id: f.id,
        title: f.title.trim(),
        description: f.description.trim(),
        batchYear: f.mode === 'auto' ? f.batchYear : null,
        courseIds: chosen.map((c) => c.id),
        pricePaise: price,
        status: f.status,
        offeredTo: f.mode === 'auto' ? null : [...f.drawers].map(fromKey),
      }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const toggle = (id: string) =>
    setF((x) => ({
      ...x,
      courseIds: x.courseIds.includes(id) ? x.courseIds.filter((c) => c !== id) : [...x.courseIds, id],
    }));
  const notLive = chosen.filter((c) => c.status !== 'live');
  const ok =
    f.title.trim().length >= 2 &&
    chosen.length >= 2 &&
    (f.mode === 'auto' || f.drawers.size > 0) &&
    (f.status !== 'live' || (notLive.length === 0 && audience.length > 0)) &&
    price >= 100 &&
    price < list;

  return (
    <div className="rounded-[22px] border-2 border-marigold bg-surface p-5 flex flex-col gap-4">
      <Field label="Bundle title">
        <input
          className={input}
          value={f.title}
          maxLength={120}
          placeholder="CSE Semester 4 pack"
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
      </Field>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span className="font-semibold">
            Courses in this bundle <span className="tabular-nums">({chosen.length})</span>
          </span>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <select
              aria-label="Courses shown to batch"
              className={`${input} h-10 text-sm`}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              <option value="">Every batch</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y} batch
                </option>
              ))}
            </select>
            <select
              aria-label="Courses shown to programme"
              className={`${input} h-10 text-sm`}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
            >
              <option value="">Every programme</option>
              {programmes.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.code} · {b.name}
                </option>
              ))}
            </select>
            <input
              type="search"
              aria-label="Search courses for the bundle"
              placeholder="Search title, code, sem…"
              className={`${input} h-10 flex-1 sm:w-64 text-sm`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        {chosen.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5" aria-label="Chosen courses">
            {chosen.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-label={`Remove ${c.title}`}
                  className="h-8 px-3 rounded-full border text-[13px] cursor-pointer border-teal bg-mist/25 text-ink"
                >
                  {c.title} <span className="font-mono text-[11px] text-ink2">{c.batchYear}</span> ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul className="m-0 p-0 list-none max-h-[300px] overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 pr-1">
          {shown.map((c) => (
            <li key={c.id}>
              <label
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border-[1.5px] ${
                  f.courseIds.includes(c.id) ? 'border-teal bg-mist/25' : 'border-transparent bg-sunk'
                }`}
              >
                <input
                  type="checkbox"
                  checked={f.courseIds.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  className="w-5 h-5 accent-[var(--teal)] shrink-0"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate" title={c.title}>
                    {c.title}
                  </span>
                  <span className="block font-mono text-[11px] text-ink2 truncate">
                    {c.courseCode ? `${c.courseCode} · ` : ''}
                    {c.batchYear} · Sem {c.semester} · {formatRupees(c.pricePaise)}
                    {c.status !== 'live' && ` · ${c.status}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="text-sm text-ink2">No course matches.</li>}
        </ul>
      </div>

      <fieldset className="m-0 p-4 rounded-2xl border border-line flex flex-col gap-3">
        <legend className="px-1 font-semibold">Who sees this bundle</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who sees this bundle">
          {(
            [
              ['auto', 'Automatic'],
              ['choose', 'Choose batches & programmes'],
            ] as const
          ).map(([mode, text]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={f.mode === mode}
              onClick={() =>
                setF((x) => ({
                  ...x,
                  mode,
                  // Start the hand-picked list from what "Automatic" shows now.
                  drawers:
                    mode === 'choose' && x.drawers.size === 0 ? new Set(auto.map(drawerKey)) : x.drawers,
                }))
              }
              className={`h-9 rounded-full px-3.5 text-[13px] font-semibold border cursor-pointer ${
                f.mode === mode ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
        {f.mode === 'auto' ? (
          <p className="m-0 text-sm text-ink2">
            Shows in every drawer that has two or more of these courses
            {f.batchYear ? ` (kept to the ${f.batchYear} batch, as before)` : ''}:{' '}
            <strong className="text-ink">
              <DrawerSummary
                drawers={audience}
                empty={chosen.length < 2 ? 'pick two or more courses' : 'none yet, so choose them by hand'}
              />
            </strong>
          </p>
        ) : (
          <>
            <DrawerPicker
              label="Batches and programmes that see this bundle"
              value={f.drawers}
              onChange={(drawers) => setF((x) => ({ ...x, drawers }))}
            />
            <p className="m-0 text-sm text-ink2">
              {f.drawers.size ? (
                <>
                  Shows in:{' '}
                  <strong className="text-ink">{<DrawerSummary drawers={audience} empty="" />}</strong>
                </>
              ) : (
                'Pick at least one.'
              )}
            </p>
          </>
        )}
      </fieldset>

      <Field label="Description (optional)">
        <input
          className={input}
          value={f.description}
          maxLength={600}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Bundle price ₹">
          <input
            className={`${input} w-28 font-mono`}
            value={f.rupees}
            maxLength={5}
            inputMode="numeric"
            onChange={(e) => setF({ ...f, rupees: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Button
          variant="outline"
          onClick={() => suggest.mutate()}
          disabled={chosen.length < 2 || suggest.isPending}
        >
          Suggest ~30% off
        </Button>
        <span className="text-sm text-ink2 self-center">
          Separately: <strong className="text-ink">{formatRupees(list)}</strong>
          {price > 0 && list > 0 && (
            <>
              {' '}
              · students save{' '}
              <strong className={savePct > 0 ? 'text-teal-text' : 'text-blush-text'}>
                {formatRupees(savePaise)} ({savePct}%)
              </strong>
            </>
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="buy" onClick={() => submit.mutate()} disabled={!ok || submit.isPending}>
            {submit.isPending ? 'Saving…' : f.id ? 'Save bundle' : 'Create as draft'}
          </Button>
        </div>
      </div>
      <p className="m-0 text-[13px] text-ink2">
        Running a sale? Set it under Offers: it takes a percentage off for a few days and puts this price back
        when it ends.
      </p>
      {price >= list && list > 0 && (
        <p className="m-0 text-sm text-blush-text">A bundle should cost less than its courses one by one.</p>
      )}
      {f.status === 'live' && notLive.length > 0 && (
        <p className="m-0 text-sm text-blush-text">
          Not live yet: {notLive.map((c) => c.title).join(', ')}. Publish{' '}
          {notLive.length === 1 ? 'it' : 'them'} first.
        </p>
      )}
      {submit.isError && <p className="m-0 text-sm text-blush-text">{friendly(submit.error)}</p>}
    </div>
  );
}

function BundleRow({ b, onEdit }: { b: AdminBundleDto; onEdit: () => void }) {
  const refresh = useBundleRefresh();
  const [confirm, setConfirm] = useState(false);
  const setStatus = useMutation({
    mutationFn: (status: Form['status']) =>
      api.adminSaveBundle({
        id: b.id,
        title: b.title,
        description: b.description,
        batchYear: b.batchYear,
        courseIds: b.courseIds,
        pricePaise: b.basePricePaise,
        status,
        offeredTo: b.offeredTo,
      }),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: () => api.adminDeleteBundle(b.id), onSuccess: refresh });
  const detach = useMutation({ mutationFn: () => api.adminDetachPack(b.id), onSuccess: refresh });
  const error = setStatus.error ?? del.error ?? detach.error;
  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusPill status={b.status} />
        <div className="flex-[1_1_240px] min-w-0">
          <Link to={`/b/${b.slug}`} className="font-semibold text-ink no-underline hover:underline">
            {b.title}
          </Link>
          <div className="font-mono text-xs text-ink2">
            {plural(b.courseCount, 'live course')} of {b.courseIds.length} ·{' '}
            {b.autoDrawer ? 'drawer pack' : b.offeredTo ? 'chosen' : 'automatic'}
          </div>
          <div className="text-[13px] text-ink2">
            Shows in <DrawerSummary drawers={b.audience} empty="no drawer yet" />
          </div>
        </div>
        <div className="text-sm">
          <span className="line-through text-ink2 mr-2">{formatRupees(b.listPricePaise)}</span>
          <strong>{formatRupees(b.basePricePaise)}</strong>
          <span className="ml-2 inline-flex h-6 px-2 rounded-md bg-marigold-soft text-marigold-text text-xs font-bold items-center">
            Save {b.savePercent}%
          </span>
        </div>
        {b.autoDrawer ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`/b/${b.slug}`} variant="outline" size="sm">
              View
            </LinkButton>
            <Button
              variant="ghost"
              size="sm"
              disabled={detach.isPending}
              title="Keep it as it is: the pack builder stops changing it"
              onClick={() => detach.mutate()}
            >
              Make it a normal bundle
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {b.status === 'live' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate('draft')}
              >
                Unpublish
              </Button>
            ) : (
              <>
                <LinkButton to={`/b/${b.slug}`} variant="outline" size="sm">
                  Preview
                </LinkButton>
                <Button size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate('live')}>
                  Publish
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
            {b.status !== 'archived' && b.status !== 'live' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate('archived')}
              >
                Archive
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
      {confirm && (
        <Sheet open onOpenChange={(o) => !o && setConfirm(false)} title={`Delete “${b.title}”?`}>
          <p className="m-0 text-[15px]">
            Its courses stay on sale. A bundle someone ordered can only be archived.
          </p>
          {del.isError && <p className="m-0 text-sm text-blush-text">{friendly(del.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ink" disabled={del.isPending} onClick={() => del.mutate()}>
              {del.isPending ? 'Deleting…' : 'Delete bundle'}
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      )}
    </li>
  );
}

export function BundlesPanel() {
  const bundles = useQuery({ queryKey: ['admin-bundles'], queryFn: api.adminBundles });
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const [editing, setEditing] = useState<Form | null>(null);
  const [q, setQ] = useState('');
  const [showPacks, setShowPacks] = useState(false);
  const all = (bundles.data ?? []).filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase()));
  const packCount = all.filter((b) => b.autoDrawer).length;
  // Drawer packs can run to dozens; they stay folded unless asked for (or searched).
  const list = all.filter((b) => !b.autoDrawer || showPacks || q.trim());

  return (
    <Panel
      title="Bundles"
      aside={
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            aria-label="Search bundles"
            placeholder="Search bundles"
            className={`${input} h-10 w-48 text-sm`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {!editing && (
            <Button variant="buy" onClick={() => setEditing(empty)}>
              New bundle
            </Button>
          )}
        </div>
      }
    >
      <p className="m-0 text-sm text-ink2 max-w-[720px]">
        Courses sold together for less. They can come from any batch, and you choose which batches and
        programmes see the bundle (or let it follow its courses). New bundles start as drafts.
      </p>
      {editing && courses.data && (
        <BundleForm
          key={editing.id ?? 'new'}
          initial={editing}
          courses={courses.data}
          onDone={() => setEditing(null)}
        />
      )}
      <PacksCard />
      {packCount > 0 && !q.trim() && (
        <button
          type="button"
          onClick={() => setShowPacks((v) => !v)}
          aria-expanded={showPacks}
          className="self-start text-sm font-semibold text-teal-text underline cursor-pointer bg-transparent border-0 p-0"
        >
          {showPacks ? 'Hide drawer packs' : `Show ${plural(packCount, 'drawer pack')} in the list`}
        </button>
      )}
      {bundles.isLoading ? (
        <Skeleton className="h-40" />
      ) : bundles.isError && !bundles.data ? (
        <ErrorState
          title="Bundles didn't load."
          message={friendly(bundles.error)}
          onRetry={() => bundles.refetch()}
        />
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
          {list.map((b) => (
            <BundleRow
              key={b.id}
              b={b}
              onEdit={() =>
                setEditing({
                  id: b.id,
                  title: b.title,
                  description: b.description,
                  batchYear: b.batchYear,
                  courseIds: b.courseIds,
                  rupees: String(b.basePricePaise / 100),
                  status: b.status,
                  mode: b.offeredTo ? 'choose' : 'auto',
                  drawers: new Set((b.offeredTo ?? []).map(drawerKey)),
                })
              }
            />
          ))}
          {list.length === 0 && <li className="text-ink2">{q ? 'No bundle matches.' : 'No bundles yet.'}</li>}
        </ul>
      )}
    </Panel>
  );
}
