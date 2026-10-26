import { type AdminBundleDto, type AdminCourseDto, BRANCH_CATALOG } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button, LinkButton } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Field, Panel, StatusPill, input, plural, rupeesToPaise } from './ui';

interface Form {
  id?: string;
  title: string;
  description: string;
  batchYear: string;
  /** Who the pack is for: one programme or '' for every programme. */
  programme: string;
  /** '' = every semester (a complete-batch set), otherwise one semester. */
  semester: string;
  courseIds: string[];
  rupees: string;
  status: 'draft' | 'live' | 'archived';
}

const empty: Form = {
  title: '',
  description: '',
  batchYear: '',
  programme: '',
  semester: '',
  courseIds: [],
  rupees: '',
  status: 'live',
};

const PROGRAMMES = BRANCH_CATALOG.map((b) => ({ slug: b.slug, code: b.id, name: b.name }));
const programmeCode = (slug: string) => PROGRAMMES.find((p) => p.slug === slug)?.code ?? slug.toUpperCase();

/** A course belongs to a bundle's scope when it matches its batch, semester and programme. */
function inScope(c: AdminCourseDto, f: Form) {
  if (c.status === 'archived') return false;
  if (!f.batchYear || c.batchYear !== Number(f.batchYear)) return false;
  if (f.semester && c.semester !== Number(f.semester)) return false;
  if (f.programme && !(c.branchSlugs.length ? c.branchSlugs : [c.branchSlug]).includes(f.programme))
    return false;
  return true;
}

/** What an existing bundle was built for, read back from its courses. */
export function scopeOf(courses: AdminCourseDto[]): Pick<Form, 'semester' | 'programme'> {
  const semesters = new Set(courses.map((c) => c.semester));
  const shared = PROGRAMMES.filter((p) =>
    courses.every((c) => (c.branchSlugs.length ? c.branchSlugs : [c.branchSlug]).includes(p.slug)),
  );
  return {
    semester: semesters.size === 1 ? String([...semesters][0]) : '',
    programme: shared.length === 1 ? shared[0]!.slug : '',
  };
}

