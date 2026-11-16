import type { AdminBundleDto, AdminCourseDto } from '@ss/contracts';
import { useState } from 'react';
import { input } from './ui';

/** Chosen courses as removable chips, and a search to add more. Used by offers and promo codes. */
export function CoursePicker({
  courses,
  value,
  onToggle,
  label,
}: {
  courses: AdminCourseDto[];
  value: string[];
  onToggle: (id: string) => void;
  /** What the list is for, e.g. "the offer" (screen readers). */
  label: string;
}) {
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const live = courses.filter((c) => c.status === 'live');
  const shown = words.length
    ? live
        .filter((c) =>
          words.every((w) =>
            [c.title, c.courseCode ?? '', String(c.batchYear), ...c.branchSlugs]
              .join(' ')
              .toLowerCase()
              .includes(w),
          ),
        )
        .slice(0, 40)
    : [];
  const chosen = courses.filter((c) => value.includes(c.id));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">
        Single courses <span className="tabular-nums text-ink2">({chosen.length})</span>
      </span>
      {chosen.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5" aria-label={`Courses in ${label}`}>
          {chosen.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-label={`Remove ${c.title}`}
                onClick={() => onToggle(c.id)}
                className="h-8 px-3 rounded-full border text-[13px] cursor-pointer border-teal bg-mist/25 text-ink"
              >
                {c.title} <span className="font-mono text-[11px] text-ink2">{c.batchYear}</span> ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        type="search"
        aria-label={`Search courses for ${label}`}
        placeholder="Search a course by name or code"
        className={`${input} h-10 text-sm sm:w-80`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {shown.length > 0 && (
        <ul className="m-0 p-0 list-none max-h-[220px] overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 pr-1">
          {shown.map((c) => (
            <li key={c.id}>
              <label
                className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer border-[1.5px] ${
                  value.includes(c.id) ? 'border-teal bg-mist/25' : 'border-transparent bg-sunk'
                }`}
              >
                <input
                  type="checkbox"
                  checked={value.includes(c.id)}
                  onChange={() => onToggle(c.id)}
                  className="w-5 h-5 accent-[var(--teal)] shrink-0"
                />
                <span className="min-w-0 text-sm truncate" title={c.title}>
                  {c.title}{' '}
                  <span className="font-mono text-[11px] text-ink2">
                    {c.courseCode ?? ''} {c.batchYear}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Live bundles as toggle chips. Renders nothing when there are none. */
export function BundlePicker({
  bundles,
  value,
  onToggle,
}: { bundles: AdminBundleDto[]; value: string[]; onToggle: (id: string) => void }) {
  if (!bundles.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">Bundles</span>
      <div className="flex flex-wrap gap-1.5">
        {bundles.map((b) => {
          const on = value.includes(b.id);
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(b.id)}
              className={`h-9 rounded-full px-3 text-[13px] font-semibold border cursor-pointer ${
                on ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
              }`}
            >
              {b.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}
