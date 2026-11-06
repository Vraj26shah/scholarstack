import type { AdminBundleDto, AdminCourseDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button, LinkButton } from '../../shared/ui/button';
import { ErrorState, Sheet, Skeleton } from '../../shared/ui/feedback';
import { Field, Panel, StatusPill, input, plural, rupeesToPaise } from './ui';

interface Form {
  id?: string;
  title: string;
  description: string;
  batchYear: string;
  courseIds: string[];
  rupees: string;
  status: 'draft' | 'live' | 'archived';
}

const empty: Form = { title: '', description: '', batchYear: '', courseIds: [], rupees: '', status: 'draft' };

function useBundleRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['admin-bundles', 'bundles', 'bundle', 'course'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** A bundle: a title, a batch, the courses in it (search to find them) and its price. */
function BundleForm({
  initial,
  courses,
  onDone,
}: { initial: Form; courses: AdminCourseDto[]; onDone: () => void }) {
  const refresh = useBundleRefresh();
  const years = [...new Set(courses.map((c) => c.batchYear))].sort((a, b) => b - a);
  const [f, setF] = useState<Form>(() => ({
    ...initial,
    batchYear: initial.batchYear || String(years[0] ?? ''),
  }));
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const inBatch = courses
    .filter((c) => c.status !== 'archived' && c.batchYear === Number(f.batchYear))
    .sort((a, b) => a.semester - b.semester || a.title.localeCompare(b.title));
  const shown = inBatch.filter((c) =>
    words.every((w) =>
      [c.title, c.courseCode ?? '', `sem ${c.semester}`, ...c.branchSlugs]
        .join(' ')
        .toLowerCase()
        .includes(w),
    ),
  );
  const chosen = courses.filter((c) => f.courseIds.includes(c.id));
  const outside = chosen.filter((c) => c.batchYear !== Number(f.batchYear));
  const list = chosen.reduce((s, c) => s + c.pricePaise, 0);
  const price = rupeesToPaise(f.rupees);
  const savePaise = Math.max(0, list - price);
  const savePct = list > 0 && price > 0 ? Math.round((savePaise / list) * 100) : 0;

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
        batchYear: Number(f.batchYear),
        courseIds: chosen.map((c) => c.id),
        pricePaise: price,
        status: f.status,
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
    outside.length === 0 &&
    (f.status !== 'live' || notLive.length === 0) &&
    price >= 100 &&
    price < list;

  return (
    <div className="rounded-[22px] border-2 border-marigold bg-surface p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3 items-end">
        <Field label="Bundle title">
          <input
            className={input}
            value={f.title}
            maxLength={120}
            placeholder={`${String(f.batchYear).slice(2)} Batch · Semester 3`}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </Field>
        <Field label="Batch">
          <select
            className={input}
            value={f.batchYear}
            onChange={(e) => setF({ ...f, batchYear: e.target.value })}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <span className="font-semibold">
            Courses in this bundle <span className="tabular-nums">({chosen.length})</span>
          </span>
          <input
            type="search"
            aria-label="Search courses for the bundle"
            placeholder="Search title, code, sem…"
            className={`${input} h-10 w-full sm:w-72 text-sm`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {chosen.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5" aria-label="Chosen courses">
            {chosen.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-label={`Remove ${c.title}`}
                  className={`h-8 px-3 rounded-full border text-[13px] cursor-pointer ${
                    c.batchYear !== Number(f.batchYear)
                      ? 'border-blush-text text-blush-text'
                      : 'border-teal bg-mist/25 text-ink'
                  }`}
                >
                  {c.title} ×
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
                    Sem {c.semester} · {formatRupees(c.pricePaise)}
                    {c.status !== 'live' && ` · ${c.status}`}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="text-sm text-ink2">No {f.batchYear} course matches.</li>}
        </ul>
      </div>

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
      {outside.length > 0 && (
        <p className="m-0 text-sm text-blush-text">
          {outside.map((c) => c.title).join(', ')} {outside.length === 1 ? 'is' : 'are'} not in the{' '}
          {f.batchYear} batch. A bundle keeps to one batch; remove {outside.length === 1 ? 'it' : 'them'}.
        </p>
      )}
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
        pricePaise: b.pricePaise,
        status,
      }),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: () => api.adminDeleteBundle(b.id), onSuccess: refresh });
  const error = setStatus.error ?? del.error;
  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusPill status={b.status} />
        <div className="flex-[1_1_240px] min-w-0">
          <Link to={`/b/${b.slug}`} className="font-semibold text-ink no-underline hover:underline">
            {b.title}
          </Link>
          <div className="font-mono text-xs text-ink2">
            {b.batchYear ?? 'mixed batches'} · {plural(b.courseCount, 'live course')} of {b.courseIds.length}
          </div>
        </div>
        <div className="text-sm">
          <span className="line-through text-ink2 mr-2">{formatRupees(b.listPricePaise)}</span>
          <strong>{formatRupees(b.pricePaise)}</strong>
          <span className="ml-2 inline-flex h-6 px-2 rounded-md bg-marigold-soft text-marigold-text text-xs font-bold items-center">
            Save {b.savePercent}%
          </span>
        </div>
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
  const list = (bundles.data ?? []).filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase()));

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
        Courses of one batch, sold together for less. New bundles start as drafts.
      </p>
      {editing && courses.data && (
        <BundleForm
          key={editing.id ?? 'new'}
          initial={editing}
          courses={courses.data}
          onDone={() => setEditing(null)}
        />
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
                  batchYear: b.batchYear ? String(b.batchYear) : '',
                  courseIds: b.courseIds,
                  rupees: String(b.pricePaise / 100),
                  status: b.status,
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
