import { type AdminCourseDto, WINTER_2026_27_OFFERINGS, WINTER_2026_27_TITLES } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Skeleton } from '../../shared/ui/feedback';
import { Panel, StatusPill, plural } from './ui';

/**
 * The term's course list, programme by programme and batch by batch, against the notes we have.
 * One course (one folder of notes) can fill several rows: CSE3003 is read by 2024 BCE and 2025 BCY.
 */
export function CourseListPanel() {
  const [, setParams] = useSearchParams();
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses, staleTime: 30_000 });
  const programmes = (index.data?.branches ?? []).filter(
    (b) => !b.isCommon && WINTER_2026_27_OFFERINGS[b.code.toUpperCase()],
  );
  const [slug, setSlug] = useState<string | null>(null);
  const branch = programmes.find((b) => b.slug === slug) ?? programmes[0];

  if (index.isPending || courses.isPending) return <Skeleton className="h-96 rounded-2xl" />;
  if (courses.isError) return <p className="m-0 text-blush-text">{friendly(courses.error)}</p>;
  if (!branch) return <p className="m-0 text-ink2">No programmes from the course list are set up yet.</p>;

  const all = courses.data ?? [];
  const byCode = new Map<string, AdminCourseDto[]>();
  for (const c of all)
    if (c.courseCode)
      byCode.set(c.courseCode.toUpperCase(), [...(byCode.get(c.courseCode.toUpperCase()) ?? []), c]);
  const years = Object.entries(WINTER_2026_27_OFFERINGS[branch.code.toUpperCase()] ?? {})
    .map(([y, codes]) => [Number(y), codes] as const)
    .sort((a, b) => b[0] - a[0]);
  const listed = years.flatMap(([, codes]) => codes);
  const covered = listed.filter((code) => (byCode.get(code) ?? []).some((c) => c.status === 'live')).length;
  const open = (id: string) => setParams({ section: 'courses', course: id, tab: 'details' });

  return (
    <Panel title="Course list">
      <p className="m-0 text-[14px] text-ink2">
        Winter 2026-27, by programme. A course with a listed code shows to every batch that takes it, from one
        set of notes.
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Programme">
        {programmes.map((b) => (
          <button
            key={b.slug}
            type="button"
            role="tab"
            aria-selected={b.slug === branch.slug}
            title={b.name}
            onClick={() => setSlug(b.slug)}
            className={`h-9 shrink-0 rounded-full px-3.5 text-[14px] font-semibold border ${
              b.slug === branch.slug
                ? 'bg-brand text-white border-brand'
                : 'border-line text-ink2 hover:text-ink'
            }`}
          >
            {b.code}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="m-0 text-[18px] font-semibold">{branch.name}</h3>
        <span className="font-mono text-[12px] text-ink2">
          {covered} of {plural(listed.length, 'listed course')} on sale
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {years.map(([year, codes]) => (
          <section
            key={year}
            className="rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-2"
          >
            <h4 className="m-0 text-[15px] font-semibold">
              {year} batch <span className="font-normal text-ink2">· {branch.code}</span>
            </h4>
            <ul className="m-0 p-0 list-none flex flex-col">
              {codes.map((code) => {
                const have = byCode.get(code) ?? [];
                return (
                  <li
                    key={code}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/60 py-2"
                  >
                    <span className="w-[4.75rem] shrink-0 font-mono text-[12px] text-ink2">{code}</span>
                    <span className="flex-[1_1_10rem] min-w-0 text-[14px]">
                      {have[0]?.title ?? WINTER_2026_27_TITLES[code] ?? code}
                    </span>
                    {have.length ? (
                      have.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => open(c.id)}
                          className="inline-flex items-center gap-1.5 rounded-full px-1 text-[13px] font-semibold text-teal-text hover:underline underline-offset-4"
                          title={`Open ${c.title}`}
                        >
                          <StatusPill status={c.status} />
                        </button>
                      ))
                    ) : (
                      <span className="text-[12px] text-ink2">No notes yet</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}
