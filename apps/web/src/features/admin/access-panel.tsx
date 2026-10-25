import { ACCESS_MONTHS } from '@ss/contracts';
import type { AdminCourseAccessDto, AdminCourseDto, AdminStudentAccessDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Field, Note, Panel, U, input, plural } from './ui';

const STATE_LABEL: Record<AdminStudentAccessDto['state'], string> = {
  active: 'Active',
  ended: 'Ended',
  blocked: 'Blocked',
  disputed: 'Bank dispute',
};
const STATE_STYLE: Record<AdminStudentAccessDto['state'], string> = {
  active: 'bg-teal/15 text-teal-text',
  ended: 'bg-sunk text-ink2',
  blocked: 'bg-blush/40 text-blush-text',
  disputed: 'bg-marigold-soft text-marigold-text',
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

/** A date picked in the form means "until the end of that day" in India. */
const endOfDayIST = (date: string) => new Date(`${date}T23:59:59+05:30`).toISOString();
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// ── Give a course by email ───────────────────────────────────────────────────

function GrantForm({ courseId, term }: { courseId: string; term: string | null }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [ends, setEnds] = useState<'term' | 'none' | 'date'>('term');
  const [date, setDate] = useState('');
  const emails = text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  const grant = useMutation({
    mutationFn: () =>
      api.adminGrantAccess({
        courseId,
        emails,
        ...(ends === 'term' ? {} : { until: ends === 'none' ? null : endOfDayIST(date) }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['admin-access', courseId], data);
      // Keep only the addresses that still need attention in the box.
      setText(data.invalid.join('\n'));
    },
  });
  const ready = emails.length > 0 && emails.length <= 200 && (ends !== 'date' || !!date);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunk/60 p-3 sm:p-4">
      <div>
        <h4 className="m-0 text-[15px] font-semibold">Give access</h4>
        <p className="m-0 mt-0.5 text-[13px] text-ink2">
          Give this course by college email, no payment needed. Students who haven't signed up yet get it{' '}
          <U>the moment they sign in</U>.
        </p>
      </div>
      <Field label="Student emails (one per line, or separated by commas)">
        <textarea
          className={`${input} h-auto min-h-[84px] py-2.5 font-mono text-[13px]`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="name.23bce10001@vitbhopal.ac.in"
          spellCheck={false}
          autoCapitalize="none"
        />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label="Access ends">
          <select className={input} value={ends} onChange={(e) => setEnds(e.target.value as typeof ends)}>
            <option value="term">{ACCESS_MONTHS} months from today</option>
            <option value="none">No end date</option>
            <option value="date">On a date I choose</option>
          </select>
        </Field>
        {ends === 'date' ? (
          <Field label="End date">
            <input
              type="date"
              className={input}
              value={date}
              min={todayIST()}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Button variant="brand" disabled={!ready || grant.isPending} onClick={() => grant.mutate()}>
          {grant.isPending ? 'Giving…' : `Give to ${plural(emails.length, 'student')}`}
        </Button>
      </div>
      {grant.isSuccess && (
        <div role="status" className="flex flex-col gap-1 text-sm">
          {grant.data.granted.length > 0 && (
            <p className="m-0 text-teal-text">
              Done: {grant.data.granted.join(', ')} can read this course now.
              {grant.data.emailed.length === grant.data.granted.length
                ? ' We emailed them to say so.'
                : grant.data.emailed.length > 0
                  ? ` We emailed ${grant.data.emailed.join(', ')} (today's email limit stopped the rest).`
                  : ' No email was sent (email is off or today’s limit is used up).'}
            </p>
          )}
          {grant.data.notFound.length > 0 && (
            <p className="m-0 text-teal-text">
              Not signed up yet: {grant.data.notFound.join(', ')}. Saved: it's on their shelf the moment they
              sign in.
            </p>
          )}
          {grant.data.invalid.length > 0 && (
            <p className="m-0 text-blush-text">
              Not a college address: {grant.data.invalid.join(', ')}. Only exact @vitbhopal.ac.in addresses
              can be given courses.
            </p>
          )}
        </div>
      )}
      {grant.isError && <p className="m-0 text-sm text-blush-text">{friendly(grant.error)}</p>}
    </div>
  );
}

// ── Students of one course ───────────────────────────────────────────────────

type Filter = 'all' | AdminStudentAccessDto['state'];

function StudentsCard({ courses }: { courses: AdminCourseDto[] }) {
  const qc = useQueryClient();
  const sorted = useMemo(
    () =>
      [...courses].sort(
        (a, b) => b.batchYear - a.batchYear || a.semester - b.semester || a.title.localeCompare(b.title),
      ),
    [courses],
  );
  const [courseId, setCourseId] = useState(sorted[0]?.id ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [until, setUntil] = useState('');

  const access = useQuery({
    queryKey: ['admin-access', courseId],
    queryFn: () => api.adminCourseAccess(courseId),
    enabled: !!courseId,
  });

  const change = useMutation({
    mutationFn: (body: { action: 'block' | 'restore' | 'until'; until?: string | null; userIds: string[] }) =>
      api.adminChangeAccess({ courseId, ...body }),
    onSuccess: (data) => {
      qc.setQueryData<AdminCourseAccessDto>(['admin-access', courseId], data);
      setPicked(new Set());
    },
  });

  const students = access.data?.students ?? [];
  const counts: Partial<Record<AdminStudentAccessDto['state'], number>> = {};
  for (const s of students) counts[s.state] = (counts[s.state] ?? 0) + 1;
  const q = query.trim().toLowerCase();
  const shown = students
    .filter((s) => filter === 'all' || s.state === filter)
    .filter((s) => !q || s.email.includes(q) || (s.fullName ?? '').toLowerCase().includes(q));
  const allShownPicked = shown.length > 0 && shown.every((s) => picked.has(s.userId));
  const ids = [...picked];
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="rounded-[22px] border border-line bg-surface p-4 sm:p-5 flex flex-col gap-4">
      <div>
        <h3 className="m-0 text-lg font-semibold">Students</h3>
        <p className="m-0 mt-1 text-sm text-ink2 max-w-[720px]">
          Everyone who has or had a course. Blocking stops access at once and keeps the record; restore undoes
          it. A course taken back by a lost bank dispute can only come back if the student buys again.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Course">
          <select
            className={input}
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setPicked(new Set());
            }}
          >
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.batchYear} · S{c.semester} · {c.title}
                {c.status !== 'live' ? ` (${c.status})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Find a student">
          <input
            type="search"
            className={input}
            placeholder="email or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
      </div>

      {courseId && (
        <GrantForm key={courseId} courseId={courseId} term={access.data?.course.accessUntil ?? null} />
      )}

      <div
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
        role="group"
        aria-label="Show"
      >
        {(['all', 'active', 'ended', 'blocked', 'disputed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`shrink-0 h-9 rounded-full border px-3.5 text-sm cursor-pointer ${
              filter === f ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink'
            }`}
          >
            {f === 'all' ? 'All' : STATE_LABEL[f]} · {f === 'all' ? students.length : (counts[f] ?? 0)}
          </button>
        ))}
      </div>

      {access.isLoading ? (
        <Skeleton className="h-48" />
      ) : access.isError ? (
        <ErrorState
          title="Students didn't load."
          message={friendly(access.error)}
          onRetry={() => access.refetch()}
        />
      ) : students.length === 0 ? (
        <p className="m-0 text-sm text-ink2">Nobody has bought this course yet.</p>
      ) : (
        <>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-[var(--teal)]"
              checked={allShownPicked}
              onChange={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  for (const s of shown) {
                    if (allShownPicked) n.delete(s.userId);
                    else n.add(s.userId);
                  }
                  return n;
                })
              }
            />
            Select {allShownPicked ? 'none' : `all ${shown.length} shown`}
          </label>
          <ul className="list-none m-0 p-0 flex flex-col gap-2 max-h-[520px] overflow-y-auto">
            {shown.map((s) => (
              <li key={s.userId}>
                <label
                  className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-xl border-[1.5px] p-3 cursor-pointer sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] ${
                    picked.has(s.userId) ? 'border-teal bg-mist/20' : 'border-transparent bg-sunk'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="w-5 h-5 accent-[var(--teal)]"
                    checked={picked.has(s.userId)}
                    onChange={() => toggle(s.userId)}
                    aria-label={`Select ${s.email}`}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold" title={s.email}>
                      {s.email}
                    </span>
                    <span className="block truncate text-xs text-ink2">
                      {s.fullName ? `${s.fullName} · ` : ''}since {day(s.grantedAt)}
                    </span>
                  </span>
                  <span
                    className={`col-start-2 justify-self-start sm:col-start-auto inline-flex h-6 items-center rounded-md px-2 font-mono text-[11px] font-semibold uppercase ${STATE_STYLE[s.state]}`}
                  >
                    {STATE_LABEL[s.state]}
                    {s.source === 'admin' && ' · given'}
                  </span>
                  <span className="col-start-2 text-xs text-ink2 sm:col-start-auto sm:text-right sm:min-w-[110px]">
                    {s.expiresAt
                      ? `${s.state === 'ended' ? 'ended' : 'until'} ${day(s.expiresAt)}`
                      : 'no end date'}
                  </span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="p-4 text-sm text-ink2">No students match.</li>}
          </ul>
        </>
      )}

      {picked.size > 0 && (
        <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] md:bottom-3 z-20 flex flex-col gap-3 rounded-[18px] bg-brand p-3 text-white shadow-lg sm:p-4">
          <span className="text-sm font-semibold">{plural(picked.size, 'student')} selected</span>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
            <Button
              variant="outline-light"
              disabled={change.isPending}
              onClick={() => change.mutate({ action: 'block', userIds: ids })}
            >
              Block
            </Button>
            <Button
              variant="outline-light"
              disabled={change.isPending}
              onClick={() => change.mutate({ action: 'restore', userIds: ids })}
            >
              Restore
            </Button>
            <Button
              variant="outline-light"
              disabled={change.isPending}
              onClick={() =>
                change.mutate({ action: 'until', until: new Date().toISOString(), userIds: ids })
              }
            >
              End now
            </Button>
            <Button
              variant="outline-light"
              disabled={change.isPending}
              onClick={() => change.mutate({ action: 'until', until: null, userIds: ids })}
            >
              No end date
            </Button>
            <span className="col-span-2 flex items-end gap-2 sm:ml-auto">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-on-brand2">
                Access until
                <input
                  type="date"
                  className={`${input} h-10 text-ink`}
                  value={until}
                  min={todayIST()}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
              <Button
                variant="buy"
                disabled={!until || change.isPending}
                onClick={() => change.mutate({ action: 'until', until: endOfDayIST(until), userIds: ids })}
              >
                Set
              </Button>
            </span>
          </div>
        </div>
      )}
      {change.isSuccess && (
        <p role="status" className="m-0 text-sm text-teal-text">
          Done: {plural(change.data.changed, 'student')} updated.
        </p>
      )}
      {change.isError && <p className="m-0 text-sm text-blush-text">{friendly(change.error)}</p>}
    </section>
  );
}

export function AccessPanel() {
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  return (
    <Panel title="Students & access">
      {courses.isLoading ? (
        <Skeleton className="h-80" />
      ) : courses.isError ? (
        <ErrorState
          title="Courses didn't load."
          message={friendly(courses.error)}
          onRetry={() => courses.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-5">
          <Note>
            Every purchase lasts <U>{ACCESS_MONTHS} months from the day it's bought</U>; the student is
            emailed when it ends. Change one student's date below.
          </Note>
          <StudentsCard courses={courses.data ?? []} />
        </div>
      )}
    </Panel>
  );
}
