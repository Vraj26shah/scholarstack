import type { AdminCourseDto, CourseOffering } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { useCourseSave } from './course-details';

const SOURCE: Record<AdminCourseDto['offerings'][number]['source'], string> = {
  admin: 'Chosen by you',
  list: 'Course list',
  filed: 'Filed here',
};

const key = (o: CourseOffering) => `${o.batchYear}:${o.branchSlug}`;

/** "2025 · BCE, BCY" — the drawers, one line per batch. */
function byYear(offerings: AdminCourseDto['offerings']) {
  const years = new Map<number, AdminCourseDto['offerings']>();
  for (const o of offerings) years.set(o.batchYear, [...(years.get(o.batchYear) ?? []), o]);
  return [...years.entries()].sort((a, b) => b[0] - a[0]);
}

/**
 * Who reads this course. The notes in storage are one course; it can be offered to any number of
 * batches and programmes. By default that follows the term's course list (by code) and where the
 * course was filed; choosing drawers here replaces both until "Follow the course list" is pressed.
 */
export function OfferingsEditor({ c }: { c: AdminCourseDto }) {
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const save = useCourseSave(c, () => setEditing(false));
  const programmes = (index.data?.branches ?? []).filter((b) => !b.isCommon);
  const nameOf = new Map((index.data?.branches ?? []).map((b) => [b.slug, b.code || b.slug.toUpperCase()]));
  const years = (index.data?.batches ?? []).map((b) => b);

  const start = () => {
    setPicked(new Set(c.offerings.map(key)));
    setEditing(true);
  };
  const toggle = (k: string) => {
    const next = new Set(picked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setPicked(next);
  };
  const choose = () =>
    save.mutate({
      offeredTo: [...picked].map((k) => {
        const [y, slug] = k.split(':');
        return { batchYear: Number(y), branchSlug: slug! };
      }),
    });

  return (
    <section
      aria-labelledby="offered-title"
      className="rounded-2xl p-4 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="offered-title" className="m-0 text-[17px] font-semibold mr-auto">
          Shown to
        </h3>
        {!editing && (
          <>
            {c.offeredTo && (
              <Button
                size="sm"
                variant="outline"
                disabled={save.isPending}
                onClick={() => save.mutate({ offeredTo: null })}
              >
                Follow the course list
              </Button>
            )}
            <Button size="sm" onClick={start}>
              Choose batches & branches
            </Button>
          </>
        )}
      </div>
      {!editing &&
        (c.offerings.length ? (
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
            {byYear(c.offerings).map(([year, list]) => (
              <li key={year} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 font-semibold tabular-nums">{year} batch</span>
                {list.map((o) => (
                  <span
                    key={key(o)}
                    title={SOURCE[o.source]}
                    className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                      o.source === 'admin'
                        ? 'bg-brand text-white'
                        : o.source === 'list'
                          ? 'bg-mist/60 text-ink'
                          : 'bg-sunk text-ink2'
                    }`}
                  >
                    {nameOf.get(o.branchSlug) ?? o.branchSlug.toUpperCase()}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-[14px] text-blush-text">
            No batch sees this course yet. Add its course code, or choose batches & branches.
          </p>
        ))}
      {!editing && (
        <p className="m-0 text-[12px] text-ink2">
          {c.offeredTo
            ? 'Chosen by you. The same notes serve every drawer listed.'
            : 'From the Winter 2026-27 course list (by code) and where it was filed. The same notes serve every drawer listed.'}
        </p>
      )}
      {editing && (
        <div className="flex flex-col gap-3">
          {years.map((y) => (
            <fieldset key={y.year} className="m-0 p-0 border-0 flex flex-col gap-1.5">
              <legend className="mb-1 text-[13px] font-semibold">
                {y.year} batch <span className="font-normal text-ink2">· {y.label}</span>
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {programmes.map((b) => {
                  const k = `${y.year}:${b.slug}`;
                  const on = picked.has(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      title={b.name}
                      onClick={() => toggle(k)}
                      className={`h-9 min-w-[3.25rem] rounded-full px-3 text-[13px] font-semibold border cursor-pointer ${
                        on ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
                      }`}
                    >
                      {b.code || b.slug.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={choose} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : `Save · ${picked.size} drawer${picked.size === 1 ? '' : 's'}`}
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {picked.size === 0 && (
              <span className="text-[13px] text-ink2">
                None picked: saving follows the course list again.
              </span>
            )}
          </div>
        </div>
      )}
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
    </section>
  );
}