function BundleForm({
  initial,
  courses,
  onDone,
}: { initial: Form; courses: AdminCourseDto[]; onDone: () => void }) {
  const qc = useQueryClient();
  const years = [...new Set(courses.map((c) => c.batchYear))].sort((a, b) => b - a);
  const [f, setF] = useState<Form>(() => ({
    ...initial,
    batchYear: initial.batchYear || String(years[0] ?? ''),
  }));
  const scoped = courses
    .filter((c) => inScope(c, f))
    .sort((a, b) => a.semester - b.semester || a.title.localeCompare(b.title));
  const semesters = [...new Set(scoped.map((c) => c.semester))];
  const chosen = courses.filter((c) => f.courseIds.includes(c.id));
  const outside = chosen.filter((c) => !inScope(c, f));
  const list = chosen.filter((c) => c.status !== 'archived').reduce((s, c) => s + c.pricePaise, 0);
  const price = rupeesToPaise(f.rupees);
  const savePaise = Math.max(0, list - price);
  const save = list > 0 && price > 0 ? Math.round((savePaise / list) * 100) : 0;
  const semesterOptions = [
    ...new Set(courses.filter((c) => c.batchYear === Number(f.batchYear)).map((c) => c.semester)),
  ].sort((a, b) => a - b);

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
      void qc.invalidateQueries({ queryKey: ['admin-bundles'] });
      void qc.invalidateQueries({ queryKey: ['bundles'] });
      void qc.invalidateQueries({ queryKey: ['bundle'] });
      void qc.invalidateQueries({ queryKey: ['course'] });
      onDone();
    },
  });

  const suggestedTitle = () =>
    [
      `${String(f.batchYear).slice(2)} Batch`,
      f.programme ? programmeCode(f.programme) : null,
      f.semester ? `Semester ${f.semester}` : 'complete set',
    ]
      .filter(Boolean)
      .join(' · ');
  const addAll = () =>
    setF((x) => ({
      ...x,
      courseIds: [
        ...new Set([...x.courseIds, ...scoped.filter((c) => c.status === 'live').map((c) => c.id)]),
      ],
      title: x.title || suggestedTitle(),
    }));
  const toggle = (id: string) =>
    setF((x) => ({
      ...x,
      courseIds: x.courseIds.includes(id) ? x.courseIds.filter((c) => c !== id) : [...x.courseIds, id],
    }));
  const removeOutside = () =>
    setF((x) => ({ ...x, courseIds: x.courseIds.filter((id) => !outside.some((c) => c.id === id)) }));

  const notLive = chosen.filter((c) => c.status !== 'live');
  const liveSelectionValid = f.status !== 'live' || notLive.length === 0;
  const ok =
    f.title.trim().length >= 2 &&
    chosen.length >= 2 &&
    outside.length === 0 &&
    liveSelectionValid &&
    price >= 100 &&
    price <= 5_000_000 &&
    price < list;

  const scopeLabel = `${f.batchYear} · ${f.programme ? programmeCode(f.programme) : 'every programme'} · ${
    f.semester ? `semester ${f.semester}` : 'every semester'
  }`;

  return (
    <div className="rounded-[22px] border-2 border-marigold bg-surface p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.4fr_1fr_1fr] gap-3 items-end">
        <Field label="Bundle title" className="sm:col-span-2 lg:col-span-1">
          <input
            className={input}
            value={f.title}
            placeholder={suggestedTitle()}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </Field>
        <Field label="Batch">
          <select
            className={input}
            value={f.batchYear}
            onChange={(e) => setF({ ...f, batchYear: e.target.value, semester: '' })}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Programme">
          <select
            className={input}
            value={f.programme}
            onChange={(e) => setF({ ...f, programme: e.target.value })}
          >
            <option value="">Every programme</option>
            {PROGRAMMES.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Semester">
          <select
            className={input}
            value={f.semester}
            onChange={(e) => setF({ ...f, semester: e.target.value })}
          >
            <option value="">Every semester</option>
            {semesterOptions.map((s) => (
              <option key={s} value={s}>
                Semester {s}
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
        <Field label="Description" className="sm:col-span-2 lg:col-span-5">
          <input
            className={input}
            value={f.description}
            maxLength={600}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="font-semibold">Courses in this bundle ({chosen.length})</span>
          <span className="font-mono text-xs text-ink2">
            Showing {scoped.length} for {scopeLabel}
          </span>
        </span>
        <Button variant="outline" onClick={addAll} disabled={!scoped.some((c) => c.status === 'live')}>
          Add every live course shown
        </Button>
      </div>

      {outside.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-blush bg-blush/15 p-3 text-sm">
          <span>
            <strong>
              {plural(outside.length, 'chosen course')} {outside.length === 1 ? "doesn't" : "don't"} fit{' '}
              {scopeLabel}:
            </strong>{' '}
            {outside.map((c) => `${c.title} (${c.batchYear} · S${c.semester})`).join(', ')}. A bundle keeps to
            one batch, programme and semester so students get exactly their pack.
          </span>
          <Button variant="outline" onClick={removeOutside}>
            Remove {outside.length === 1 ? 'it' : 'them'}
          </Button>
        </div>
      )}

      <div className="max-h-[360px] overflow-y-auto flex flex-col gap-3 pr-1">
        {scoped.length === 0 && (
          <p className="m-0 text-sm text-ink2">
            No courses match {scopeLabel}. Choose another semester or programme.
          </p>
        )}
        {semesters.map((sem) => (
          <section key={sem} aria-label={`Semester ${sem}`} className="flex flex-col gap-2">
            {(!f.semester || semesters.length > 1) && (
              <h4 className="m-0 font-mono text-xs font-semibold uppercase tracking-wide text-ink2">
                Semester {sem}
              </h4>
            )}
            <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
              {scoped
                .filter((c) => c.semester === sem)
                .map((c) => (
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
                          {(c.branchSlugs.length ? c.branchSlugs : [c.branchSlug])
                            .map(programmeCode)
                            .join(' · ')}{' '}
                          · {formatRupees(c.pricePaise)}
                          {c.status !== 'live' && ` · ${c.status}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>

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
          Not live yet: {notLive.map((c) => c.title).join(', ')}. Publish{' '}
          {notLive.length === 1 ? 'it' : 'them'} in Courses &amp; publishing first, or save the bundle as a
          draft.
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
          {b.batchYear ?? 'mixed batches'} · {plural(b.courseCount, 'live course')} of {b.courseIds.length}
        </div>
      </div>
      <div className="text-sm">
        <span className="line-through text-ink2 mr-2">{formatRupees(b.listPricePaise)}</span>
        <strong>{formatRupees(b.pricePaise)}</strong>
        <span className="ml-2 inline-flex h-6 px-2 rounded-md bg-marigold-soft text-marigold-text text-xs font-bold items-center">
          Save {formatRupees(Math.max(0, b.listPricePaise - b.pricePaise))} · {b.savePercent}%
        </span>
      </div>
      {b.status !== 'live' && (
        <LinkButton to={`/b/${b.slug}`} variant="outline">
          Preview
        </LinkButton>
      )}
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
                  ...scopeOf((courses.data ?? []).filter((c) => b.courseIds.includes(c.id))),
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
