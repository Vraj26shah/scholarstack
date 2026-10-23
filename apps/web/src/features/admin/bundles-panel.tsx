import type { AdminBundleDto, AdminCourseDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Field, Panel, StatusPill, input, plural, rupeesToPaise } from './ui';

interface Form {
  id?: string;
  title: string;
  description: string;
  batchYear: string; // '' = any batch
  courseIds: string[];
  rupees: string;
  status: 'draft' | 'live' | 'archived';
}

const empty: Form = { title: '', description: '', batchYear: '', courseIds: [], rupees: '', status: 'live' };

function BundleForm({
  initial,
  courses,
  onDone,
}: { initial: Form; courses: AdminCourseDto[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(initial);
  const inBatch = courses.filter(
    (c) =>
      f.courseIds.includes(c.id) ||
      (c.status !== 'archived' && (!f.batchYear || c.batchYear === Number(f.batchYear))),
  );
  const chosen = courses.filter((c) => f.courseIds.includes(c.id) && c.status !== 'archived');
  const list = chosen.reduce((s, c) => s + c.pricePaise, 0);
  const price = rupeesToPaise(f.rupees);
  const savePaise = Math.max(0, list - price);
  const save = list > 0 && price > 0 ? Math.round((savePaise / list) * 100) : 0;
  const years = [...new Set(courses.map((c) => c.batchYear))].sort((a, b) => b - a);

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
        batchYear: f.batchYear ? Number(f.batchYear) : null,
        courseIds: chosen.map((c) => c.id),
        pricePaise: price,
        status: f.status,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-bundles'] });
      void qc.invalidateQueries({ queryKey: ['bundles'] });
      void qc.invalidateQueries({ queryKey: ['bundle'] });
      void qc.invalidateQueries({ queryKey: ['course'] });
      onDone();
    },
  });

  const wholeBatch = () => {
    if (!f.batchYear) return;
    const ids = courses
      .filter((c) => c.batchYear === Number(f.batchYear) && c.status === 'live')
      .map((c) => c.id);
    setF((x) => ({
      ...x,
      courseIds: ids,
      title: x.title || `${String(f.batchYear).slice(2)} Batch · complete set`,
    }));
  };
  const toggle = (id: string) =>
    setF((x) => ({
      ...x,
      courseIds: x.courseIds.includes(id) ? x.courseIds.filter((c) => c !== id) : [...x.courseIds, id],
    }));

  const liveSelectionValid =
    f.status !== 'live' ||
    (chosen.length === f.courseIds.length && chosen.length >= 2 && chosen.every((c) => c.status === 'live'));
  const ok =
    f.title.trim().length >= 2 &&
    chosen.length >= 2 &&
    liveSelectionValid &&
    price >= 100 &&
    price <= 5_000_000 &&
    price < list;

  return (
    <div className="rounded-[22px] border-2 border-marigold bg-surface p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[2fr_1fr_1fr] gap-3">
        <Field label="Bundle title" className="sm:col-span-2 md:col-span-1">
          <input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Batch">
          <select
            className={input}
            value={f.batchYear}
            onChange={(e) => setF({ ...f, batchYear: e.target.value })}
          >
            <option value="">Any batch</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select
            className={input}
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value as Form['status'] })}
          >
            <option value="live">Live</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Description" className="sm:col-span-2 md:col-span-3">
          <input
            className={input}
            value={f.description}
            maxLength={600}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Courses in this bundle ({f.courseIds.length})</span>
        {f.batchYear && (
          <Button variant="outline" onClick={wholeBatch}>
            Add every live {f.batchYear} course
          </Button>
        )}
      </div>
      <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 max-h-[320px] overflow-y-auto">
        {inBatch.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-3 p-3 rounded-xl bg-sunk cursor-pointer">
              <input
                type="checkbox"
                checked={f.courseIds.includes(c.id)}
                onChange={() => toggle(c.id)}
                className="w-5 h-5 accent-[var(--teal)]"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{c.title}</span>
                <span className="block font-mono text-[11px] text-ink2">
                  {c.callNo} · {formatRupees(c.pricePaise)} {c.status !== 'live' && `· ${c.status}`}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

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
              <strong className={save > 0 ? 'text-teal-text' : 'text-blush-text'}>
                {formatRupees(savePaise)} ({save}%)
              </strong>
            </>
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="buy" onClick={() => submit.mutate()} disabled={!ok || submit.isPending}>
            {submit.isPending ? 'Saving…' : f.id ? 'Save bundle' : 'Create bundle'}
          </Button>
        </div>
      </div>
      {price >= list && list > 0 && (
        <p className="m-0 text-sm text-blush-text">
          A bundle should cost less than buying its courses one by one.
        </p>
      )}
      {!liveSelectionValid && (
        <p className="m-0 text-sm text-blush-text">
          Publish every course in this bundle first, or save the bundle as a draft.
        </p>
      )}
      {submit.isError && <p className="m-0 text-sm text-blush-text">{friendly(submit.error)}</p>}
    </div>
  );
}

function BundleRow({ b, onEdit }: { b: AdminBundleDto; onEdit: () => void }) {
  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 flex flex-wrap items-center gap-4">
      <StatusPill status={b.status} />
      <div className="flex-[1_1_240px] min-w-0">
        <Link to={`/b/${b.slug}`} className="font-semibold text-ink no-underline hover:underline">
          {b.title}
        </Link>
        <div className="font-mono text-xs text-ink2">
          {b.batchYear ?? 'any batch'} · {plural(b.courseCount, 'live course')} of {b.courseIds.length}
        </div>
      </div>
      <div className="text-sm">
        <span className="line-through text-ink2 mr-2">{formatRupees(b.listPricePaise)}</span>
        <strong>{formatRupees(b.pricePaise)}</strong>
        <span className="ml-2 inline-flex h-6 px-2 rounded-md bg-marigold-soft text-marigold-text text-xs font-bold items-center">
          Save {formatRupees(Math.max(0, b.listPricePaise - b.pricePaise))} · {b.savePercent}%
        </span>
      </div>
      <Button variant="outline" onClick={onEdit}>
        Edit
      </Button>
    </li>
  );
}

export function BundlesPanel() {
  const bundles = useQuery({ queryKey: ['admin-bundles'], queryFn: api.adminBundles });
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const [editing, setEditing] = useState<Form | null>(null);

  return (
    <Panel
      title="Bundles"
      aside={
        !editing && (
          <Button variant="buy" onClick={() => setEditing(empty)}>
            New bundle
          </Button>
        )
      }
    >
      <p className="m-0 text-sm text-ink2 max-w-[720px]">
        Sell several courses together at a discount, e.g. a whole batch folder. Students who already own some
        of the courses pay proportionally less and get the rest. Single courses stay on sale as usual.
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
      ) : bundles.isError ? (
        <ErrorState
          title="Bundles didn't load."
          message={friendly(bundles.error)}
          onRetry={() => bundles.refetch()}
        />
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
          {bundles.data?.map((b) => (
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
          {bundles.data?.length === 0 && <li className="text-ink2">No bundles yet.</li>}
        </ul>
      )}
    </Panel>
  );
}
