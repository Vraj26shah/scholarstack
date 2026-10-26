import type { AdminSyncHealthDto, StorageCompareDto } from '@ss/contracts';
import { useState } from 'react';
import { buttonClass } from '../../shared/ui/button';
import { Check, ChevronDown, Cross } from '../../shared/ui/icons';
import { StatusPill, plural } from './ui';

export type CourseDiff = StorageCompareDto['courses'][number];

export const fileName = (key: string) => key.split('/').at(-1) ?? key;
export const diffCount = (c: CourseDiff) => c.newInR2.length + c.changedInR2.length + c.missingFromR2.length;

function HealthCard({
  title,
  plain,
  ok,
  message,
}: { title: string; plain: string; ok: boolean | null; message: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        {ok === null ? (
          <span className="text-xs text-ink2">Checking…</span>
        ) : ok ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-teal-text">
            <Check size={15} /> Working
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-blush-text">
            <Cross size={15} /> Problem
          </span>
        )}
      </div>
      <p className="m-0 text-xs text-ink2">{plain}</p>
      <p className={`m-0 text-[13px] leading-snug ${ok === false ? 'text-blush-text' : 'text-ink'}`}>
        {message}
      </p>
    </div>
  );
}

export function Health({ health }: { health: AdminSyncHealthDto | undefined }) {
  if (!health)
    return <p className="m-0 text-sm text-ink2">Checking storage, website, page maker and payments…</p>;
  const mode = health.payments.mode === 'live' ? '' : health.payments.mode === 'test' ? ' (test mode)' : '';
  const cards = [
    {
      title: 'File storage',
      plain: 'Where the original files live.',
      ok: health.r2.status === 'connected',
      message: health.r2.message,
    },
    {
      title: 'Website database',
      plain: 'Courses, prices and page lists.',
      ok: health.supabase.status === 'connected',
      message: health.supabase.message,
    },
    {
      title: 'Page maker',
      plain: 'Turns files into protected pages.',
      ok: health.conversion.status === 'ready',
      message: health.conversion.message,
    },
    {
      title: `Payments${mode}`,
      plain: "Takes students' money at checkout.",
      ok: health.payments.status === 'connected',
      message: health.payments.message ?? '',
    },
  ];
  const broken = cards.filter((c) => !c.ok);
  if (broken.length === 0)
    return (
      <p className="m-0 inline-flex flex-wrap items-center gap-1.5 text-sm text-ink2">
        <Check size={15} className="text-teal-text" />
        Storage, website, page maker and payments{mode} are all working
        {health.conversion.queuedJobs
          ? ` · ${plural(health.conversion.queuedJobs, 'file')} waiting for pages`
          : ''}
        .
      </p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {broken.map((c) => (
        <HealthCard key={c.title} title={c.title} plain={c.plain} ok={false} message={c.message} />
      ))}
    </div>
  );
}

function DiffList({
  label,
  keys,
  tone,
}: { label: string; keys: string[]; tone: 'new' | 'changed' | 'gone' }) {
  if (!keys.length) return null;
  const chip = { new: 'text-teal-text', changed: 'text-marigold-text', gone: 'text-blush-text' }[tone];
  return (
    <div className="flex flex-col gap-1">
      <p className={`m-0 text-xs font-semibold uppercase tracking-wide ${chip}`}>
        {label} · {keys.length}
      </p>
      <ul className="m-0 max-h-60 list-none overflow-y-auto p-0 text-[13px]">
        {keys.map((key) => (
          <li key={key} className="truncate font-mono text-ink2" title={key}>
            {fileName(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CourseCompareRow({
  course,
  busy,
  onFix,
}: { course: CourseDiff; busy: boolean; onFix: (course: CourseDiff) => void }) {
  const [open, setOpen] = useState(() => diffCount(course) > 0 || !!course.error);
  const diffs = diffCount(course);
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="grid grid-cols-1 items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2 text-left"
          disabled={!diffs && !course.error}
        >
          <ChevronDown
            size={16}
            className={`shrink-0 text-ink2 transition-transform ${open ? '' : '-rotate-90'} ${diffs || course.error ? '' : 'opacity-0'}`}
          />
          <span className="truncate font-semibold">{course.title}</span>
          <StatusPill status={course.status} />
        </button>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink2">
            Storage {course.r2Files} · website {course.supabaseFiles}
          </span>
          {course.error ? (
            <span className="font-semibold text-blush-text">Could not read storage</span>
          ) : diffs === 0 ? (
            <span className="inline-flex items-center gap-1 font-semibold text-teal-text">
              <Check size={14} /> Same
            </span>
          ) : (
            <>
              {course.newInR2.length > 0 && (
                <span className="rounded-md bg-mist px-2 py-0.5 font-semibold text-on-mist">
                  {course.newInR2.length} new
                </span>
              )}
              {course.changedInR2.length > 0 && (
                <span className="rounded-md bg-marigold-soft px-2 py-0.5 font-semibold text-marigold-text">
                  {course.changedInR2.length} changed
                </span>
              )}
              {course.missingFromR2.length > 0 && (
                <span className="rounded-md bg-blush px-2 py-0.5 font-semibold text-blush-text">
                  {course.missingFromR2.length} gone
                </span>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          disabled={!diffs || busy}
          onClick={() => onFix(course)}
          className={buttonClass(diffs ? 'brand' : 'outline', 'md', 'h-9 px-4 text-[13px]')}
        >
          {diffs ? 'Make website match storage' : 'Nothing to do'}
        </button>
      </div>
      {open && (diffs > 0 || course.error) && (
        <div className="grid gap-4 bg-sunk/60 px-4 py-3 md:grid-cols-3">
          {course.error && <p className="m-0 text-sm text-blush-text">{course.error}</p>}
          <DiffList label="New in storage → will be added" keys={course.newInR2} tone="new" />
          <DiffList label="Changed in storage → pages remade" keys={course.changedInR2} tone="changed" />
          <DiffList label="Gone from storage → taken off sale" keys={course.missingFromR2} tone="gone" />
        </div>
      )}
    </li>
  );
}
