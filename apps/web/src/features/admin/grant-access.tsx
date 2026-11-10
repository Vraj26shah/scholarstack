import { ACCESS_MONTHS } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Field, U, input, plural } from './ui';

/** A date picked in the form means "until the end of that day" in India. */
const endOfDayIST = (date: string) => new Date(`${date}T23:59:59+05:30`).toISOString();
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

// ── Give a course by email ───────────────────────────────────────────────────

function GrantForm({ courseId }: { courseId: string }) {
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
      void qc.invalidateQueries({ queryKey: ['admin', 'students'] });
    },
  });
  const ready = emails.length > 0 && emails.length <= 200 && (ends !== 'date' || !!date);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-sunk/60 p-3 sm:p-4">
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

/** Give a course by college email: pick the course, paste the emails. */
export function GiveAccessCard({ onClose }: { onClose: () => void }) {
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const list = (courses.data ?? [])
    .filter((c) => c.status !== 'archived')
    .sort((a, b) => b.batchYear - a.batchYear || a.semester - b.semester || a.title.localeCompare(b.title));
  const [courseId, setCourseId] = useState('');
  const chosen = courseId || list[0]?.id || '';
  return (
    <section
      aria-label="Give access"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-sunk/60 p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto">
          <h3 className="m-0 text-[16px] font-semibold">Give access</h3>
          <p className="m-0 mt-0.5 text-[13px] text-ink2">
            Free, emailed to them, and on their shelf <U>as soon as they sign in</U>.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <Field label="Course">
        <select className={input} value={chosen} onChange={(e) => setCourseId(e.target.value)}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.batchYear} · S{c.semester} · {c.title}
              {c.status === 'draft' ? ' (draft)' : ''}
            </option>
          ))}
        </select>
      </Field>
      {chosen && <GrantForm key={chosen} courseId={chosen} />}
      {courses.isError && <p className="m-0 text-sm text-blush-text">{friendly(courses.error)}</p>}
    </section>
  );
}
